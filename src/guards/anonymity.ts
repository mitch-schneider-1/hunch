// Anonymity gate for aggregated/exec-facing surfaces.
//
// Below this many DISTINCT bettors, a "62% YES, 4 YES / 1 NO" breakdown plus
// social knowledge of a small team is enough to infer who bet which side.
// So any surface that reveals the aggregate, stake split, concentration, or
// rationales must withhold them until at least this many distinct people have
// weighed in.
export const MIN_BETTORS_FOR_DETAIL = 5;

// Above this share of total stake held by a single participant, the aggregate
// is "driven by one large position" and the exec view flags it.
export const CONCENTRATION_FLAG_THRESHOLD = 0.4;
