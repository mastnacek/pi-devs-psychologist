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
import { DEFAULT_SIGNAL_OPTIONS } from "./signals.js";
import { normalizeLocale, type Locale } from "./i18n.js";

export interface DevsPsychologistConfig {
	/** Master switch. Off means the plugin observes nothing and spends nothing. */
	enabled: boolean;
	/** Language of the plugin's own UI copy. Model-facing text stays English. */
	lang: Locale;
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
	/** Objective signals are folded into an appraisal every N completed turns. */
	cadenceTurns: number;
	/** Hard ceiling on appraisals per session. 0 = unlimited (not recommended). */
	maxAppraisalsPerSession: number;
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
}

export const DEFAULT_CONFIG: DevsPsychologistConfig = {
	enabled: true,
	lang: "en",
	model: "",
	cadenceTurns: 8,
	maxAppraisalsPerSession: 12,
	restatementThreshold: DEFAULT_SIGNAL_OPTIONS.restatementThreshold,
	unscopedWordFloor: DEFAULT_SIGNAL_OPTIONS.unscopedWordFloor,
	idleGapMs: DEFAULT_SIGNAL_OPTIONS.idleGapMs,
	steerAgent: false,
	retainObservations: DEFAULT_SIGNAL_OPTIONS.maxObservations,
};

const CONFIG_DIR = join(homedir(), ".pi", "agent");
export const GLOBAL_CONFIG_FILE = join(CONFIG_DIR, "pi-devs-psychologist.json");

/** Project override: <cwd>/.pi/pi-devs-psychologist.json (wins over the global file). */
export function projectConfigPath(cwd: string): string {
	return join(cwd, ".pi", "pi-devs-psychologist.json");
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
	const fromGlobal = normalizeConfig({ ...DEFAULT_CONFIG, ...readLayer(globalFile) });
	if (!cwd) return fromGlobal;
	return normalizeConfig({ ...fromGlobal, ...readLayer(projectConfigPath(cwd)) });
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

/** Coerce a persisted layer into a usable config; junk becomes the default. */
export function normalizeConfig(cfg: Partial<DevsPsychologistConfig>): DevsPsychologistConfig {
	return {
		enabled: cfg.enabled !== false,
		lang: normalizeLocale(cfg.lang),
		// An unparsable model id must fail to "no model", never to a guess: a typo
		// that silently selects some other model would spend money on the wrong
		// observer.
		model: typeof cfg.model === "string" ? cfg.model.trim() : "",
		cadenceTurns: positiveInt(cfg.cadenceTurns, DEFAULT_CONFIG.cadenceTurns, 1),
		// 0 is meaningful here (unlimited), so the floor is 0 and the default is a
		// real cap.
		maxAppraisalsPerSession: positiveInt(
			cfg.maxAppraisalsPerSession,
			DEFAULT_CONFIG.maxAppraisalsPerSession,
			0,
		),
		restatementThreshold: ratio(cfg.restatementThreshold, DEFAULT_CONFIG.restatementThreshold),
		unscopedWordFloor: positiveInt(cfg.unscopedWordFloor, DEFAULT_CONFIG.unscopedWordFloor, 1),
		idleGapMs: positiveInt(cfg.idleGapMs, DEFAULT_CONFIG.idleGapMs, 1000),
		steerAgent: cfg.steerAgent === true,
		retainObservations: positiveInt(cfg.retainObservations, DEFAULT_CONFIG.retainObservations, 10),
	};
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
		// Write-then-rename: a crash mid-write must not leave a truncated config
		// that the next session silently reads as corrupt.
		const tmp = `${target}.tmp`;
		writeFileSync(tmp, JSON.stringify({ ...layer, ...patch }, null, 2), "utf8");
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