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
  // Use Slack's date-format token so each viewer sees the deadline in
  // their own timezone. The fallback (after `|`) is what Slack shows
  // if it can't render — and what unit tests / non-Slack surfaces see.
  const epochSec = Math.floor(d.getTime() / 1000);
  const fallback = d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
    timeZoneName: "short",
  });
  return `<!date^${epochSec}^{date_long} at {time}|${fallback}>`;
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
}

/**
 * Bet modal. Participant sees only which side and how many hunches.
 *
 * BLIND LMSR: we deliberately show NO payout preview. The LMSR payout ratio
 * encodes the current probability — showing "if right you win X" lets anyone
 * toggle YES/NO and read off the hidden aggregate, which defeats anti-anchoring.
 * The payout is computed server-side and revealed only at resolution. The modal
 * is therefore static (no dispatch_action / live re-render).
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
        label: {
          type: "plain_text",
          text: "Which side do you think will happen?",
          emoji: false,
        },
        element: {
          type: "radio_buttons",
          action_id: "side_input",
          options: sideOptions,
        },
      },
      {
        type: "input",
        block_id: "coins_block",
        label: {
          type: "plain_text",
          text: `How many hunches do you want to commit? (you have ${args.maxCoins.toLocaleString()})`,
          emoji: false,
        },
        element: {
          type: "plain_text_input",
          action_id: "coins_input",
          initial_value: String(Math.min(args.defaultCoins, args.maxCoins)),
        },
      },
      CONTEXT(
        "You're risking the hunches you commit. If you're right you win — the payout is revealed when the question resolves. Hiding it until then is what keeps the signal honest."
      ),
      CONTEXT(
        `_Your hunch is anonymous. No one — not your manager, not the creator — sees who bet what._`
      ),
    ],
  };
}

/**
 * Ephemeral confirmation after a bet is submitted.
 *
 * BLIND LMSR: no payout figure here either — the win amount at bet time
 * encodes the current price. The payout is revealed at resolution.
 */
export function buildBetConfirmation(args: {
  side: Side;
  coins: number;
  deadline: Date;
}): KnownBlock[] {
  return [
    SECTION(
      `Got it. Your hunch is recorded — *${args.coins.toLocaleString()} hunches on ${args.side}*.`
    ),
    CONTEXT(
      `Your payout is revealed when the question resolves. Check back after *${fmtDate(args.deadline)}* to see how you did.`
    ),
    CONTEXT(
      `🔒 Your bet is anonymous. The creator and your teammates only see the aggregate after resolution.`
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
    SECTION(`*Your hunches:* ${p.coinBalance.toLocaleString()}`),
    CONTEXT(
      `All-time P&L from resolved hunches: *${p.allTimePnl >= 0 ? "+" : ""}${p.allTimePnl.toLocaleString()} hunches*`
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
          `• *${pos.question}*\n  You bet *${pos.side}* with *${pos.coinsCommitted.toLocaleString()}* hunches.`
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
          }. P&L: *${sign}${pos.pnl.toLocaleString()} hunches*.`
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
        text: `🎉 Resolved: ${args.outcome}`,
        emoji: true,
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

/**
 * Personal DM sent to each winner the moment a market resolves. The aha
 * moment of the product — they bet, they were right, they got paid.
 * Shows take-home in coins + new total. No price/probability disclosure
 * beyond what the resolution card already publishes.
 */
export function buildWinnerDm(args: {
  question: string;
  outcome: Side;
  payout: number;
  pnl: number;
  newBalance: number;
}): KnownBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "🎉 You called it.", emoji: true },
    },
    SECTION(`*${args.question}* resolved *${args.outcome}*. You were right.`),
    SECTION(
      `Take-home: *+${Math.round(args.pnl).toLocaleString()} hunches*. New balance: *${args.newBalance.toLocaleString()}*.`
    ),
    CONTEXT(`Run \`/hunch me\` to see all your hunches.`),
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
      SECTION("*Admin view*"),
      SECTION(
        "No open markets right now. Once you (or anyone with admin) creates one, this view shows the aggregated YES probability and the trend over time — across every market in the workspace."
      ),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            style: "primary",
            text: { type: "plain_text", text: "Ask the team a question", emoji: false },
            action_id: "welcome_create_blank",
          },
        ],
      },
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
    return [
      SECTION("*Leaderboard*"),
      SECTION(
        "No one has resolved any hunches yet. The leaderboard fills in as questions resolve and hunches move. Run `/hunch create` to start one."
      ),
    ];
  }

  const lines = rows
    .map(
      (r) =>
        `*${r.rank}.* <@${r.slackUserId}>  —  ${r.score.toLocaleString()} hunches`
    )
    .join("\n");

  return [
    SECTION("*Leaderboard*"),
    SECTION(lines),
    CONTEXT(
      "Score = liquid hunches + open commitments at cost. Open positions are valued at what you bet, not at any market price."
    ),
  ];
}

// =============================================================================
// HELP CARD — interactive entry point. /hunch with no args lands here.
// =============================================================================

/**
 * Discoverable help card. Buttons (not just text) so a brand-new
 * installer can click their way to the first useful action without
 * memorizing slash syntax.
 */
