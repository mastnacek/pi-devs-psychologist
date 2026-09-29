/**
 * config — the mandatory cascade: defaults ← ~/.pi/agent/<plugin>.json ←
 * <cwd>/.pi/<plugin>.json (project wins).
 *
 * `saveConfig` takes a PARTIAL patch and merges it into the target layer only.
 * Writing a whole merged object here would freeze inherited values into the
 * nearer layer and silently shadow later edits to the outer one.
 *
 * Two keys carry the plugin's cost and safety policy and are documented as such
 * below: `model` (empty means the plugin never spends a token on a model) and
 * `maxAppraisalsPerSession` (a hard ceiling, because an observer model that can
 * call itself unlimited times is a billing incident, not a psychologist).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Locale } from "./i18n.js";
import type { TriggerThresholds } from "./triggers.js";
import type { TokenEstimate } from "./cost.js";
import type { AgentConfig, RuntimeMode } from "./agent-config.js";
import type { RolesConfig } from "./role-config.js";
import type { HistoryConfig } from "./history-config.js";
import { DEFAULT_CONFIG, isPlainObject, normalizeConfig } from "./config-normalize.js";

// Re-exported so `config.ts` stays the one import for the plugin's settings vocabulary.
export { DEFAULT_CONFIG, isPlainObject, normalizeConfig } from "./config-normalize.js";
export { DEFAULT_AGENT_CONFIG, effectiveAgentModel, normalizeAgent, THINKING_LEVELS } from "./agent-config.js";
export type { AgentConfig, AgentContextLevel, RuntimeMode } from "./agent-config.js";
export {
	DEFAULT_CONVENTION_FILES,
	DEFAULT_REVIEWER_MAX_DIFF_BYTES,
	DEFAULT_ROLES_CONFIG,
	DEFAULT_WORKSHOP_DIR,
	normalizeRoles,
} from "./role-config.js";
export type { ReviewerRoleConfig, RolesConfig, ScoutRoleConfig } from "./role-config.js";

/** How the appraiser decides when to run: on new evidence (D7) or on a turn clock. */
export type TriggerMode = "signals" | "cadence";

