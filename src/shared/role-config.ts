/**
 * role-config — the settings for the optional roles that share the agent runtime (T31).
 *
 * Split out of `config.ts` by concept (and to keep each file under the line budget), exactly as
 * `agent-config.ts` is: every key here is normalised on its own, so one junk value cannot lose the
 * rest, and the object merges per key across the config layers in `config.ts`.
 *
 * The scout role is OFF by default. It spends model money by hunting the ecosystem for a package
 * that already solves recurring friction, so it is a consent decision like `runtime: "agent"`
 * itself: nothing runs until the operator turns it on.
 *
 * The reviewer role (T32a) carries its OWN consent gate for the same reason, stronger: it reads the
 * repository's source code with a model that leaves the machine, so enabling a mood chip must never
 * silently opt the operator into sending their code to a second model (ADR 0001).
 */

/** Settings for the `scout` role (`/psych scout`, T31). */
export interface ScoutRoleConfig {
	/** Consent gate. Off, the scout never runs — neither on the command nor from a trigger. */
	enabled: boolean;
	/**
	 * The operator's own plugin monorepo, which the child is told to read (README files only,
	 * never edit). The default is this workshop; `""` omits the sentence from the brief entirely,
	 * so a machine without the workspace is not told about a path that does not exist.
	 */
	workshopDir: string;
}

/**
 * Settings for the `reviewer` role (`/psych review`, T32a).
 *
 * The reviewer reads the change since the last delivery and the repo's stated conventions, and
 * proposes at most one finding. It is off by default: its own consent gate, separate from the
 * psychologist's `model`, because it reads content that can leave the machine.
 */
export interface ReviewerRoleConfig {
	/** Consent gate. Off, the reviewer never runs — not on a commit, not on `/psych review`. */
	enabled: boolean;
	/**
	 * `provider/id` for the review model. EMPTY MEANS "the shared `model`", which is then disclosed
	 * on the card, because a reviewer on the worker's own model shares its blind spots (ADR 0001
	 * invariant 6).
	 */
	model: string;
	/** The cap on the diff the child is told to read. Beyond it, it reviews the tail and says so. */
	maxDiffBytes: number;
	/** The repo's stated rules the child reads. `[]` means it cannot check convention adherence. */
	conventionFiles: string[];
}

/** The optional roles, each with its own consent gate. */
export interface RolesConfig {
	scout: ScoutRoleConfig;
	reviewer: ReviewerRoleConfig;
}

/** The workshop monorepo the scout may read. The one machine-specific default in the config. */
export const DEFAULT_WORKSHOP_DIR = "D:\\01_programovani\\pi\\plugins";

/** The convention files the reviewer is told to read (T32a). Absent ones are skipped by the child. */
export const DEFAULT_CONVENTION_FILES = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", ".pi/rules.md"];

/** 200 KB: a large but bounded diff, past which the child reviews the tail. */
export const DEFAULT_REVIEWER_MAX_DIFF_BYTES = 200_000;

export const DEFAULT_ROLES_CONFIG: RolesConfig = {
	scout: { enabled: false, workshopDir: DEFAULT_WORKSHOP_DIR },
	reviewer: {
		enabled: false,
		model: "",
		maxDiffBytes: DEFAULT_REVIEWER_MAX_DIFF_BYTES,
		conventionFiles: [...DEFAULT_CONVENTION_FILES],
	},
};

/** A non-negative integer, or the fallback. `maxDiffBytes` is a byte cap, so `0` is not meaningful. */
function positiveInt(value: unknown, fallback: number, min: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= min ? Math.floor(parsed) : fallback;
}

/** An array of non-empty strings; a junk member is dropped, a non-array falls back. */
function stringArray(value: unknown, fallback: readonly string[]): string[] {
	if (!Array.isArray(value)) return [...fallback];
	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim());
}

/** True for a plain object (not null, not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Coerce the `roles` object key by key. Only an explicit `true` enables the scout; a missing or
 * junk `workshopDir` falls back to the default, while an explicit `""` is honoured (it omits the
 * workshop sentence without losing the setting).
 */
export function normalizeRoles(value: unknown): RolesConfig {
	const raw = isPlainObject(value) ? value : {};
	const scout = isPlainObject(raw.scout) ? raw.scout : {};
	const reviewer = isPlainObject(raw.reviewer) ? raw.reviewer : {};
	return {
		scout: {
			enabled: scout.enabled === true,
			workshopDir:
				typeof scout.workshopDir === "string" ? scout.workshopDir.trim() : DEFAULT_WORKSHOP_DIR,
		},
		reviewer: {
			enabled: reviewer.enabled === true,
			model: typeof reviewer.model === "string" ? reviewer.model.trim() : "",
			maxDiffBytes: positiveInt(reviewer.maxDiffBytes, DEFAULT_REVIEWER_MAX_DIFF_BYTES, 1),
			conventionFiles: stringArray(reviewer.conventionFiles, DEFAULT_CONVENTION_FILES),
		},
	};
}