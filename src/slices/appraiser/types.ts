/**
 * appraiser/types — the injection seam of the appraiser policy.
 *
 * Split from `index.ts` so `ledger.ts` and `run.ts` can name the deps without importing the policy
 * file back (a cycle), and so the public surface stays re-exported from `index.ts` unchanged.
 *
 * The outcome union itself lives in `shared/appraisal-outcome.ts`: `shared/state.ts` tracks the
 * in-flight promise, and a shared module must never import a slice.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SourcePolicy } from "../../shared/appraisal-enforce.js";
import type { Appraisal } from "../../shared/appraisal.js";
import type { DeliveryOutcome } from "../../shared/delivery.js";
import type { AppraiseOutcome, SkipReason } from "../../shared/appraisal-outcome.js";
import type { SessionHistory } from "../../shared/history.js";
import type { callModel, ModelCallResult } from "../../shared/model-call.js";

export type { AppraiseOutcome, SkipReason } from "../../shared/appraisal-outcome.js";

/** Delivery options the appraiser passes through to the injected delivery policy. */
export interface AppraiserDeliveryOptions {
	evenIfSilent?: boolean;
	/** Turns since the run started; feeds the card's staleness header (T26). */
	staleTurns?: number;
}

export interface AppraiserDeps {
	/** Read the current session branch. Injected so the slice imports no other slice. */
	readHistory(ctx: ExtensionContext): SessionHistory;
	/** The one model call. Injected so tests can count and fake it. */
	callModel(
		registry: ExtensionContext["modelRegistry"],
		req: Parameters<typeof callModel>[1],
	): Promise<ModelCallResult>;
	/** Hand the intervention to a surface. Injected, so this slice knows no other slice. */
	deliver(
		pi: ExtensionAPI,
		state: import("../../shared/state.js").DevsPsychologistState,
		ctx: ExtensionContext,
		appraisal: Appraisal,
		options?: AppraiserDeliveryOptions,
	): Promise<DeliveryOutcome>;
	/**
	 * What a suggestion's `source` may be, for this machine (T25). Injected because the docs
	 * directory is resolved by the composition root and the notebook ids live in the config; this
	 * slice must not import either. Absent means "no docs dir, no notebooks".
	 */
	sourcePolicy?(): SourcePolicy;
}