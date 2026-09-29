/**
 * appraiser — the policy that decides when the psychologist is asked, and the delivery of
 * whatever it says.
 *
 * Three rules make this the plugin's cost boundary, and all three are attempts-based rather
 * than successes-based:
 *
 * - **The budget counts attempts.** A call that fails may still have been billed, so
 *   counting only successes would let a broken model spend without limit.
 * - **The cadence resets on an attempt too.** Otherwise a model that fails every time would
 *   be retried on every single turn, which is a spend loop rather than an observer.
 * - **Single-flight.** A slow model must not be asked twice because the next turn arrived
 *   while it was thinking.
 *
 * Every path returns a typed outcome naming why it did or did not run. "It didn't work" is
 * not a diagnosis; `{ ran: false, reason: "cadence" }` is.
 *
 * The async boundaries (T26) are the point of this file's split: `turn_end` STARTS the run and
 * returns without awaiting it (the promise is kept in state), a finished result that arrives while
 * the agent is streaming is HELD until the next pause, and the researching chip runs on an
 * injectable clock. The mechanics live in `./run.ts`; the ledger lives in `./ledger.ts`; the
 * injection seam lives in `./types.ts`.
 *
 * Dependencies are injected rather than imported by this slice: the model call, the history
 * read and the notification all come from the composition root. That is what lets the whole
 * policy be tested with a fake that counts calls, so "exactly three calls over thirty turns"
 * is an assertion rather than a hope.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseAppraisal, isSilent } from "../../shared/appraisal-enforce.js";
import { callModel, summarizeUsage } from "../../shared/model-call.js";
import { allowedEvidence, buildUserText, SYSTEM_PROMPT } from "../../shared/prompt.js";
import { environmentEvidence } from "../../shared/environment.js";
import { extractSignals } from "../../shared/signals.js";
import { coolingKinds, doNotRepeatLines, mutedKinds } from "../../shared/outcome.js";
import { evaluateTriggers, snapshotTriggers, type TriggerReason } from "../../shared/triggers.js";
import { signalOptions, type DevsPsychologistState } from "../../shared/state.js";
import { paintChip, startResearchingChip, stopResearchingChip } from "../../shared/status.js";
import { flushFlowShield } from "../../shared/flow-shield.js";
import { STALE_DELIVERY_TURNS, type DeliveryOutcome } from "../../shared/delivery.js";
import { effectiveAgentModel } from "../../shared/config.js";
import { SCOUT_TRIGGER_MIN_COUNT, topRecurringTopic } from "../../shared/scout.js";
import { resolveAgentContext } from "../../shared/agent-context.js";
import { buildRunAccount } from "../../shared/run-account.js";
import type { AppraiserDeps, AppraiseOutcome } from "./types.js";
import { recordDelivery, settleOutcomes } from "./ledger.js";
import { flushPendingAppraisal, kickAppraisal } from "./run.js";

export type { AppraiseOutcome, SkipReason, AppraiserDeps } from "./types.js";
export { flushPendingAppraisal, kickAppraisal, stopAppraisal, abortAppraisal } from "./run.js";

/** An appraisal response is a small JSON object; the cap is a spend guard, not a need. */
export const APPRAISAL_MAX_TOKENS = 1200;

