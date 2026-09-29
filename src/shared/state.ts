/**
 * DevsPsychologistState — session-scoped kernel shared by the composition root and
 * every slice. One instance per session; nothing module-global, so concurrent or
 * mocked registrations stay isolated (and tests need no reset hook).
 *
 * The state holds the observation window and the last appraisal, and nothing about the
 * programmer. That is intentional and load-bearing: the plugin's only durable memory is a
 * bounded list of *events* plus a judgement that is always recomputed from them. A
 * judgement recomputed from evidence can be corrected by new evidence; a judgement written
 * down becomes a label.
 */

import { DEFAULT_CONFIG, GLOBAL_CONFIG_FILE, loadConfig, type DevsPsychologistConfig } from "./config.js";
import { DEFAULT_SIGNAL_OPTIONS, type Observation } from "./signals.js";
import { EMPTY_TRIGGER_BASELINE, type TriggerBaseline, type TriggerReason } from "./triggers.js";
import type { Appraisal } from "./appraisal.js";
import type { AppraiseOutcome } from "./appraisal-outcome.js";
import type { ForkConsent } from "./agent-context.js";
import type { OutcomeRecord } from "./outcome.js";
import type { UsageSummary } from "./model-call.js";
import type { RepoMapCache } from "./repo-map.js";
import {
	realTimerIo,
	type LastRunAccount,
	type PendingAppraisal,
	type TimerIo,
	type TimerToken,
} from "./run-account.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Re-exported so a caller can name the cached-catalog helper through `state.js` alone.
export { refreshModelCatalog } from "./model-catalog.js";
export type { LastRunAccount, PendingAppraisal, TimerIo, TimerToken } from "./run-account.js";

/** Tool call metadata captured at start, paired with its outcome at end. */
export interface PendingTool {
	toolName: string;
	command?: string;
	path?: string;
}

/** What enforcement did to the last appraisal, kept so the report can show its own doubts. */
export interface AppraisalNotes {
	/** Citations the model gave that matched no supplied evidence line. */
	unmatched: string[];
	/** Claims downgraded to neutral because nothing supported them. */
	downgraded: string[];
}

export interface DevsPsychologistState {
	// --- lifecycle plumbing ---
	unsubscribers: Array<() => void>;
	/** Retain a `pi.on()` return value; older engine typings declare it void. */
	track(result: unknown): void;

	// --- config ---
	config: DevsPsychologistConfig;
	/** Overridable so tests never write the developer's real ~/.pi/agent file. */
	globalFile: string;

	// --- observation window ---
	/** Events in append order. Index position is the clock for the signal fold. */
	observations: Observation[];
	/** In-flight tool calls, keyed by toolCallId, awaiting their end event. */
	pendingTools: Map<string, PendingTool>;
	/**
	 * Registered model references, `provider/modelId`, cached from the engine's registry.
	 *
	 * Cached because the completion callback receives only the argument prefix — it has no
	 * context — while `session_start` and the command handler both do. Populated at session
	 * start and refreshed whenever `/psych` runs, so adding an account mid-session is picked
	 * up by the next Tab press.
	 */
	modelCatalog: string[];
	/** Providers holding at least one catalog entry. The first level of the picker. */
	modelProviders: string[];

	// --- appraisal budget ---
	/**
	 * Appraisal ATTEMPTS this session, compared with config.maxAppraisalsPerSession.
	 * Attempts rather than successes: a call that fails may still have been billed, so
	 * counting only successes would let a broken model spend without limit.
	 */
	appraisalsThisSession: number;
	/** Completed turns since the last appraisal attempt, drives `config.cadenceTurns`. */
	turnsSinceAppraisal: number;
	/** Turns completed this session. The clock the outcome ledger measures its window against. */
	turnCount: number;
	/**
	 * `--psych-runtime` for this process. Kept apart from `config` so a config reload (every `/psych`
	 * setting command reloads) re-applies it instead of silently reverting to the persisted runtime.
	 * An explicit `/psych runtime` clears it: the operator's latest word wins.
	 */
	runtimeOverride: "api" | "agent" | undefined;
	/** True while an appraisal is in flight, so a slow model is not called twice. */
	appraisalInFlight: boolean;
	/** Last enforced appraisal, for the report. Never fed back into the observation log. */
	lastAppraisal: Appraisal | undefined;
	/** When the last attempt finished, ms epoch. */
	lastAppraisalAt: number | undefined;
	/** Last attempt's failure, when it failed — so silence is never unexplained. */
	/**
	 * Last attempt's failure, when it failed — so silence is never unexplained.
	 * `stage` decides whether the chip shouts: a configuration problem is worth showing
	 * persistently (only the operator can fix it), a transient one is not.
	 */
	lastAppraisalFailure: { stage: string; error: string } | undefined;
	/** Last appraisal's enforcement notes. */
	lastAppraisalNotes: AppraisalNotes | undefined;
	/**
	 * Intervention outcome ledger (T16). Restored from session entries on start; the reports read it,
	 * the anti-nag rule (T17) reads it, and it is the only memory of what was DELIVERED this session.
	 */
	outcomes: OutcomeRecord[];
	/**
	 * Counters captured at the last appraisal ATTEMPT (including a forced one). Every trigger is a
	 * delta against this, so the evidence that ran one appraisal cannot run the next.
	 */
	triggerBaseline: TriggerBaseline;
	/** Appraisals skipped because no trigger fired — the measured saving the report shows. */
	appraisalsSkipped: number;
	/** Reasons that fired the last appraisal, for the report. Empty until one fires. */
	lastTriggerReasons: TriggerReason[];
	/**
	 * Fingerprint keys (`toolName signature`) the scout has already run for this session (T31), so a
	 * recurring failure is scouted at most once rather than on every turn it keeps recurring.
	 */
	scoutDone: Set<string>;
	/**
	 * The git HEAD of the previous delivery, the anchor the reviewer diffs against (T32a). `""` until
	 * the first review, and updated after every review run so consecutive commits review the range
	 * since the last one.
	 */
	reviewLastHead: string;
	/** The git HEAD already reviewed this delivery, so a delivery is reviewed at most once (T32a). */
	reviewedHead: string;
	/**
	 * Token and cost figures for the last appraisal.
	 *
	 * Kept here because the engine cannot be told about the call: extensions get a
	 * `ReadonlySessionManager`, which has no `appendUsage`. The session's own cost meter
	 * therefore does NOT include appraisals, so the plugin reports its own spend itself.
	 */
	lastAppraisalUsage: UsageSummary | undefined;

