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

/** The optional roles, each with its own consent gate. */
export interface RolesConfig {
	scout: ScoutRoleConfig;
}

/** The workshop monorepo the scout may read. The one machine-specific default in the config. */
export const DEFAULT_WORKSHOP_DIR = "D:\\01_programovani\\pi\\plugins";

export const DEFAULT_ROLES_CONFIG: RolesConfig = {
	scout: { enabled: false, workshopDir: DEFAULT_WORKSHOP_DIR },
};

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
	return {
		scout: {
			enabled: scout.enabled === true,
			workshopDir:
				typeof scout.workshopDir === "string" ? scout.workshopDir.trim() : DEFAULT_WORKSHOP_DIR,
		},
	};
}