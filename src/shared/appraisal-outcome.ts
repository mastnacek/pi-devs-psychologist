/**
 * appraisal-outcome — the vocabulary of "did the appraiser run, and what happened".
 *
 * In `shared/` because the state kernel tracks the in-flight appraisal's promise and the command
 * slice renders its result, while the policy that produces it lives in the appraiser slice. The
 * concrete union cannot live in the slice, or `shared/state.ts` would have to import a slice —
 * which the vertical-slice rule forbids. So the contract is shared and the policy is a slice.
 *
 * Every path names why it did or did not run. "It didn't work" is not a diagnosis; a typed reason
 * is. `cost` is distinct from `budget`: `budget` is the session's count of appraisals, `cost` is the
 * money the agent runtime has spent against `agent.maxCostUsdPerSession` (T27).
 */

import type { Appraisal } from "./appraisal.js";
import type { DeliveryOutcome } from "./delivery.js";
import type { AgentCallStage, ModelCallStage } from "./model-call.js";

/** Why the appraiser did not run. */
export type SkipReason =
	| "disabled"
	| "headless"
	| "no_model"
	| "in_flight"
	| "cadence"
	| "no_trigger"
	/** This turn's appraisal was replaced by a scout run (T31): the two never run in the same turn. */
	| "scout"
	| "budget"
	/** The session agent cost cap is reached (T27). */
	| "cost";

export type AppraiseOutcome =
	| { ran: false; reason: SkipReason }
	| {
			ran: true;
			ok: true;
			appraisal: Appraisal;
			silent: boolean;
			unmatched: string[];
			downgraded: string[];
			modelRef: string;
			/** How the intervention reached the operator, and whether the agent was told. */
			delivery: DeliveryOutcome;
	  }
	| { ran: true; ok: false; stage: ModelCallStage | AgentCallStage | "parse"; error: string };