export function buildHelpCard(): KnownBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Hunch", emoji: false },
    },
    SECTION(
      "Ask your team a question. They commit play-money hunches to YES or NO. The aggregate stays hidden until the question resolves — that's what keeps it honest."
    ),
    DIVIDER,
    SECTION("*What do you want to do?*"),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Ask the team a question", emoji: false },
          action_id: "welcome_create_blank",
        },
      ],
    },
    SECTION(
      "Other commands:\n" +
        "• `/hunch me` — your balance, open bets, and P&L\n" +
        "• `/hunch resolve` — close out a market you created (admins can resolve any)\n" +
        "• `/hunch admin` — aggregated signal across your markets (admins see all)\n" +
        "• `/hunch leaderboard` — top 10 by hunch balance\n" +
        "• `/hunch reset confirm` — workspace admin: reset all balances, void open markets"
    ),
    CONTEXT(
      "🔒 Bets are anonymous. Aggregates show only after resolution. Everyone starts with 10,000 hunches."
    ),
  ];
}

// =============================================================================
// ONBOARDING — DM the installer + announce in #general on first install.
// =============================================================================

/**
 * DM sent to the installer immediately after OAuth completes. The job of
 * this card is to make the next step obvious: ask the team a question.
 * Three sample-market quick-creates make the first market a one-click
 * action; clicking any of them opens the create modal pre-filled.
 */
export function buildWelcomeDm(installerSlackUserId: string): KnownBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Welcome to Hunch.", emoji: false },
    },
    SECTION(
      `Hi <@${installerSlackUserId}> — Hunch lets your team ask thoughtful, anonymous questions and see what people actually believe.`
    ),
    SECTION(
      "*How it works.* Anyone asks a question. Your teammates commit play-money hunches to YES or NO. When the question resolves, winners take hunches from losers. The aggregate is hidden until resolution — that's what keeps it honest."
    ),
    DIVIDER,
    SECTION("*Try one of these to start:*"),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: {
            type: "plain_text",
            text: "Will we ship X by Y?",
            emoji: false,
          },
          action_id: "welcome_prefill_ship_by_date",
          value: "ship_by_date",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Will we hit our quarterly target?",
            emoji: false,
          },
          action_id: "welcome_prefill_quarterly_target",
          value: "quarterly_target",
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Will [external thing] happen by [date]?",
            emoji: false,
          },
          action_id: "welcome_prefill_external_event",
          value: "external_event",
        },
      ],
    },
    SECTION("Or write your own question:"),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Ask anything",
            emoji: false,
          },
          action_id: "welcome_create_blank",
        },
      ],
    },
    DIVIDER,
    CONTEXT(
      "🔒 Bets are anonymous. Aggregates show only after resolution. Everyone starts with 10,000 hunches."
    ),
    CONTEXT(
      "Run `/hunch help` any time to see all commands."
    ),
  ];
}

/**
 * Posted to the workspace's #general so teammates discover the bot.
 * Lower-key than the installer DM — short, points at the slash command.
 */
export function buildChannelAnnouncement(
  installerSlackUserId: string | undefined
): KnownBlock[] {
  const lead = installerSlackUserId
    ? `<@${installerSlackUserId}> just installed *Hunch*.`
    : "*Hunch* is here.";
  return [
    SECTION(
      `${lead} It's a way to ask the team a question and see what people actually believe — anonymously.`
    ),
    SECTION(
      "Try `/hunch create` to ask one. Try `/hunch me` to see your balance. Everyone starts with 10,000."
    ),
    CONTEXT(
      "Run `/hunch help` for the full command list."
    ),
  ];
}

// =============================================================================
// CREATE-MARKET MODAL
// =============================================================================

export interface CreateMarketPrefill {
  question?: string;
  criteria?: string;
  deadline?: number; // Unix timestamp in seconds
}

/**
 * Sample-market prefills used by the welcome DM quick-create buttons.
 * Keep these short, generic, and recognizable; the user is expected to
 * edit them before submitting.
 */
export const CREATE_MARKET_TEMPLATES: Record<string, CreateMarketPrefill> = {
  ship_by_date: {
    question: "Will we ship [feature] by [date]?",
    criteria:
      "Resolves YES if it's deployed to production users before the deadline. NO otherwise.",
  },
  quarterly_target: {
    question: "Will we hit our quarterly target this quarter?",
    criteria:
      "Resolves YES if we close the quarter at or above the target number. The number to compare against: [target].",
  },
  external_event: {
    question: "Will [external thing] happen by [date]?",
    criteria:
      "Resolves YES if [the named thing] is publicly confirmed before the deadline. NO otherwise.",
  },
};

export function buildCreateMarketModal(
  prefill: CreateMarketPrefill = {}
): import("@slack/bolt").View {
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
          ...(prefill.question ? { initial_value: prefill.question } : {}),
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
          ...(prefill.criteria ? { initial_value: prefill.criteria } : {}),
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
          type: "datetimepicker",
          action_id: "deadline_input",
          ...(prefill.deadline ? { initial_date_time: prefill.deadline } : {}),
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
