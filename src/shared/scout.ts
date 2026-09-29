/**
 * scout — the shared vocabulary of the scout role (T31).
 *
 * The scout answers one question: does the pi ecosystem already solve this recurring friction, or
 * is a small plugin worth building? Three things are shared between the slice that produces the
 * answer and the overlay card that renders it: the card's DTO, the ready-to-paste SPAI idea line,
 * and the way a recurring failure fingerprint becomes a topic.
 *
 * The SPAI line is never recorded automatically. It is a string the operator can copy; writing it
 * into some tracker would be this plugin making a product decision, which it does not do.
 */

import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ScoutBuild, ScoutCandidate } from "./appraisal.js";
import type { FailureFingerprint } from "./signals.js";
import { fingerprintKey } from "./triggers.js";

/**
 * The fingerprint count at which a recurring failure earns a scout run instead of an appraisal (T31).
 * Lives in shared so the appraiser's trigger rule and the scout slice name the same number.
 */
export const SCOUT_TRIGGER_MIN_COUNT = 3;

/** Everything the scout card renders, already enforced. */
export interface ScoutCardInput {
	/** The operator-given topic, or the fingerprint the scout derived one from. */
	topic: string | undefined;
	candidates: ScoutCandidate[];
	build: ScoutBuild | undefined;
	/** The paste-ready SPAI line from `build`, or `undefined` when nothing is worth building. */
	ideaLine: string | undefined;
	cited: string[];
	/** True when no candidate survived and there is no build: the honest "nothing found". */
	nothingFound: boolean;
}

/**
 * The project folder name the SPAI line names: the basename of the git root reached from `cwd`,
 * or of `cwd` itself when there is no git root above it. Walked with `existsSync`, so a `.git`
 * directory and a `.git` file (a worktree) are both roots.
 */
export function projectName(cwd: string): string {
	let dir = cwd;
	for (;;) {
		if (existsSync(join(dir, ".git"))) return basename(dir);
		const parent = dirname(dir);
		if (parent === dir) return basename(cwd);
		dir = parent;
	}
}

/**
 * The ready-to-paste SPAI idea line: `? <title> — <oneLine> @<project> :scout:`.
 *
 * The `:scout:` tag is lowercase because SPAI tags are. The operator pastes this into their own
 * tracker; the plugin never records it on their behalf.
 */
export function scoutIdeaLine(build: ScoutBuild, project: string): string {
	return `? ${build.title} — ${build.oneLine} @${project} :scout:`;
}

/** A topic derived from a recurring-failure fingerprint, and the key that makes it once-per-session. */
export interface ScoutTopic {
	topic: string;
	/** The `toolName signature` key, shared with the trigger baseline spelling. */
	key: string;
}

/**
 * The highest-count fingerprint at or above `min`, as a topic.
 *
 * Used twice: the `/psych scout` default topic (any fingerprint, `min` 1) and the automatic trigger
 * (the count ≥ 3 threshold T31 names). Returns `undefined` when no fingerprint reaches `min`, so a
 * caller can fall back to a usage message or stay silent rather than scout an empty topic.
 */
export function topRecurringTopic(
	fingerprints: readonly FailureFingerprint[],
	min: number,
): ScoutTopic | undefined {
	let best: FailureFingerprint | undefined;
	for (const fingerprint of fingerprints) {
		if (fingerprint.count < min) continue;
		if (!best || fingerprint.count > best.count) best = fingerprint;
	}
	if (!best) return undefined;
	return { topic: `${best.toolName}: ${best.signature}`, key: fingerprintKey(best.toolName, best.signature) };
}