export interface DevsPsychologistConfig {
	/** Master switch. Off means the plugin observes nothing and spends nothing. */
	enabled: boolean;
	/** Language of the plugin's own UI copy. Model-facing text stays English. */
	lang: Locale;
	/**
	 * Which runtime forms the appraisal. `api` (the default) is today's single completion call;
	 * `agent` spawns a headless child pi with its own tools and a chosen model. Nothing spawns yet
	 * (T24): `agent` currently changes only the config, the report and the chip.
	 */
	runtime: RuntimeMode;
	/** Settings for the `agent` runtime. Normalised key by key, and merged per key across layers. */
	agent: AgentConfig;
	/** The optional roles that share the agent runtime (T31). Each has its own consent gate. */
	roles: RolesConfig;
	/** Opt-in cross-session delivery record (T10), OFF by default. See `src/shared/history-store.ts`. */
	history: HistoryConfig;
	/**
	 * The model that plays the psychologist, as `provider/modelId`. It should be
	 * a DIFFERENT model than the one doing the work: an observer sharing the
	 * working model's blind spots is not an observer.
	 *
	 * EMPTY MEANS NO MODEL SPEND. The plugin still observes and still reports its
	 * objective signals; it simply never forms an appraisal. This is the default,
	 * so installing the plugin cannot cost anything by itself.
	 */
	model: string;
	/**
	 * When the appraiser runs. `signals` (the default) runs on new evidence, with `cadenceTurns` as a
	 * minimum floor between attempts; `cadence` is the old clock, kept for comparison and for tests.
	 */
	trigger: TriggerMode;
	/**
	 * The floor between attempts under `trigger: "signals"`, and the exact clock under `"cadence"`.
	 *
	 * Under signals the floor exists so a burst of evidence cannot trigger several attempts on
	 * consecutive turns; under cadence it IS the policy.
	 */
	cadenceTurns: number;
	/** Per-reason trigger thresholds. Each normalised independently; junk → default. */
	triggerThresholds: TriggerThresholds;
	/**
	 * The assumed size of one appraisal prompt, in tokens, used for the picker's cost preview
	 * (`~$X.XX per appraisal`). Overridable because the real prompt grows with the session.
	 */
	estimateTokens: TokenEstimate;
	/**
	 * Whether a successful commit (`git commit`, `git push`, `gh pr create`, `npm publish`) made
	 * with unverified changes is named (T15). ON by default: it observes only, never blocks.
	 */
	commitCheck: boolean;
	/**
	 * Whether a factual session ledger is written at shutdown and offered at the next start (idea 2).
	 * ON by default: zero tokens, TUI-only, no score. `false` disables both the write and the offer.
	 */
	handoff: boolean;
	/**
	 * Flow shield (idea 6): while this session's delivered `protect_flow` intervention is unresolved,
	 * hold the plugin's own cards and notifications until the next `agent_end`. ON by default.
	 */
	flowShield: boolean;
	/** Hard ceiling on appraisals per session. 0 = unlimited (not recommended). */
	maxAppraisalsPerSession: number;
	/**
	 * Turns an intervention is given to prove itself before its outcome is judged (T16).
	 * See `src/shared/outcome.ts` for the per-metric comparison rule.
	 */
	outcomeWindowTurns: number;
	/** Turns a delivered kind stays "cooling" and the model is warned off it (T17). */
	cooldownTurns: number;
	/** Token-overlap ratio at which a prompt counts as a restatement. */
	restatementThreshold: number;
	/** Word count above which an anchor-less prompt is reported unscoped. */
	unscopedWordFloor: number;
	/** Gap between prompts counted as an interruption, ms. */
	idleGapMs: number;
	/**
	 * Whether a structural intervention may be written into the WORKING agent's
	 * context. Off by default: an observer that can silently steer the worker is
	 * an authority, and this plugin is explicitly not one.
	 */
	steerAgent: boolean;
	/** Observations retained in memory. Bounds a long session. */
	retainObservations: number;
	/**
	 * Include the parent-computed environment lines (pi version, pi-lens LSP/format/guard
	 * state) among the citable evidence.
	 *
	 * ON by default, and the measurement is the argument for it: handed those facts, the model
	 * produced the sharpest advice of the whole experiment with zero tool calls, where a file
	 * *path* in the same prompt was never opened. They are the first evidence in this plugin
	 * that describes the operator's machine rather than their work, so this is the switch that
	 * turns them off — not because they leak (no absolute path is emitted) but because the
	 * machine is not the programmer's business when they have asked not to be.
	 */
	envFacts: boolean;
	/**
	 * Include the objective repo map (file counts, longest file, test-to-source ratio, slice layout)
	 * among the citable evidence (T8).
	 *
	 * ON by default: it is arithmetic over the tree the session is working in, computed once per
	 * session, and it costs nothing but a walk. `false` removes the lines and makes `/psych` say the
	 * map is unavailable. The one thing it must NEVER read is file content — see `src/shared/
	 * repo-map.ts`; the walk counts lines and discards the text.
	 */
	mapRepo: boolean;
}

const CONFIG_DIR = join(homedir(), ".pi", "agent");
export const GLOBAL_CONFIG_FILE = join(CONFIG_DIR, "pi-devs-psychologist.json");

/** Project override: <cwd>/.pi/pi-devs-psychologist.json (wins over the global file). */
export function projectConfigPath(cwd: string): string {
	return join(cwd, ".pi", "pi-devs-psychologist.json");
}

/**
 * Merge a patch layer over a base object, one level deep for nested objects.
 *
 * A shallow spread would let a project patch replace the whole `agent` (or `triggerThresholds`)
 * object and silently drop every key the outer layer set. "The project layer wins where it speaks"
 * has to mean per KEY, and a setting that is itself a group of settings is no exception.
 */
function mergeLayer(
	base: Partial<DevsPsychologistConfig> | DevsPsychologistConfig,
	patch: Partial<DevsPsychologistConfig>,
): Partial<DevsPsychologistConfig> {
	// SAFETY: every config key holds a JSON value, so an open string-keyed view is a faithful
	// description of the object, and the merge below only reads and spreads those keys.
	const baseRecord = base as Record<string, unknown>;
	const patchRecord = patch as Record<string, unknown>;
	const merged: Record<string, unknown> = { ...baseRecord, ...patchRecord };
	for (const key of Object.keys(patchRecord)) {
		const baseValue = baseRecord[key];
		const patchValue = patchRecord[key];
		// Recursion, not one spread: the nested groups themselves nest. `{ roles: { scout: {
		// enabled: true } } }` must not wipe `roles.reviewer`, nor the scout's own `workshopDir`
		// — "the layer wins where it speaks" means per LEAF key, at any depth.
		if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
			merged[key] = mergeLayer(
				baseValue as Partial<DevsPsychologistConfig>,
				patchValue as Partial<DevsPsychologistConfig>,
			);
		}
	}
	// SAFETY: `merged` starts as a copy of a valid config and only replaces a config key's value
	// with a deeper merge of that same key, so it is still a valid partial config.
	return merged as Partial<DevsPsychologistConfig>;
}

