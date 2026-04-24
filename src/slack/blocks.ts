// Block Kit builders.
//
// TRUST BOUNDARY: builders prefixed with `build…Card`/`build…Modal` and
// returned to a participant context MUST NOT include the market's
// internal probability, price, percentage, or any signal that could be
// reverse-engineered into one. The unit tests in tests/market.test.ts
// assert this for the participant market card.
//
// Admin-only builders (buildAdminMarketSection, buildResolutionCard) MAY
// surface the aggregate — by spec they are never shown to participants
// before resolution, and resolution is the moment the aggregate becomes
// public.

import type { KnownBlock } from "@slack/bolt";
import { Side } from "@prisma/client";

const SECTION = (text: string): KnownBlock => ({
  type: "section",
  text: { type: "mrkdwn", text },
});

const DIVIDER: KnownBlock = { type: "divider" };

const CONTEXT = (text: string): KnownBlock => ({
  type: "context",
  elements: [{ type: "mrkdwn", text }],
});

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

// =============================================================================
// PARTICIPANT-FACING — must never leak market price.
// =============================================================================

export interface MarketCardInput {
  id: string;
  creatorSlackUserId: string;
  question: string;
  resolutionCriteria: string;
  deadline: Date;
  participantCount: number;
  status: "OPEN" | "RESOLVED" | "VOIDED";
}

/**
 * The card posted to the channel when a market is created.
 * NO PROBABILITY. NO PRICE. NO ODDS. NO PERCENTAGE.
 * Only: question, criteria, deadline, participation count, BET button.
 */
export function buildMarketCard(m: MarketCardInput): KnownBlock[] {
  const deadlinePassed = m.deadline.getTime() < Date.now();
  const isOpen = m.status === "OPEN" && !deadlinePassed;

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: m.question, emoji: false },
    },
    SECTION(`*How this resolves*\n${m.resolutionCriteria}`),
    CONTEXT(
      `Created by <@${m.creatorSlackUserId}>  ·  Resolves *${fmtDate(m.deadline)}*  ·  *${m.participantCount}* ${
        m.participantCount === 1 ? "person has" : "people have"
      } weighed in`
    ),
  ];

  if (isOpen) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Place a hunch", emoji: false },
          action_id: "open_bet_modal",
          value: m.id,
        },
      ],
    });
  } else if (deadlinePassed && m.status === "OPEN") {
    blocks.push(CONTEXT("_Deadline has passed. Awaiting resolution._"));
  } else if (m.status === "RESOLVED") {
    blocks.push(CONTEXT("_Resolved. See the resolution card below._"));
  } else if (m.status === "VOIDED") {
    blocks.push(CONTEXT("_This market was voided. No payouts."));
  }

  return blocks;
}

export interface BetModalArgs {
  marketId: string;
  question: string;
  defaultCoins: number;
  maxCoins: number;
  // Preview is computed server-side from current market state + the user's
  // current draft inputs. NEVER includes price/probability — only "win X / lose Y".
  preview: {
    state: "ready" | "incomplete" | "invalid";
    potentialWin?: number;
    potentialLoss?: number;
    message?: string; // shown when state !== "ready"
  };
  selectedSide?: Side;
  draftCoins?: string; // preserve user's text as they type
}

/**
 * Bet modal. Participant only sees:
 *   - which side
 *   - how many coins
 *   - "if right you win X / if wrong you lose Y" (computed for *their* commitment only)
 * NO market price. The preview is rerendered via views.update as the user
 * changes inputs — see registerBet() in handlers/bet.ts.
 */
