/**
 * scout-enforce — what survives from a scout's answer (T31).
 *
 * Same discipline as `appraisal-enforce.ts`, aimed at a different failure: a scout that names a
 * package which does not exist, links a non-https string, or mislabels a half-relevant project as
 * `solves`. So each candidate is checked against the rules and, failing any, DROPPED and counted —
 * the answer is still shown with the survivors, never rejected wholesale, and the count is reported
 * so a run full of dropped candidates is visible rather than secretly empty.
 *
 * `installSpec` reuses the T25 install-spec forms and `url` must be `https://`; `fit` must be one of
 * the three known values. Citations are matched against the evidence like every other role. A run
 * whose candidates all fail and which offers no build is the honest `nothingFound` outcome.
 */

import { isHttpsUrl, isInstallSpec, allowedLines, keepSupported, readCited } from "./appraisal-citations.js";
import { SCOUT_FITS, type ScoutBuild, type ScoutCandidate, type ScoutFit } from "./appraisal.js";
import { extractJson } from "./appraisal-enforce.js";
import { scoutIdeaLine } from "./scout.js";

export interface EnforcedScout {
	candidates: ScoutCandidate[];
	build: ScoutBuild | undefined;
	/** The paste-ready SPAI line, or `undefined` when there is no build. */
	ideaLine: string | undefined;
	cited: string[];
	/** Candidates the model offered that failed a rule and were dropped. */
	dropped: number;
	/** Citations that matched no evidence line, for diagnostics. */
	unmatched: string[];
	/** True when nothing survived and there is no build: "nothing found", an outcome, not a failure. */
	nothingFound: boolean;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readBuild(value: unknown): ScoutBuild | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const title = text((value as { title?: unknown }).title).slice(0, 80);
	const oneLine = text((value as { oneLine?: unknown }).oneLine).slice(0, 200);
	if (title.length === 0 || oneLine.length === 0) return undefined;
	return { title, oneLine };
}

/**
 * Enforce a scout answer's rules. Pure: the same raw answer and evidence always yield the same
 * enforced answer, and the project name is passed in rather than looked up, so a test pins it.
 */
export function enforceScout(raw: unknown, evidenceLines: readonly string[], project: string): EnforcedScout {
	const allowed = allowedLines(evidenceLines);
	const list = Array.isArray((raw as { candidates?: unknown })?.candidates)
		? ((raw as { candidates: unknown[] }).candidates as unknown[])
		: [];

	const candidates: ScoutCandidate[] = [];
	let dropped = 0;
	for (const entry of list) {
		if (candidates.length >= 3) break;
		const name = text((entry as { name?: unknown })?.name);
		const installSpec = text((entry as { installSpec?: unknown })?.installSpec);
		const url = text((entry as { url?: unknown })?.url);
		const why = text((entry as { why?: unknown })?.why).slice(0, 160);
		const fit = (entry as { fit?: unknown })?.fit;
		const fitOk = typeof fit === "string" && (SCOUT_FITS as readonly string[]).includes(fit);
		if (
			name.length === 0 ||
			why.length === 0 ||
			!fitOk ||
			!isHttpsUrl(url) ||
			!isInstallSpec(installSpec)
		) {
			dropped += 1;
			continue;
		}
		candidates.push({ name, installSpec, url, why, fit: fit as ScoutFit });
	}

	const build = readBuild((raw as { build?: unknown })?.build);
	const { kept: cited, unmatched } = keepSupported(readCited(raw), allowed);
	return {
		candidates,
		build,
		ideaLine: build ? scoutIdeaLine(build, project) : undefined,
		cited,
		dropped,
		unmatched,
		nothingFound: candidates.length === 0 && build === undefined,
	};
}

export type ScoutParseResult =
	| { ok: true; scout: EnforcedScout }
	| { ok: false; error: string };

/** Parse a model response into an enforced scout answer. Junk is not JSON. */
export function parseScout(
	body: string,
	evidenceLines: readonly string[],
	project: string,
): ScoutParseResult {
	const parsed = extractJson(body);
	if (parsed === undefined) return { ok: false, error: "response contained no JSON object" };
	return { ok: true, scout: enforceScout(parsed, evidenceLines, project) };
}