/** The real dependencies. Called only from the composition root. */
export function defaultDeps(
	readHistory: AppraiserDeps["readHistory"],
	deliver: AppraiserDeps["deliver"],
	/** The runtime choice, injected by the composition root (T24). Defaults to today's API call. */
	callModelImpl: AppraiserDeps["callModel"] = (registry, req) => callModel(registry, req),
	/** The suggestion source policy (T25); absent means only URLs and install specs are valid. */
	sourcePolicy?: AppraiserDeps["sourcePolicy"],
): AppraiserDeps {
	// `callModel` is the seam: the appraiser never learns which runtime ran, and the API call is the
	// default (D1). The composition root swaps in the agent runner and branches on `state.config.runtime`.
	return { readHistory, callModel: callModelImpl, deliver, sourcePolicy };
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** True when a model is resolvable for the effective runtime. The agent runtime may name its own. */
function hasModel(state: DevsPsychologistState): boolean {
	if (state.config.runtime === "agent") return effectiveAgentModel(state.config).trim().length > 0;
	return state.config.model.trim().length > 0;
}

/**
 * Decide whether to appraise now, and do it.
 *
 * Runs on `turn_end`, but never assumes it is the only thing happening: the flag is set before any
 * await and cleared in a `finally`. The `turn_end` registration does NOT await this — see
 * `registerAppraiser`.
 */
export async function maybeAppraise(
	pi: ExtensionAPI,
	state: DevsPsychologistState,
	ctx: ExtensionContext,
	deps: AppraiserDeps,
	options: { force?: boolean } = {},
): Promise<AppraiseOutcome> {
	const force = options.force === true;
	if (!state.config.enabled) return { ran: false, reason: "disabled" };
	// No human to read it, and this is the plugin's only spend. json/print modes have no UI,
	// so an appraisal there would cost money for a report nobody can see.
	if (!ctx.hasUI) return { ran: false, reason: "headless" };
	if (!hasModel(state)) return { ran: false, reason: "no_model" };
	if (state.appraisalInFlight) return { ran: false, reason: "in_flight" };
	// `force` is the operator asking explicitly (`/psych now`), which is a different question
	// from the cadence. It never bypasses the budget: a hard ceiling is a hard ceiling, and
	// silently exceeding it on request would make the number meaningless.
	if (!force && state.turnsSinceAppraisal < state.config.cadenceTurns) {
		return { ran: false, reason: "cadence" };
	}
	if (!state.budgetAvailable()) return { ran: false, reason: "budget" };
	// Session agent cost cap (T27): refused BEFORE spawning, so no child pi starts and no money is
	// spent. `cost` is distinct from `budget` (a count): one is dollars, the other is attempts.
	if (state.config.runtime === "agent") {
		const cap = state.config.agent.maxCostUsdPerSession;
		if (cap > 0 && state.agentSessionCostUsd >= cap) return { ran: false, reason: "cost" };
	}

	state.appraisalInFlight = true;
	// The chip switches to "researching" and ticks at most once per second (T26). Started here so
	// both the API call and the agent run are covered; stopped in `finally` and on shutdown.
	startResearchingChip(state, ctx);
	const startedAt = Date.now();
	const startedTurn = state.turnCount;

	// One controller aborts whatever runtime runs: `/psych stop` aborts it, and the session's own
	// signal is forwarded into it, so an operator cancellation or a shutdown ends the run too.
	const abort = new AbortController();
	state.appraisalAbort = abort;
	const ctxSignal = ctx.signal;
	const forwardAbort = () => abort.abort();
	if (ctxSignal) {
		if (ctxSignal.aborted) abort.abort();
		else ctxSignal.addEventListener("abort", forwardAbort, { once: true });
	}

	try {
		const signals = extractSignals(state.observations, signalOptions(state));
		const history = deps.readHistory(ctx);

		// The trigger gate (D7). Under `signals` the model runs only when the evidence carries
		// something new since the last attempt; `force` (the operator asked) bypasses it, and
		// `cadence` mode skips the gate entirely and behaves exactly as the old clock did.
		let firedReasons: TriggerReason[] = [];
		if (!force && state.config.trigger === "signals") {
			const evaluated = evaluateTriggers(
				{ signals, history },
				state.triggerBaseline,
				state.config.triggerThresholds,
			);
			if (!evaluated.fire) {
				state.appraisalsSkipped += 1;
				return { ran: false, reason: "no_trigger" };
			}
			firedReasons = evaluated.reasons;
			state.lastTriggerReasons = firedReasons;
		}

		// Scout (T31): a recurring friction at count ≥ 3, on the agent runtime with the scout role
		// enabled, replaces this turn's appraisal — never both in one turn. The appraiser owns the
		// budget, the baseline move and the once-per-session guard; the slice owns the run.
		if (!force && state.config.runtime === "agent" && state.config.roles.scout.enabled && deps.runScout) {
			const pick = topRecurringTopic(signals.failureFingerprints, SCOUT_TRIGGER_MIN_COUNT);
			if (pick && firedReasons.includes("recurring_failure") && !state.scoutDone.has(pick.key)) {
				state.scoutDone.add(pick.key);
				state.appraisalsThisSession += 1;
				state.turnsSinceAppraisal = 0;
				state.triggerBaseline = snapshotTriggers({ signals, history });
				await deps.runScout(ctx, pick.topic);
				return { ran: false, reason: "scout" };
			}
		}

		// Counted before the call, and the cadence restarts here: both are about *attempts*.
		state.appraisalsThisSession += 1;
		state.turnsSinceAppraisal = 0;
		// Baseline on EVERY attempt (a forced one included), so the evidence that caused this
		// appraisal cannot cause the next one.
		state.triggerBaseline = snapshotTriggers({ signals, history });

		// The environment lines join the SESSION block, not the LIVE one: they describe the
		// machine the session ran on, not the window that just elapsed, and mixing the two
		// would let the model read a stale flag as a fresh observation. The repo map (T8) is
		// the same kind of fact — the shape of the codebase, not this turn's activity — so it
		// joins SESSION too and is cached, not recomputed.
		const sessionLines = [
			...history.evidence,
			...(state.config.envFacts ? environmentEvidence({ cwd: ctx.cwd }) : []),
			...(deps.repoMap ? deps.repoMap(state, ctx.cwd) : []),
		];
		// One LIVE line per cooling/muted kind (T17), so the model is never asked to repeat advice this
		// session already proved useless. It joins `signals.evidence`, so it reaches the prompt AND
		// `allowedEvidence` through the same `liveLines` list — the two must stay identical sets.
		const coolingLines = doNotRepeatLines(state.outcomes, state.turnCount, state.config.cooldownTurns);
		// One LIVE line naming what fired, so the reason for the appraisal is itself citable
		// evidence. It is added to the live block, so it reaches both the prompt and enforcement.
		const liveLines = [
			...signals.evidence,
			...(firedReasons.length > 0 ? [`appraisal triggered by: ${firedReasons.join(", ")}`] : []),
			...coolingLines,
		];
		// `allowedEvidence` is what enforcement matches citations against, so the environment
		// lines must be in BOTH: offered to the model and admissible as proof. Adding them to
		// only one of the two produces the worst possible failure — a verdict the model was
		// told to make and is then punished for making.
		const lines = allowedEvidence(liveLines, sessionLines);
		const modelRef = state.config.model;

		// Session context (T28/T29) is agent-runtime only. The decision is made here, where a real
		// context exists, because `fork` needs consent and the session FILE read at run time; the API
		// runtime never reaches this branch, so its request stays byte-identical (D2).
		let agentContext = state.config.agent.context;
		let digest: string | undefined;
		let parentSessionFile: string | undefined;
		if (state.config.runtime === "agent" && state.config.agent.context !== "evidence") {
			const resolved = await resolveAgentContext(state, ctx);
			agentContext = resolved.context;
			digest = resolved.digest;
			parentSessionFile = resolved.parentSessionFile;
		}

		const result = await deps.callModel(ctx.modelRegistry, {
			modelRef,
			systemPrompt: SYSTEM_PROMPT,
			userText: buildUserText(liveLines, sessionLines),
			maxTokens: APPRAISAL_MAX_TOKENS,
			// No temperature and no reasoning overrides: an observer must not request sampling
			// settings a provider may reject. The call's job is to be boringly repeatable.
			signal: abort.signal,
			// The agent runtime (T24) needs the evidence lines apart from `userText` to rebuild the
			// child's message via `buildAgentBrief` (D2). The API path ignores this field entirely, so
			// the bytes it sends are unchanged: `userText` remains authoritative there.
			evidence: { liveLines, sessionLines },
			...(state.config.runtime === "agent"
				? {
						agentContext,
						...(digest ? { digest } : {}),
						...(parentSessionFile ? { parentSessionFile } : {}),
					}
				: {}),
		});

		// Accounting (T27) is recorded for BOTH runtimes and for success and failure alike: the
		// report's "Last run" block must describe the run that actually happened, not the last good one.
		const usage = summarizeUsage(result.ok === true ? result.usage : undefined);
		state.lastRun = buildRunAccount({
			runtime: state.config.runtime,
			model: state.config.runtime === "agent" ? effectiveAgentModel(state.config) : modelRef,
			context: state.config.runtime === "agent" ? state.config.agent.context : "evidence",
			durationMs: Date.now() - startedAt,
			toolCounts: result.run?.toolCounts,
			inputTokens: usage?.input,
			outputTokens: usage?.output,
			costUsd: result.run?.costUsd ?? usage?.cost,
			stage: result.ok === false ? result.stage : "ok",
		});

		// `=== false` rather than `!result.ok`: truthiness narrowing is not reliable under
		// `strict: false`, and a union that silently fails to narrow is a type check that
		// reads as passing while proving nothing.
		if (result.ok === false) {
			state.lastAppraisalFailure = { stage: result.stage, error: result.error };
			return { ran: true, ok: false, stage: result.stage, error: result.error };
		}

		// The engine cannot be told about this call, so the plugin keeps its own figures.
		state.lastAppraisalUsage = summarizeUsage(result.usage);

		const parsed = parseAppraisal(result.text, lines, deps.sourcePolicy?.());
		if (parsed.ok === false) {
			state.lastAppraisalFailure = { stage: "parse", error: parsed.error };
			return { ran: true, ok: false, stage: "parse", error: parsed.error };
		}

		// Anti-nag (T17): a kind still cooling (delivered < cooldownTurns ago) or muted (tried twice
		// with no improvement) is dropped before delivery. The prompt already warned the model off it;
		// this is the enforcement for when it ignores the warning. The VERDICTS are kept — only the
		// repeat advice is refused — and the drop is recorded so `/psych` can show the restraint.
		const candidate = parsed.appraisal.interventions[0];
		const refused =
			candidate !== undefined &&
			(mutedKinds(state.outcomes).has(candidate.kind) ||
				coolingKinds(state.outcomes, state.turnCount, state.config.cooldownTurns).has(candidate.kind));
		if (refused) {
			parsed.appraisal.interventions = [];
			parsed.downgraded.push("cooldown");
		}

		state.lastAppraisal = parsed.appraisal;
		state.lastAppraisalAt = Date.now();
		state.lastAppraisalNotes = { unmatched: parsed.unmatched, downgraded: parsed.downgraded };
		state.lastAppraisalFailure = undefined;
		// Minimal T7: the appraisal is a TUI-only entry, so `/reload` keeps the report while the
		// judgement never re-enters model context or the observation window.
		pi.appendEntry("psych-appraisal", parsed.appraisal);

		const silent = isSilent(parsed.appraisal);
		// How far the session moved while the model was thinking (T26). Recorded at delivery so the
		// card can say it describes a window that has since moved on.
		const staleTurns = state.turnCount - startedTurn;
		let delivery: DeliveryOutcome = { human: "none", agent: false, reason: "silent" };
		if (!force && state.agentStreaming) {
			// Hold until the next pause: a finished result must not interrupt the working agent. The
			// single slot means a newer result replaces an older held one — newest wins.
			state.pendingAppraisal = { appraisal: parsed.appraisal, evenIfSilent: false, startedTurn };
			delivery = { human: "none", agent: false, reason: "held" };
		} else {
			const cardOpenedAt = Date.now();
			try {
				// `force` means the operator asked, so the analysis is shown even when it has no advice
				// to give. An automatic appraisal keeps its silence.
				delivery = await deps.deliver(pi, state, ctx, parsed.appraisal, {
					evenIfSilent: force,
					...(staleTurns >= STALE_DELIVERY_TURNS ? { staleTurns } : {}),
				});
			} catch {
				// A delivery failure must not fail the turn: the appraisal is already stored.
			}
			// Outcome ledger (T16): record only a delivery the operator actually saw. The window's
			// `before` snapshot is the one computed for this turn, so the verdict cannot drift from the
			// evidence the model read.
			recordDelivery(pi, state, signals, history, parsed.appraisal.interventions[0], delivery, cardOpenedAt);
		}

		return {
			ran: true,
			ok: true,
			appraisal: parsed.appraisal,
			silent,
			unmatched: parsed.unmatched,
			downgraded: parsed.downgraded,
			modelRef,
			delivery,
		};
	} catch (error) {
		const message = describe(error);
		state.lastAppraisalFailure = { stage: "request", error: message };
		return { ran: true, ok: false, stage: "request", error: message };
	} finally {
		state.appraisalInFlight = false;
		if (state.appraisalAbort === abort) state.appraisalAbort = undefined;
		ctxSignal?.removeEventListener?.("abort", forwardAbort);
		stopResearchingChip(state);
		state.ifLive(() => paintChip(state, ctx));
	}
}

/**
 * Subscribe the appraiser.
 *
 * `turn_end` STARTS the run and returns immediately (T26): the promise is kept in state, so the
 * session is never blocked on a model that takes tens of seconds. Delivery waits for a pause:
 * `agent_start`/`agent_end` mark streaming, and a result that lands mid-stream is flushed when the
 * agent settles. `session_shutdown` drains everything.
 *
 * The `SessionSignals`/`Appraisal` types are used only through their imports above; the handler list
 * is deliberately the minimum the engine needs.
 */
export function registerAppraiser(
	pi: ExtensionAPI,
	state: DevsPsychologistState,
	deps: AppraiserDeps,
): void {
	state.track(
		pi.on("turn_end", async (_event, ctx) => {
			// Fire-and-forget: never await the appraisal here.
			kickAppraisal(state, () => maybeAppraise(pi, state, ctx, deps));
			// Outcome windows close on the same event, so a record proves itself even on a turn the
			// trigger rule skipped the model entirely.
			settleOutcomes(pi, state, ctx, deps);
		}),
	);
	state.track(
		pi.on("agent_start", () => {
			state.agentStreaming = true;
		}),
	);
	state.track(
		pi.on("agent_end", async (_event, ctx) => {
			state.agentStreaming = false;
			await flushPendingAppraisal(pi, state, ctx, deps);
			// Release anything the flow shield held, now that the agent has paused (idea 6).
			await flushFlowShield(state, ctx);
		}),
	);
}

// `settleOutcomes` and `recordDelivery` live in `./ledger.ts`; re-exported for the composition root
// and the tests that import the slice barrell.
export { recordDelivery, settleOutcomes } from "./ledger.js";