	// --- agent runtime (T24) ---
	/**
	 * Facts about the live session the agent runtime needs to launch a child, captured at
	 * `session_start` where a real context exists. The appraiser's call seam is `(registry, req)`, so
	 * these cannot be re-read at call time without widening that seam.
	 */
	sessionCwd: string;
	/** `ctx.isProjectTrusted()` at session start; mirrored as `--approve`/`--no-approve`. */
	agentTrusted: boolean;
	/**
	 * The operator's answer to the fork confirm for this session (T29). `unknown` until the first
	 * fork run asks; read and written by `resolveAgentContext`. The parent session FILE is read at
	 * run time (not stored), because an ephemeral parent has none and a session can gain one later.
	 */
	agentForkConsent: ForkConsent;
	/** True once the fork → digest fallback has been announced; the notice fires at most once. */
	agentForkNotified: boolean;
	/** Summed cost (USD) of agent-runtime runs this session, compared with `agent.maxCostUsdPerSession`. */
	agentSessionCostUsd: number;
	/** Agent-runtime runs started this session, shown by the report (T27). */
	agentRunsThisSession: number;
	/** Kills the currently running child, or `undefined` when none is running. Idempotent. */
	agentChildKill: (() => void) | undefined;

	// --- async appraisal (T26) ---
	/**
	 * The in-flight appraisal. `turn_end` starts it and returns without awaiting; `/psych now`
	 * waits on it instead of starting a second one. The outcome union lives in shared so this
	 * kernel (which a slice may import) never has to reach into a slice.
	 */
	appraisalPromise: Promise<AppraiseOutcome> | undefined;
	/** An enforced appraisal waiting for the next pause, or `undefined`. Newest wins. */
	pendingAppraisal: PendingAppraisal | undefined;
	/** True between `agent_start` and `agent_end`; delivery is deferred while it holds. */
	agentStreaming: boolean;
	/** Aborts the in-flight API call or agent run (`/psych stop`, `session_shutdown`). */
	appraisalAbort: AbortController | undefined;
	/** When the current run started, for the researching chip. `undefined` when idle. */
	appraisalStartedAt: number | undefined;
	/** Tool calls the running child has made so far, for the researching chip. */
	appraisalToolCalls: number;
	/** The researching chip's interval handle, or `undefined`. */
	chipTimer: TimerToken | undefined;

	// --- accounting (T27) ---
	/** Metadata of the last appraiser run, for the report's "Last run" block. */
	lastRun: LastRunAccount | undefined;
	/**
	 * The objective repo map (T8): its facts, its citable lines and which turn computed it. Computed
	 * ONCE per cwd and reused, so the walk never runs on the hot path. `undefined` before the first
	 * eligible point; reset with the session window.
	 */
	repoMap: RepoMapCache | undefined;
	/** The clock the researching chip reads; injectable so tests need no real timers. */
	timers: TimerIo;

	// --- helpers ---
	ifLive(cb: () => void): void;
	/** Append an observation, evicting the oldest beyond the retention bound. */
	observe(observation: Observation): void;
	/** Drop the window and the appraisal. Called on session start so a new session reads clean. */
	resetWindow(): void;
	/** True when another appraisal attempt is allowed by the session budget. */
	budgetAvailable(): boolean;
}