export function buildBetModal(args: BetModalArgs): import("@slack/bolt").View {
  const sideOptions = [
    {
      text: { type: "plain_text" as const, text: "YES — it will happen", emoji: false },
      value: "YES" as const,
    },
    {
      text: { type: "plain_text" as const, text: "NO — it will not happen", emoji: false },
      value: "NO" as const,
    },
  ];
  const initialOption = args.selectedSide
    ? sideOptions.find((o) => o.value === args.selectedSide)
    : undefined;

  let previewBlock: KnownBlock;
  if (args.preview.state === "ready" && args.preview.potentialWin !== undefined) {
    previewBlock = SECTION(
      `*If you're right, you win ~${Math.round(args.preview.potentialWin).toLocaleString()} coins.*\n` +
        `*If you're wrong, you lose ${Math.round(args.preview.potentialLoss ?? 0).toLocaleString()} coins.*`
    );
  } else {
    previewBlock = CONTEXT(
      args.preview.message ??
        "Pick a side and an amount. We'll show what's at stake here."
    );
  }

  return {
    type: "modal",
    callback_id: "submit_bet",
    private_metadata: args.marketId,
    title: { type: "plain_text", text: "Place a hunch", emoji: false },
    submit: { type: "plain_text", text: "Submit", emoji: false },
    close: { type: "plain_text", text: "Cancel", emoji: false },
    blocks: [
      SECTION(`*${args.question}*`),
      DIVIDER,
      {
        type: "input",
        block_id: "side_block",
        dispatch_action: true,
        label: {
          type: "plain_text",
          text: "Which side do you think will happen?",
          emoji: false,
        },
        element: {
          type: "radio_buttons",
          action_id: "side_input",
          options: sideOptions,
          ...(initialOption ? { initial_option: initialOption } : {}),
        },
      },
      {
        type: "input",
        block_id: "coins_block",
        dispatch_action: true,
        label: {
          type: "plain_text",
          text: `How many coins do you want to commit? (you have ${args.maxCoins.toLocaleString()})`,
          emoji: false,
        },
        element: {
          type: "plain_text_input",
          action_id: "coins_input",
          initial_value: args.draftCoins ?? String(Math.min(args.defaultCoins, args.maxCoins)),
          dispatch_action_config: {
            trigger_actions_on: ["on_enter_pressed"],
          },
        },
      },
      previewBlock,
      CONTEXT(
        `_Your hunch is anonymous. No one — not your manager, not the creator — sees who bet what._`
      ),
    ],
  };
}

/**
 * Ephemeral confirmation after a bet is submitted. Plain coin amounts only.
 * NO price, NO probability.
 */
export function buildBetConfirmation(args: {
  side: Side;
  coins: number;
  potentialWin: number;
  potentialLoss: number;
  deadline: Date;
}): KnownBlock[] {
  return [
    SECTION(
      `Got it. Your hunch is recorded — *${args.coins.toLocaleString()} coins on ${args.side}*.`
    ),
    CONTEXT(
      `If you're right you win ~*${Math.round(args.potentialWin).toLocaleString()} coins*. If you're wrong you lose *${args.potentialLoss.toLocaleString()}*.`
    ),
    CONTEXT(
      `Check back after *${fmtDate(args.deadline)}* to see how you did.`
    ),
  ];
}

export interface PortfolioInput {
  coinBalance: number;
  openPositions: Array<{
    question: string;
    side: Side;
    coinsCommitted: number;
  }>;
  resolvedPositions: Array<{
    question: string;
    side: Side;
    outcome: Side;
    pnl: number;
  }>;
  allTimePnl: number;
}

/**
 * `/hunch me` ephemeral. Shows ONLY the user's own bets. Open positions
 * are valued at coins committed — never at any current market price.
 */
export function buildPortfolio(p: PortfolioInput): KnownBlock[] {
  const blocks: KnownBlock[] = [
    SECTION(`*Your coins:* ${p.coinBalance.toLocaleString()}`),
    CONTEXT(
      `All-time P&L from resolved hunches: *${p.allTimePnl >= 0 ? "+" : ""}${p.allTimePnl.toLocaleString()} coins*`
    ),
  ];

  if (p.openPositions.length === 0 && p.resolvedPositions.length === 0) {
    blocks.push(DIVIDER);
    blocks.push(
      SECTION(
        "You haven't shared any hunches yet. Watch your channels for questions to weigh in on, or create your own with `/hunch create`."
      )
    );
    return blocks;
  }

  if (p.openPositions.length > 0) {
    blocks.push(DIVIDER);
    blocks.push(SECTION("*Open hunches*"));
    for (const pos of p.openPositions) {
      blocks.push(
        SECTION(
          `• *${pos.question}*\n  You bet *${pos.side}* with *${pos.coinsCommitted.toLocaleString()}* coins.`
        )
      );
    }
  }

  if (p.resolvedPositions.length > 0) {
    blocks.push(DIVIDER);
    blocks.push(SECTION("*Resolved hunches*"));
    for (const pos of p.resolvedPositions) {
      const win = pos.side === pos.outcome;
      const sign = pos.pnl >= 0 ? "+" : "";
      blocks.push(
        SECTION(
          `• *${pos.question}*\n  Outcome: *${pos.outcome}* — ${
            win ? "you were right" : "you were wrong"
          }. P&L: *${sign}${pos.pnl.toLocaleString()} coins*.`
        )
      );
    }
  }

  return blocks;
}

// =============================================================================
// RESOLUTION — aggregate is safe to disclose at this point.
// =============================================================================

