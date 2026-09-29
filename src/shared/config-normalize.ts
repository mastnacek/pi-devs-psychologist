/**
 * config-normalize — the plugin's defaults and the coercion of a persisted layer into a usable
 * config.
 *
 * Split out of `config.ts` by concept (and to keep each file under the line budget): the type and
 * the cascade live in `config.ts`, while every VALUE default and every per-key coercion lives
 * here, so one junk value cannot lose the rest. Junk becomes the default — never a guess, never
 * a crash.
 *
 * `config.ts` imports this module (runtime, one direction only) and re-exports
 * `DEFAULT_CONFIG` / `normalizeConfig`, so existing importers of `config.js` keep working.
 */

import type { DevsPsychologistConfig, TriggerMode } from "./config.js";
import { normalizeLocale } from "./i18n.js";
import { DEFAULT_AGENT_CONFIG, normalizeAgent, runtimeMode } from "./agent-config.js";
import { DEFAULT_ROLES_CONFIG, normalizeRoles } from "./role-config.js";
import { DEFAULT_HISTORY_CONFIG, normalizeHistory } from "./history-config.js";
import { DEFAULT_TRIGGER_THRESHOLDS, type TriggerThresholds } from "./triggers.js";
import { DEFAULT_ESTIMATE_TOKENS, type TokenEstimate } from "./cost.js";
import { DEFAULT_SIGNAL_OPTIONS } from "./signals.js";
import { DEFAULT_COOLDOWN_TURNS, DEFAULT_OUTCOME_WINDOW_TURNS } from "./outcome.js";

/** True for a plain object (not null, not an array). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Whole number at or above `min`, or the fallback when unusable. */
function positiveInt(value: unknown, fallback: number, min: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= min ? Math.floor(parsed) : fallback;
}