export function createDevsPsychologistState(_pi: ExtensionAPI): DevsPsychologistState {
	const unsubscribers: Array<() => void> = [];
	const track = (result: unknown): void => {
		if (typeof result === "function") unsubscribers.push(result as () => void);
	};
	const ifLive = (cb: () => void): void => {
		try {
			cb();
		} catch {
			// Session closed or UI unavailable.
		}
	};
	const state: DevsPsychologistState = {
		unsubscribers,
		track,
		config: { ...DEFAULT_CONFIG },
		globalFile: GLOBAL_CONFIG_FILE,
		observations: [],
		pendingTools: new Map(),
		modelCatalog: [],
		modelProviders: [],
		appraisalsThisSession: 0,
		turnsSinceAppraisal: 0,
		turnCount: 0,
		runtimeOverride: undefined,
		appraisalInFlight: false,
		lastAppraisal: undefined,
		lastAppraisalAt: undefined,
		lastAppraisalFailure: undefined,
		lastAppraisalNotes: undefined,
		lastAppraisalUsage: undefined,
		sessionCwd: process.cwd(),
		agentTrusted: false,
		agentForkConsent: "unknown",
		agentForkNotified: false,
		agentSessionCostUsd: 0,
		agentRunsThisSession: 0,
		agentChildKill: undefined,
		appraisalPromise: undefined,
		pendingAppraisal: undefined,
		agentStreaming: false,
		appraisalAbort: undefined,
		appraisalStartedAt: undefined,
		appraisalToolCalls: 0,
		chipTimer: undefined,
		lastRun: undefined,
		repoMap: undefined,
		timers: realTimerIo(),
		outcomes: [],
		triggerBaseline: { ...EMPTY_TRIGGER_BASELINE },
		appraisalsSkipped: 0,
		lastTriggerReasons: [],
		scoutDone: new Set(),
		reviewLastHead: "",
		reviewedHead: "",
		ifLive,
		observe(observation) {
			state.observations.push(observation);
			// A `while` rather than an `if`: a misconfigured bound must not be able to leave
			// the window over its limit.
			const limit = Math.max(1, state.config.retainObservations);
			while (state.observations.length > limit) state.observations.shift();
		},
		resetWindow() {
			state.observations = [];
			state.pendingTools.clear();
			state.turnsSinceAppraisal = 0;
			state.turnCount = 0;
			state.outcomes = [];
			state.lastAppraisal = undefined;
			state.lastAppraisalAt = undefined;
			state.lastAppraisalFailure = undefined;
			state.lastAppraisalNotes = undefined;
			state.lastAppraisalUsage = undefined;
			state.triggerBaseline = { ...EMPTY_TRIGGER_BASELINE };
			state.appraisalsSkipped = 0;
			state.lastTriggerReasons = [];
			state.scoutDone = new Set();
			state.reviewLastHead = "";
			state.reviewedHead = "";
			// The agent-runtime cost is per session; the run itself is owned by the child handle, which
			// `session_shutdown` kills before it drains.
			state.agentSessionCostUsd = 0;
			state.agentRunsThisSession = 0;
			// Consent is a session decision: a new session asks again (T29).
			state.agentForkConsent = "unknown";
			state.agentForkNotified = false;
			state.lastRun = undefined;
			state.pendingAppraisal = undefined;
			// A new session starts at a possibly different cwd, so the map is recomputed on first use.
			state.repoMap = undefined;
		},
		budgetAvailable() {
			const cap = state.config.maxAppraisalsPerSession;
			// 0 is unlimited, and it is the only way to reach that behaviour.
			return cap === 0 || state.appraisalsThisSession < cap;
		},
	};
	return state;
}

/** Reload the cascading config for a session rooted at `cwd`. */
export function reloadConfig(state: DevsPsychologistState, cwd?: string): void {
	state.config = loadConfig(cwd, state.globalFile);
	if (state.runtimeOverride) state.config.runtime = state.runtimeOverride;
}

/**
 * Restore the last appraisal from the session's TUI-only entries (T7, minimal slice).
 *
 * The appraisal is stored on a `custom` entry (`customType: "psych-appraisal"`), which the engine
 * never folds into model context. Restoring it here means `/reload` and compaction keep `/psych`
 * honest, and — deliberately — the restored text contributes ZERO observations: the appraisal is
 * the plugin's own judgement, not a session event, and re-observing it would corrupt every signal
 * that counts prompts.
 */
export function restoreAppraisal(
	state: DevsPsychologistState,
	entries: readonly { type?: string; customType?: string; data?: unknown }[] | undefined,
): void {
	let restored: Appraisal | undefined;
	for (const entry of entries ?? []) {
		if (entry?.type !== "custom" || entry.customType !== "psych-appraisal") continue;
		if (entry.data === null || typeof entry.data !== "object") continue;
		restored = entry.data as Appraisal;
	}
	if (restored) state.lastAppraisal = restored;
}

/** Effective signal options for the current config. */
export function signalOptions(state: DevsPsychologistState): {
	restatementThreshold: number;
	unscopedWordFloor: number;
	idleGapMs: number;
	maxObservations: number;
	commitCheck: boolean;
} {
	return {
		restatementThreshold: state.config.restatementThreshold,
		unscopedWordFloor: state.config.unscopedWordFloor,
		idleGapMs: state.config.idleGapMs,
		maxObservations: DEFAULT_SIGNAL_OPTIONS.maxObservations,
		commitCheck: state.config.commitCheck,
	};
}