export function buildResolutionCard(args: {
  question: string;
  outcome: Side;
  finalProbability: number; // YES probability at moment of resolution
  participantCount: number;
}): KnownBlock[] {
  const aligned =
    args.outcome === "YES"
      ? args.finalProbability
      : 1 - args.finalProbability;
  const calibrationNote =
    aligned >= 0.5
      ? "The crowd had a hunch."
      : "The crowd was off this time.";

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Resolved: ${args.outcome}`,
        emoji: false,
      },
    },
    SECTION(`*${args.question}*`),
    DIVIDER,
    SECTION(
      `${args.participantCount} ${
        args.participantCount === 1 ? "person" : "people"
      } weighed in. The final aggregated forecast was *${pct(args.finalProbability)} YES*. ${calibrationNote}`
    ),
    CONTEXT(`Run \`/hunch me\` to see your P&L on this one.`),
  ];
}

// =============================================================================
// ADMIN-ONLY — aggregated signal is allowed here.
// =============================================================================

export interface AdminMarketRow {
  id: string;
  question: string;
  deadline: Date;
  yesCount: number;
  noCount: number;
  currentProbability: number;
  trend: number[]; // chronological YES probability snapshots
}

function sparkline(trend: number[]): string {
  if (trend.length === 0) return "_no bets yet_";
  return trend.map((p) => pct(p)).join(" → ");
}

export function buildAdminDashboard(rows: AdminMarketRow[]): KnownBlock[] {
  if (rows.length === 0) {
    return [
      SECTION(
        "No open markets to show. Create one with `/hunch create`."
      ),
    ];
  }

  const blocks: KnownBlock[] = [
    SECTION("*Admin view* — aggregated signal, no individual identities."),
    DIVIDER,
  ];

  for (const r of rows) {
    blocks.push(
      SECTION(
        `*${r.question}*\nResolves ${fmtDate(r.deadline)}  ·  Aggregate: *${pct(
          r.currentProbability
        )} YES*  ·  ${r.yesCount} YES bets, ${r.noCount} NO bets`
      )
    );
    blocks.push(CONTEXT(`Trend: ${sparkline(r.trend)}`));
    blocks.push(DIVIDER);
  }

  return blocks;
}

// =============================================================================
// LEADERBOARD
// =============================================================================

export function buildLeaderboard(
  rows: Array<{ rank: number; slackUserId: string; score: number }>
): KnownBlock[] {
  if (rows.length === 0) {
    return [SECTION("No one has played yet. Be the first.")];
  }

  const lines = rows
    .map(
      (r) =>
        `*${r.rank}.* <@${r.slackUserId}>  —  ${r.score.toLocaleString()} coins`
    )
    .join("\n");

  return [
    SECTION("*Leaderboard*"),
    SECTION(lines),
    CONTEXT(
      "Score = liquid coins + open commitments at cost. Open positions are valued at what you bet, not at any market price."
    ),
  ];
}

// =============================================================================
// CREATE-MARKET MODAL
// =============================================================================

export function buildCreateMarketModal(): import("@slack/bolt").View {
  return {
    type: "modal",
    callback_id: "submit_create_market",
    title: { type: "plain_text", text: "Ask the team", emoji: false },
    submit: { type: "plain_text", text: "Post market", emoji: false },
    close: { type: "plain_text", text: "Cancel", emoji: false },
    blocks: [
      {
        type: "input",
        block_id: "question_block",
        label: { type: "plain_text", text: "Question", emoji: false },
        element: {
          type: "plain_text_input",
          action_id: "question_input",
          max_length: 140,
          placeholder: {
            type: "plain_text",
            text: "Will we ship the mobile app by end of Q3?",
          },
        },
      },
      {
        type: "input",
        block_id: "criteria_block",
        label: {
          type: "plain_text",
          text: "How will we know what happened?",
          emoji: false,
        },
        element: {
          type: "plain_text_input",
          action_id: "criteria_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Resolves YES if v1.0 is submitted to the App Store before Sep 30.",
          },
        },
      },
      {
        type: "input",
        block_id: "deadline_block",
        label: {
          type: "plain_text",
          text: "Resolution deadline",
          emoji: false,
        },
        element: {
          type: "datepicker",
          action_id: "deadline_input",
        },
      },
      {
        type: "input",
        block_id: "channel_block",
        label: {
          type: "plain_text",
          text: "Post in channel",
          emoji: false,
        },
        element: {
          type: "conversations_select",
          action_id: "channel_input",
          default_to_current_conversation: true,
          filter: { include: ["public", "private"], exclude_bot_users: true },
        },
      },
    ],
  };
}
