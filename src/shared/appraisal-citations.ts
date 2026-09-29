/**
 * appraisal-citations — the two facts every role's answer is judged on: whether a citation matches
 * a supplied evidence line, and whether a suggestion's `source` names something real.
 *
 * Split from `appraisal-enforce.ts` by concept (and to keep both files under the line budget): that
 * file decides what an unsupported VERDICT means (downgrade, drop, neutral), while this one is the
 * mechanical matching both `enforceEvidence` and `enforceAsk` share. Nothing here knows the shape of
 * an appraisal or an answer.
 */

import { isAbsolute, normalize as normalizePath, relative, resolve } from "node:path";
import { SUGGESTION_KINDS, type Suggestion, type SuggestionKind } from "./appraisal.js";

/**
 * Comparison form for a citation: case, inner whitespace and a leading list marker are not
 * evidence. The prompt presents every line as `- <line>`, and a model copying "exactly" copies the
 * bullet too — observed live (T26 RPC run): four correct citations dropped for their `- ` prefix,
 * leaving an appraisal with no verdicts. The marker is presentation, not content.
 */
export function normalize(line: string): string {
	return line
		.trim()
		.replace(/^(?:[-*\u2022\u00b7]\s+)+/, "")
		.replace(/\s+/g, " ")
		.toLowerCase();
}

/** Structural read of one field's `cited`, tolerant of junk, so enforcement can run without a validator. */
export function readCited(value: unknown): string[] {
	if (value === null || typeof value !== "object") return [];
	const cited = (value as { cited?: unknown }).cited;
	if (!Array.isArray(cited)) return [];
	return cited.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Keep only citations that appear in the supplied evidence, mapped to the canonical
 * spelling. Canonicalising matters: the report must quote the evidence line the plugin
 * produced, not the model's paraphrase of it.
 */
export function keepSupported(
	cited: readonly string[],
	allowed: Map<string, string>,
): { kept: string[]; unmatched: string[] } {
	const kept: string[] = [];
	const unmatched: string[] = [];
	const seen = new Set<string>();
	for (const entry of cited) {
		const canonical = allowed.get(normalize(entry));
		if (canonical === undefined) {
			unmatched.push(entry);
			continue;
		}
		if (seen.has(canonical)) continue;
		seen.add(canonical);
		kept.push(canonical);
	}
	return { kept, unmatched };
}

/** Canonical map of every admissible evidence line, keyed by its comparison form. */
export function allowedLines(evidenceLines: readonly string[]): Map<string, string> {
	const allowed = new Map<string, string>();
	for (const line of evidenceLines) {
		const key = normalize(line);
		if (!allowed.has(key)) allowed.set(key, line.trim().replace(/\s+/g, " "));
	}
	return allowed;
}

/**
 * What a suggestion's `source` is allowed to be, for this machine and this configuration.
 *
 * Two parts are facts only the composition root knows: the resolved pi docs directory (T23's
 * `resolvePiDocsDir`) and the notebook ids the operator consented to (`agent.nlmNotebooks`).
 * Defaulting to neither means a bare `parseAppraisal` accepts no path and no notebook, which is
 * the correct behaviour for a unit test or a caller that never configured research.
 */
export interface SourcePolicy {
	docsDir?: string;
	nlmNotebooks: string[];
}

/** No docs dir and no notebooks, so only a URL or an install spec can pass. */
export const NO_SOURCES: SourcePolicy = { nlmNotebooks: [] };

/** True when `abs` is a real file inside `root`, never `root` itself and never outside it. */
function inside(root: string, abs: string): boolean {
	// A `..` that escapes the docs directory resolves outside it, so the relative path starts with
	// `..`; a path that stays inside has at least one segment.
	const rel = relative(root, abs).replace(/\\/g, "/");
	return rel.length > 0 && rel !== ".." && !rel.startsWith("../");
}

/** True when `source` resolves to a real file inside the pi docs directory, never outside it. */
function isDocsPath(source: string, docsDir: string | undefined): boolean {
	if (!docsDir) return false;
	const root = resolve(docsDir);
	const normalized = source.replace(/\\/g, "/");
	if (isAbsolute(normalized)) return inside(root, normalizePath(normalized));
	// A relative source must look like a path — word characters, dots, slashes — so prose is never
	// mistaken for a file, and must resolve inside the docs directory.
	if (!/^[\w./-]+$/.test(normalized)) return false;
	return inside(root, resolve(root, normalized));
}

/** The one place a suggestion's `source` is judged. Anything unrecognised is a fabrication. */
function sourceAllowed(source: string, policy: SourcePolicy): boolean {
	if (/^https:\/\/\S+$/.test(source)) return true;
	if (/^npm:[@\w./-]+$/.test(source)) return true;
	if (/^git:github\.com\/[\w.-]+\/[\w.-]+$/.test(source)) return true;
	const notebook = /^nlm:(.+)$/.exec(source);
	if (notebook) return policy.nlmNotebooks.includes(notebook[1]);
	return isDocsPath(source, policy.docsDir);
}

/**
 * Keep only suggestions whose `source` is real for this machine. A suggestion without a source, or
 * with one that matches no allow-listed form, is dropped — that is the fabrication the plugin exists
 * to refuse — while its citations are checked against the evidence like any other line.
 */
export function enforceSuggestions(
	raw: unknown,
	allowed: Map<string, string>,
	sourcePolicy: SourcePolicy,
	unmatched: string[],
): Suggestion[] {
	const list = Array.isArray(raw) ? raw : [];
	const kept: Suggestion[] = [];
	for (const candidate of list) {
		if (kept.length >= 3) break;
		const kind = (candidate as { kind?: unknown })?.kind;
		const rawSource = (candidate as { source?: unknown })?.source;
		const rawText = (candidate as { text?: unknown })?.text;
		const source = typeof rawSource === "string" ? rawSource.trim() : "";
		const text = (typeof rawText === "string" ? rawText.trim() : "").slice(0, 200);
		const kindOk = typeof kind === "string" && SUGGESTION_KINDS.includes(kind as SuggestionKind);
		if (!kindOk || source.length === 0 || text.length === 0 || !sourceAllowed(source, sourcePolicy)) {
			unmatched.push(`suggestion: ${source.length > 0 ? source : String(kind ?? "")}`);
			continue;
		}
		const { kept: citedKept, unmatched: badCited } = keepSupported(readCited(candidate), allowed);
		unmatched.push(...badCited);
		kept.push({ kind: kind as SuggestionKind, text, source, cited: citedKept });
	}
	return kept;
}