function readLayer(path: string): Partial<DevsPsychologistConfig> {
	try {
		if (existsSync(path)) {
			return JSON.parse(readFileSync(path, "utf8")) as Partial<DevsPsychologistConfig>;
		}
	} catch {
		// Corrupt layer — fall through to the next one.
	}
	return {};
}

export function loadConfig(
	cwd?: string,
	globalFile: string = GLOBAL_CONFIG_FILE,
): DevsPsychologistConfig {
	const fromGlobal = normalizeConfig(mergeLayer(DEFAULT_CONFIG, readLayer(globalFile)));
	if (!cwd) return fromGlobal;
	return normalizeConfig(mergeLayer(fromGlobal, readLayer(projectConfigPath(cwd))));
}

/**
 * Persist a patch: `--global` (isGlobal) writes ~/.pi/agent/, otherwise the
 * project file under <cwd>/. Without a cwd the global file is the target.
 */
export function saveConfig(
	patch: Partial<DevsPsychologistConfig>,
	isGlobal = false,
	cwd?: string,
	globalFile: string = GLOBAL_CONFIG_FILE,
): string {
	const target = isGlobal || !cwd ? globalFile : projectConfigPath(cwd);
	try {
		mkdirSync(dirname(target), { recursive: true });
		const layer = readLayer(target);
		// Merge per key, nested objects included: patching `agent.model` must not clobber the
		// `agent.context` an earlier write left in the same file.
		// Write-then-rename: a crash mid-write must not leave a truncated config
		// that the next session silently reads as corrupt.
		const tmp = `${target}.tmp`;
		const merged = mergeLayer(layer, patch);
		writeFileSync(tmp, JSON.stringify(merged, null, 2), "utf8");
		renameSync(tmp, target);
	} catch {
		// Silent fallback: an unwritable config must never break a session.
		try {
			rmSync(`${target}.tmp`, { force: true });
		} catch {
			// Nothing to clean up.
		}
	}
	return target;
}

/**
 * Create the global config file with the defaults if it is not there yet.
 *
 * An installed plugin whose config exists nowhere on disk has no answer to "where do
 * I configure this?" — the settings are real, documented and readable, but
 * undiscoverable, so the only way to change one is to already know. Seeding the file
 * makes the plugin self-describing, which is the convention the sibling
 * `pi-openrouter-accounts` plugin established.
 *
 * NEVER overwrites: an existing file, even a hand-broken one, is left alone. Returns
 * true only when it actually created the file, so the caller can say so exactly once.
 * An unwritable path is not an error — a read-only environment falls back to defaults.
 */
export function seedGlobalConfig(globalFile: string = GLOBAL_CONFIG_FILE): boolean {
	try {
		if (existsSync(globalFile)) return false;
		mkdirSync(dirname(globalFile), { recursive: true });
		const tmp = `${globalFile}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
		renameSync(tmp, globalFile);
		return true;
	} catch {
		try {
			rmSync(`${globalFile}.tmp`, { force: true });
		} catch {
			// Nothing to clean up.
		}
		return false;
	}
}

/**
 * The first-run welcome marker. NOT a config key: it is a companion file next to the global
 * config, so the config file itself stays exactly the documented schema (a user who diffs or
 * hand-edits it sees settings, not bookkeeping). It only answers "was the welcome already
 * shown once?". Failing to mark is harmless: the welcome shows again, once, on the next start.
 */
export function onboardedPath(globalFile: string = GLOBAL_CONFIG_FILE): string {
	return `${globalFile}.onboarded`;
}

export function isOnboarded(globalFile: string = GLOBAL_CONFIG_FILE): boolean {
	return existsSync(onboardedPath(globalFile));
}

export function markOnboarded(globalFile: string = GLOBAL_CONFIG_FILE): void {
	try {
		mkdirSync(dirname(globalFile), { recursive: true });
		writeFileSync(onboardedPath(globalFile), "", "utf8");
	} catch {
		// An unwritable marker only means the welcome repeats.
	}
}