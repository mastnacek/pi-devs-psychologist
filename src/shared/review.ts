/**
 * review — the shared vocabulary of the reviewer role (`/psych review`, T32a).
 *
 * The reviewer reads the change since the last delivery and the repo's stated conventions, and
 * proposes at most one finding. Three things are shared between the slice that runs it and the
 * overlay card that renders it: the card DTO, the abstention test, and the way the parent resolves
 * the git HEAD that anchors a delivery. The parent computes NOTHING about the diff (ADR 0001): it
 * hands the child two commit anchors, the session evidence lines and the convention file paths, and
 * the child reads `git diff` and the convention files itself.
 *
 * `resolveGitHead` shells out to `git rev-parse HEAD` — never through a shell. Its seam is
 * injectable so the suite never needs a real repository.
 */

import { execFileSync } from "node:child_process";
import type { ReviewFinding } from "./appraisal.js";

/** Everything the review card renders, already enforced. */
export interface ReviewCardInput {
	/** The one finding class, or `undefined` when the finding was dropped by enforcement. */
	finding: ReviewFinding | undefined;
	/** The commit head this review covers, shown as the anchor. */
	head: string;
	/** The commit head of the previous delivery; `""` for the first. */
	lastHead: string;
	/** Citations that matched no supplied line — shown, never hidden. */
	unmatched: string[];
	/**
	 * True when the resolved reviewer model equals the working agent's model. The card then says
	 * "same model as the working agent", the honest disclosure ADR 0001 invariant 6 requires.
	 */
	sameModel: boolean;
}

/** True when the finding is an abstention: the reviewer declined and said why. */
export function isAbstention(finding: ReviewFinding | undefined): boolean {
	return finding === undefined || finding.verdict === "insufficient_context";
}

/** The commit HEAD of `cwd`, or `""` when it is not a git repository (or git unavailable). */
export function resolveGitHead(cwd: string): string {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}
