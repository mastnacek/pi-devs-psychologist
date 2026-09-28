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
import type { OutcomeRecord } from "./outcome.js";
import type { UsageSummary } from "./model-call.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
	/** `ctx.sessionManager.getSessionFile()`; required for `context: "fork"`. */
	agentSessionFile: string | undefined;
	/** Summed cost (USD) of agent-runtime runs this session, compared with `agent.maxCostUsdPerSession`. */
	agentSessionCostUsd: number;
	/** Kills the currently running child, or `undefined` when none is running. Idempotent. */
	agentChildKill: (() => void) | undefined;

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
		agentSessionFile: undefined,
		agentSessionCostUsd: 0,
		agentChildKill: undefined,
		outcomes: [],
		triggerBaseline: { ...EMPTY_TRIGGER_BASELINE },
		appraisalsSkipped: 0,
		lastTriggerReasons: [],
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
			// The agent-runtime cost is per session; the run itself is owned by the child handle, which
			// `session_shutdown` kills before it drains.
			state.agentSessionCostUsd = 0;
		},
		budgetAvailable() {
			const cap = state.config.maxAppraisalsPerSession;
			// 0 is unlimited, and it is the only way to reach that behaviour.
			return cap === 0 || state.appraisalsThisSession < cap;
		},
	};
	return state;
}

/**
 * The synchronous slice of the model registry this plugin reads.
 *
 * Structural rather than an import of the engine's class, so the cache can be tested against a
 * fake catalog without standing up a registry.
 */
export interface ModelCatalogSource {
	getAvailable(): readonly ModelRefLike[];
	getAll(): readonly ModelRefLike[];
}

export interface ModelRefLike {
	provider?: unknown;
	id?: unknown;
}

/**
 * Refresh the cached catalog from the registry.
 *
 * Prefers models whose providers have complete auth — the ones this plugin could actually call —
 * and falls back to the whole catalog when nothing is configured yet, so the picker still teaches
 * what exists instead of being empty. Every entry comes from the registry and none is invented, so
 * a completed value is always a model the engine can resolve.
 *
 * Deliberately not called from `resetWindow`: the catalog is not session-window state and must
 * survive the reset that every session start performs.
 */
export function refreshModelCatalog(
	state: DevsPsychologistState,
	registry: ModelCatalogSource | undefined,
): void {
	if (!registry) return;
	const collect = (read: () => readonly ModelRefLike[]): readonly ModelRefLike[] => {
		try {
			return read() ?? [];
		} catch {
			// A registry that cannot answer is treated as empty, never as a crash.
			return [];
		}
	};
	let models = collect(() => registry.getAvailable());
	if (models.length === 0) models = collect(() => registry.getAll());

	const refs = new Set<string>();
	const providers = new Set<string>();
	for (const model of models) {
		const provider = model?.provider;
		const id = model?.id;
		if (typeof provider !== "string" || provider.length === 0) continue;
		if (typeof id !== "string" || id.length === 0) continue;
		refs.add(provider + "/" + id);
		providers.add(provider);
	}
	state.modelCatalog = [...refs].sort();
	state.modelProviders = [...providers].sort();
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