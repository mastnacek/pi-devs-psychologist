/**
 * DevsPsychologistState — session-scoped kernel shared by the composition root
 * and every slice. One instance per session; nothing module-global, so
 * concurrent or mocked registrations stay isolated (and tests need no reset
 * hook).
 *
 * The state holds the observation window and nothing about the programmer. That
 * is intentional and load-bearing: the plugin's only durable memory of the
 * session is a bounded list of *events*, never a stored judgement about a
 * person. A judgement recomputed from events can be corrected by new evidence;
 * a judgement written down becomes a label.
 */

import { DEFAULT_CONFIG, GLOBAL_CONFIG_FILE, loadConfig, type DevsPsychologistConfig } from "./config.js";
import { DEFAULT_SIGNAL_OPTIONS, type Observation } from "./signals.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Tool call metadata captured at start, paired with its outcome at end. */
export interface PendingTool {
	toolName: string;
	command?: string;
	path?: string;
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

	// --- appraisal budget ---
	/** Appraisals formed this session; compared with config.maxAppraisalsPerSession. */
	appraisalsThisSession: number;
	/** Completed turns since the last appraisal, drives `config.cadenceTurns`. */
	turnsSinceAppraisal: number;
	/** True while an appraisal is in flight, so a slow model is not called twice. */
	appraisalInFlight: boolean;
	/** Last appraisal text, for the report. Never fed back into the observation log. */
	lastAppraisal: string | undefined;

	// --- helpers ---
	ifLive(cb: () => void): void;
	/** Append an observation, evicting the oldest beyond the retention bound. */
	observe(observation: Observation): void;
	/** Drop the window. Called on session start so a new session reads clean. */
	resetWindow(): void;
	/** True when another appraisal is allowed by the session budget. */
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
		appraisalsThisSession: 0,
		turnsSinceAppraisal: 0,
		appraisalInFlight: false,
		lastAppraisal: undefined,
		ifLive,
		observe(observation) {
			state.observations.push(observation);
			// A `while` rather than an `if`: a misconfigured bound must not be able
			// to leave the window over its limit.
			const limit = Math.max(1, state.config.retainObservations);
			while (state.observations.length > limit) state.observations.shift();
		},
		resetWindow() {
			state.observations = [];
			state.pendingTools.clear();
			state.turnsSinceAppraisal = 0;
			state.lastAppraisal = undefined;
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
}

/** Effective signal options for the current config. */
export function signalOptions(state: DevsPsychologistState): {
	restatementThreshold: number;
	unscopedWordFloor: number;
	idleGapMs: number;
	maxObservations: number;
} {
	return {
		restatementThreshold: state.config.restatementThreshold,
		unscopedWordFloor: state.config.unscopedWordFloor,
		idleGapMs: state.config.idleGapMs,
		maxObservations: DEFAULT_SIGNAL_OPTIONS.maxObservations,
	};
}