/**
 * cost — the estimated price of one appraisal, for the model picker.
 *
 * A picker that lists a hundred models and says nothing about their price is a picker that
 * invites an expensive typo. The estimate is arithmetic: an assumed prompt size (overridable,
 * because the real prompt grows with the session) times the model's registry rate per million
 * tokens. Registry rates are per MILLION tokens (`ModelCostRates`).
 *
 * Nothing here is a guess about a model whose rate is unknown: an absent or non-numeric rate
 * yields `undefined`, and the picker says "price unknown" rather than inventing one.
 */

/** The assumed size of one appraisal prompt, in tokens. */
export interface TokenEstimate {
	input: number;
	output: number;
}

/** Default estimate: a bounded system prompt plus the evidence, and a small JSON answer. */
export const DEFAULT_ESTIMATE_TOKENS: TokenEstimate = { input: 1500, output: 400 };

/** The registry rate shape this module reads, per million tokens. */
export interface ModelCostRates {
	input?: unknown;
	output?: unknown;
}

/**
 * Estimated USD for one appraisal, or `undefined` when the rate is unknown.
 *
 * A known rate of `0` (a free model) legitimately yields `0`, which is not the same fact as an
 * unknown rate — hence the explicit `undefined` rather than a falsy check.
 */
export function appraisalCostUsd(cost: ModelCostRates | undefined, tokens: TokenEstimate): number | undefined {
	if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") return undefined;
	if (!Number.isFinite(cost.input) || !Number.isFinite(cost.output)) return undefined;
	const usd = (tokens.input / 1_000_000) * cost.input + (tokens.output / 1_000_000) * cost.output;
	return Number.isFinite(usd) ? usd : undefined;
}
