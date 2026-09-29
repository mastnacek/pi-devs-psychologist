/**
 * mapper — the objective codebase map as citable evidence (T8).
 *
 * The slice's job is small and owns exactly one policy: WHEN the tree is walked. The pure
 * arithmetic lives in `src/shared/repo-map.ts`; the filesystem walk lives in `./collect.ts`. This
 * file adds the two things only the session can: the git-work-tree eligibility check and the
 * per-session cache.
 *
 * The cache is the point. A repo tree read on every turn would put filesystem work on the hot path
 * for a number that changes once a session. So the map is computed once, at the first eligible
 * point, and every later appraisal and `/psych` reuses it — and the report can say how old it is
 * (`MAP_STALE_TURNS`), because a stale map presented as current would be the same lie as an
 * invented fact.
 *
 * `mapRepo: false`, or a `cwd` outside a git work tree, yields no lines; `/psych` then says "repo
 * map unavailable" rather than offering zeroes the model could mistake for a fact.
 */

import { spawnSync } from "node:child_process";
import type { DevsPsychologistState } from "../../shared/state.js";
import { buildRepoMap, MAP_STALE_TURNS, type RepoMapCache } from "../../shared/repo-map.js";
import { collectRepoFiles, defaultMapperIo, MAX_REPO_FILES, type MapperIo } from "./collect.js";

export { collectRepoFiles, defaultMapperIo, MAX_REPO_FILES } from "./collect.js";
export type { CollectedRepoFiles, CollectOptions, MapperIo } from "./collect.js";
export { buildRepoMap, MAP_STALE_TURNS } from "../../shared/repo-map.js";
export type { RepoFile, RepoMap, RepoMapCache } from "../../shared/repo-map.js";

export interface MapperDeps {
	/** The filesystem surface; tests inject a virtual tree. */
	io?: MapperIo;
	/** The walk; overridable so a test can count how many times it runs. */
	collect?: typeof collectRepoFiles;
	/**
	 * The git-work-tree probe. Returns the root path, `null` when git itself is unavailable (the
	 * caller falls back to `cwd`), or `undefined` when git ran and refused (`cwd` is not a repo).
	 */
	gitRoot?: (cwd: string) => string | null | undefined;
}

/**
 * Is `cwd` inside a git work tree? `git rev-parse --show-toplevel` is the only git call the mapper
 * ever makes — no status, no log, no diff. A missing git binary is not a reason to withhold a map;
 * it degrades to `cwd`, which is where the operator is working regardless.
 */
export function defaultGitRoot(cwd: string): string | null | undefined {
	try {
		const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
		if (result.error) return null;
		if (result.status !== 0) return undefined;
		const root = (result.stdout ?? "").trim();
		return root.length > 0 ? root : undefined;
	} catch {
		return null;
	}
}

/**
 * The map for `cwd`, computed once and cached in `state`.
 *
 * Returns `undefined` when `mapRepo` is off; otherwise a `RepoMapCache` whose `available` flag
 * distinguishes "here are the lines" from "no map exists for this cwd".
 */
export function ensureRepoMap(
	state: DevsPsychologistState,
	cwd: string,
	deps: MapperDeps = {},
): RepoMapCache | undefined {
	if (!state.config.mapRepo) return undefined;

	const cached = state.repoMap;
	if (cached && cached.cwd === cwd) return cached;

	const root = (deps.gitRoot ?? defaultGitRoot)(cwd);
	if (root === undefined) {
		const unavailable: RepoMapCache = { cwd, available: false, facts: undefined, evidence: [], computedAtTurn: state.turnCount };
		state.repoMap = unavailable;
		return unavailable;
	}

	const collect = deps.collect ?? collectRepoFiles;
	const collected = collect(cwd, deps.io ?? defaultMapperIo(), { maxFiles: MAX_REPO_FILES });
	const { evidence, facts } = buildRepoMap(collected.files, { skippedLarge: collected.skippedLarge });
	const entry: RepoMapCache = { cwd, available: true, facts, evidence, computedAtTurn: state.turnCount };
	state.repoMap = entry;
	return entry;
}

/** The evidence lines for the appraiser, or an empty list when no map is available. */
export function repoMapEvidenceLines(state: DevsPsychologistState, cwd: string, deps: MapperDeps = {}): string[] {
	const map = ensureRepoMap(state, cwd, deps);
	return map?.available ? map.evidence : [];
}

/** What `/psych` shows for the map section, computed from the same cache. */
export function repoMapReport(
	state: DevsPsychologistState,
	cwd: string,
	deps: MapperDeps = {},
): { lines: string[]; unavailable: boolean; ageTurns: number } {
	const map = ensureRepoMap(state, cwd, deps);
	if (!map || !map.available) return { lines: [], unavailable: true, ageTurns: 0 };
	return {
		lines: map.evidence,
		unavailable: false,
		ageTurns: Math.max(0, state.turnCount - map.computedAtTurn),
	};
}