/** A ratio in (0, 1]; anything else falls back. */
function ratio(value: unknown, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

/** One of the known modes, or the default when the value is junk. */
function triggerMode(value: unknown): TriggerMode {
	return value === "cadence" ? "cadence" : value === "signals" ? "signals" : DEFAULT_CONFIG.trigger;
}

/** Coerce the threshold object key by key, so one bad value cannot lose the rest. */
function normalizeThresholds(value: unknown): TriggerThresholds {
	const raw = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const fallback = DEFAULT_TRIGGER_THRESHOLDS;
	return {
		failureStreak: positiveInt(raw.failureStreak, fallback.failureStreak, 1),
		recurringFailure: positiveInt(raw.recurringFailure, fallback.recurringFailure, 1),
		restatement: positiveInt(raw.restatement, fallback.restatement, 1),
		operatorAbort: positiveInt(raw.operatorAbort, fallback.operatorAbort, 1),
		staleProgress: positiveInt(raw.staleProgress, fallback.staleProgress, 1),
		compaction: positiveInt(raw.compaction, fallback.compaction, 1),
		thinkingRaised: positiveInt(raw.thinkingRaised, fallback.thinkingRaised, 1),
		delivered: positiveInt(raw.delivered, fallback.delivered, 1),
		commitUnverified: positiveInt(raw.commitUnverified, fallback.commitUnverified, 1),
	};
}

/** Coerce the estimate object key by key, so one bad value cannot lose the other. */
function normalizeEstimateTokens(value: unknown): TokenEstimate {
	const raw = isPlainObject(value) ? value : {};
	return { input: positiveInt(raw.input, DEFAULT_ESTIMATE_TOKENS.input, 1), output: positiveInt(raw.output, DEFAULT_ESTIMATE_TOKENS.output, 1) };
}

/** Coerce a persisted layer into a usable config; junk becomes the default. */
export function normalizeConfig(cfg: Partial<DevsPsychologistConfig>): DevsPsychologistConfig {
	return {
		enabled: cfg.enabled !== false,
		lang: normalizeLocale(cfg.lang),
		runtime: runtimeMode(cfg.runtime),
		agent: normalizeAgent(cfg.agent),
		roles: normalizeRoles(cfg.roles),
		history: normalizeHistory(cfg.history),
		// An unparsable model id must fail to "no model", never to a guess: a typo
		// that silently selects some other model would spend money on the wrong
		// observer.
		model: typeof cfg.model === "string" ? cfg.model.trim() : "",
		trigger: triggerMode(cfg.trigger),
		cadenceTurns: positiveInt(cfg.cadenceTurns, DEFAULT_CONFIG.cadenceTurns, 1),
		triggerThresholds: normalizeThresholds(cfg.triggerThresholds),
		estimateTokens: normalizeEstimateTokens(cfg.estimateTokens),
		// Default on, opt-out: `false` is the only value that disables it, so a hand-written config
		// with a missing or nonsense key keeps the better behaviour.
		commitCheck: cfg.commitCheck !== false,
		handoff: cfg.handoff !== false,
		flowShield: cfg.flowShield !== false,
		// 0 is meaningful here (unlimited), so the floor is 0 and the default is a
		// real cap.
		maxAppraisalsPerSession: positiveInt(
			cfg.maxAppraisalsPerSession,
			DEFAULT_CONFIG.maxAppraisalsPerSession,
			0,
		),
		// Floor of 1: a zero-turn window or cooldown would resolve/expire before any evidence could
		// form, so it is a typo rather than a policy. Junk → default.
		outcomeWindowTurns: positiveInt(
			cfg.outcomeWindowTurns,
			DEFAULT_CONFIG.outcomeWindowTurns,
			1,
		),
		cooldownTurns: positiveInt(cfg.cooldownTurns, DEFAULT_CONFIG.cooldownTurns, 1),
		restatementThreshold: ratio(cfg.restatementThreshold, DEFAULT_CONFIG.restatementThreshold),
		unscopedWordFloor: positiveInt(cfg.unscopedWordFloor, DEFAULT_CONFIG.unscopedWordFloor, 1),
		idleGapMs: positiveInt(cfg.idleGapMs, DEFAULT_CONFIG.idleGapMs, 1000),
		steerAgent: cfg.steerAgent === true,
		retainObservations: positiveInt(cfg.retainObservations, DEFAULT_CONFIG.retainObservations, 10),
		// Default on, opt-out: `false` is the only value that disables it, so a hand-written
		// config with a missing or nonsense key keeps the better behaviour.
		envFacts: cfg.envFacts !== false,
		mapRepo: cfg.mapRepo !== false,
	};
}

export const DEFAULT_CONFIG: DevsPsychologistConfig = {
	enabled: true,
	lang: "en",
	runtime: "api",
	agent: { ...DEFAULT_AGENT_CONFIG },
	roles: {
		scout: { ...DEFAULT_ROLES_CONFIG.scout },
		reviewer: { ...DEFAULT_ROLES_CONFIG.reviewer, conventionFiles: [...DEFAULT_ROLES_CONFIG.reviewer.conventionFiles] },
	},
	history: { ...DEFAULT_HISTORY_CONFIG },
	model: "",
	trigger: "signals",
	cadenceTurns: 3,
	triggerThresholds: { ...DEFAULT_TRIGGER_THRESHOLDS },
	estimateTokens: { ...DEFAULT_ESTIMATE_TOKENS },
	commitCheck: true,
	handoff: true,
	flowShield: true,
	maxAppraisalsPerSession: 12,
	outcomeWindowTurns: DEFAULT_OUTCOME_WINDOW_TURNS,
	cooldownTurns: DEFAULT_COOLDOWN_TURNS,
	restatementThreshold: DEFAULT_SIGNAL_OPTIONS.restatementThreshold,
	unscopedWordFloor: DEFAULT_SIGNAL_OPTIONS.unscopedWordFloor,
	idleGapMs: DEFAULT_SIGNAL_OPTIONS.idleGapMs,
	steerAgent: false,
	retainObservations: DEFAULT_SIGNAL_OPTIONS.maxObservations,
	envFacts: true,
	mapRepo: true,
};
