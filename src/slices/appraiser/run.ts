/**
 * appraiser/run — the async mechanics of an appraisal (T26).
 *
 * Split from `index.ts` by concept (and to keep each file under the line budget): `index.ts` is the
 * policy (when to run, what to store), this is what happens to a run in flight — starting it without
 * blocking the turn, holding a finished result until the agent pauses, and stopping it on request.
 *
 * It imports no policy function of its own: `kickAppraisal` takes the run as a callback, so this
 * module never depends back on `index.ts` (which imports it) and the two stay acyclic.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { STALE_DELIVERY_TURNS, type DeliveryOutcome } from "../../shared/delivery.js";
import { extractSignals } from "../../shared/signals.js";
import { signalOptions, type DevsPsychologistState } from "../../shared/state.js";
import { recordDelivery } from "./ledger.js";
import type { AppraiseOutcome, AppraiserDeps } from "./types.js";

/**
 * Start an appraisal without awaiting it, so `turn_end` returns immediately (T26).
 *
 * The promise is kept in state: single-flight is unchanged (a second turn while one is running does
 * nothing), and `/psych now` can wait on the in-flight one instead of starting another. The slot is
 * cleared only for the promise it still owns, so a fast run cannot erase a newer one's handle.
 */
export function kickAppraisal(
	state: DevsPsychologistState,
	run: () => Promise<AppraiseOutcome>,
): void {
	if (state.appraisalPromise) return;
	const promise = run();
	state.appraisalPromise = promise;
	const clear = () => {
		if (state.appraisalPromise === promise) state.appraisalPromise = undefined;
	};
	// `then(clear, clear)` rather than `.finally`: the clear must run on rejection too, and a derived
	// promise from `.finally` would itself need a rejection handler.
	promise.then(clear, clear);
}

/**
 * Present a held appraisal at a natural pause (T26).
 *
 * Called from `agent_end`. The staleness is recomputed at flush time, so a result that waited
 * several turns says how old it is rather than pretending it is current. Recording the ledger here
 * (not at hold time) keeps the delivered-at turn honest.
 */
export async function flushPendingAppraisal(
	pi: ExtensionAPI,
	state: DevsPsychologistState,
	ctx: ExtensionContext,
	deps: AppraiserDeps,
): Promise<void> {
	const pending = state.pendingAppraisal;
	if (!pending) return;
	state.pendingAppraisal = undefined;

	const staleTurns = state.turnCount - pending.startedTurn;
	const signals = extractSignals(state.observations, signalOptions(state));
	const history = deps.readHistory(ctx);
	const cardOpenedAt = Date.now();
	let delivery: DeliveryOutcome = { human: "none", agent: false, reason: "silent" };
	try {
		delivery = await deps.deliver(pi, state, ctx, pending.appraisal, {
			evenIfSilent: pending.evenIfSilent,
			...(staleTurns >= STALE_DELIVERY_TURNS ? { staleTurns } : {}),
		});
	} catch {
		// A delivery failure must not fail the turn: the appraisal is already stored.
	}
	recordDelivery(pi, state, signals, history, pending.appraisal.interventions[0], delivery, cardOpenedAt);
}

/**
 * Release every resource a run owns, without touching the failure record. Used by `session_shutdown`
 * (idempotent) and by `stopAppraisal`.
 */
export function abortAppraisal(state: DevsPsychologistState): void {
	state.pendingAppraisal = undefined;
	state.agentChildKill?.();
	state.agentChildKill = undefined;
	state.appraisalAbort?.abort();
}

/**
 * `/psych stop` (T26): kill the running run and record the failure as `aborted`.
 *
 * Returns whether anything was running, so the command can say "nothing is running" rather than
 * claim a stop that did nothing.
 */
export function stopAppraisal(state: DevsPsychologistState, message: string): boolean {
	const running =
		state.appraisalInFlight || state.agentChildKill !== undefined || state.pendingAppraisal !== undefined;
	if (!running) return false;
	abortAppraisal(state);
	state.lastAppraisalFailure = { stage: "aborted", error: message };
	return true;
}