/**
 * appraisal-enforce — what happens to an answer once it arrives.
 *
 * Split from `appraisal.ts` because that file defines the contract (what a well-formed
 * answer looks like) and this one decides what to do with an answer that does not honour
 * it. The contract changes when the psychology changes; this changes when the failure modes
 * do.
 *
 * The rule: a verdict whose citations all fail is **downgraded to the neutral value for its
 * field**, and an intervention with no surviving citation is removed entirely. Not rejected
 * wholesale — one bad field should not discard a useful appraisal — and not kept, because
 * keeping it is the fabrication this plugin exists to prevent.
 */

import {
	FLOW_STATES,
	INTERVENTION_KINDS,
	LOAD_LEVELS,
	NEED_STATES,
	NEEDS,
	NEUTRAL,
	PROGRESS_STATES,
	REVIEW_VERDICTS,
	neutralAppraisal,
	type Appraisal,
	type AskAnswer,
	type InterventionKind,
	type NeedKey,
	type ReviewFinding,
	type ReviewVerdict,
} from "./appraisal.js";
import {
	allowedLines,
	enforceSuggestions,
	keepSupported,
	normalize,
	NO_SOURCES,
	readCited,
	type SourcePolicy,
} from "./appraisal-citations.js";

// Re-exported so a caller can name the policy through this module, as the appraiser slice expects.
export type { SourcePolicy } from "./appraisal-citations.js";

/**
 * Pull the first JSON object out of a model response.
 *
 * Models wrap JSON in prose or fences often enough that rejecting anything but bare JSON
 * would throw away usable appraisals. Returns `undefined` rather than throwing, so the
 * caller can report which stage failed.
 */
export function extractJson(text: string): unknown | undefined {
	if (typeof text !== "string") return undefined;
	const trimmed = text.trim();
	const candidates: string[] = [];
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
	if (fenced) candidates.push(fenced[1]);
	const first = trimmed.indexOf("{");
	const last = trimmed.lastIndexOf("}");
	if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));
	candidates.push(trimmed);
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate);
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
		} catch {
			// Try the next shape.
		}
	}
	return undefined;
}

/**
 * Read one verdict field.
 *
 * The field name differs by verdict: needs/progress/flow carry `state`, load carries
 * `level`. Reading the wrong one is invisible — it silently yields the fallback and makes the
 * verdict permanently neutral — so the key is a parameter rather than an assumption, and the
 * enforcement test covers `load` specifically for that reason.
 */
function readVerdict(
	value: unknown,
	key: "state" | "level",
	allowed: readonly string[],
	fallback: string,
): string {
	if (value === null || typeof value !== "object") return fallback;
	const raw = (value as Record<string, unknown>)[key];
	return typeof raw === "string" && allowed.includes(raw) ? raw : fallback;
}

export interface EnforcementResult {
	appraisal: Appraisal;
	/** Every citation that did not match a supplied line, for diagnostics and the report. */
	unmatched: string[];
	/** Claims downgraded to neutral because nothing supported them. */
	downgraded: string[];
}

/**
 * Enforce the citation contract.
 *
 * A verdict that *already* holds a neutral value needs no citation, because abstention is
 * always allowed and must never be punished.
 */
export function enforceEvidence(
	raw: Appraisal,
	evidenceLines: readonly string[],
	sourcePolicy: SourcePolicy = NO_SOURCES,
): EnforcementResult {
	const allowed = allowedLines(evidenceLines);

	const unmatched: string[] = [];
	const downgraded: string[] = [];
	const appraisal = neutralAppraisal();

	for (const need of NEEDS) {
		const neutralState = NEUTRAL.needs[need];
		const state = readVerdict(raw?.needs?.[need], "state", NEED_STATES, neutralState);
		const { kept, unmatched: bad } = keepSupported(readCited(raw?.needs?.[need]), allowed);
		unmatched.push(...bad);
		if (state !== neutralState && kept.length === 0) {
			downgraded.push(`needs.${need}`);
			appraisal.needs[need] = {
				state: neutralState as Appraisal["needs"][NeedKey]["state"],
				cited: [],
			};
		} else {
			appraisal.needs[need] = { state: state as Appraisal["needs"][NeedKey]["state"], cited: kept };
		}
	}

	const loadLevel = readVerdict(raw?.load, "level", LOAD_LEVELS, NEUTRAL.load);
	const loadCited = keepSupported(readCited(raw?.load), allowed);
	unmatched.push(...loadCited.unmatched);
	if (loadLevel !== NEUTRAL.load && loadCited.kept.length === 0) {
		downgraded.push("load");
	} else {
		appraisal.load = { level: loadLevel as Appraisal["load"]["level"], cited: loadCited.kept };
	}

	const progressState = readVerdict(raw?.progress, "state", PROGRESS_STATES, NEUTRAL.progress);
	const progressCited = keepSupported(readCited(raw?.progress), allowed);
	unmatched.push(...progressCited.unmatched);
	if (progressState !== NEUTRAL.progress && progressCited.kept.length === 0) {
		downgraded.push("progress");
	} else {
		appraisal.progress = {
			state: progressState as Appraisal["progress"]["state"],
			cited: progressCited.kept,
		};
	}

	const flowState = readVerdict(raw?.flow, "state", FLOW_STATES, NEUTRAL.flow);
	const flowCited = keepSupported(readCited(raw?.flow), allowed);
	unmatched.push(...flowCited.unmatched);
	if (flowState !== NEUTRAL.flow && flowCited.kept.length === 0) {
		downgraded.push("flow");
	} else {
		appraisal.flow = { state: flowState as Appraisal["flow"]["state"], cited: flowCited.kept };
	}

	const rawInterventions = Array.isArray(raw?.interventions) ? raw.interventions : [];
	// More than one intervention is not "a bit too many": it is a model that ignored the
	// contract. Taking the first would silently reward that, so the whole batch is refused
	// and the reason recorded.
	if (rawInterventions.length > 1) {
		downgraded.push("interventions:more-than-one");
	} else if (rawInterventions.length === 1) {
		const candidate = rawInterventions[0];
		const { kept, unmatched: bad } = keepSupported(readCited(candidate), allowed);
		const text = typeof candidate?.text === "string" ? candidate.text.trim() : "";
		const kind = candidate?.kind;
		const kindOk =
			typeof kind === "string" && INTERVENTION_KINDS.includes(kind as InterventionKind);
		if (kept.length === 0 || !kindOk || text.length === 0) {
			downgraded.push("interventions:unsupported");
		} else {
			appraisal.interventions = [{ kind: kind as InterventionKind, text: text.slice(0, 240), cited: kept }];
		}
		unmatched.push(...bad);
	}

	// Suggestions are the one field research may fill. A suggestion without a real `source` is
	// exactly the fabrication this file exists to drop, so it never reaches the operator. A
	// suggestion survives with an empty `cited` when its citations do not match.
	appraisal.suggestions = enforceSuggestions((raw as { suggestions?: unknown })?.suggestions, allowed, sourcePolicy, unmatched);

	return { appraisal, unmatched, downgraded };
}

export interface ParseOk {
	ok: true;
	appraisal: Appraisal;
	unmatched: string[];
	downgraded: string[];
}
export interface ParseFailure {
	ok: false;
	error: string;
}

/**
 * Parse a model response into an enforced appraisal.
 *
 * Hand-rolled structural reads rather than TypeBox `Value.Check` on purpose: recovery
 * matters more than rejection here. A response with one malformed field should yield an
 * appraisal neutral in that field and useful everywhere else, not nothing at all. `Value`
 * remains the right tool for tool *arguments*, where a bad shape must be refused.
 */
export function parseAppraisal(
	text: string,
	evidenceLines: readonly string[],
	sourcePolicy: SourcePolicy = NO_SOURCES,
): ParseOk | ParseFailure {
	const parsed = extractJson(text);
	if (parsed === undefined) return { ok: false, error: "response contained no JSON object" };
	const { appraisal, unmatched, downgraded } = enforceEvidence(parsed as Appraisal, evidenceLines, sourcePolicy);
	return { ok: true, appraisal, unmatched, downgraded };
}

/** True when the appraisal claims nothing at all — the plugin should then stay silent. */
export function isSilent(appraisal: Appraisal): boolean {
	return (
		appraisal.interventions.length === 0 &&
		NEEDS.every((need) => appraisal.needs[need].state === NEUTRAL.needs[need])
	);
}

/** The `ask` role's enforced answer (T30), plus what enforcement found while producing it. */
export interface EnforcedAsk extends AskAnswer {
	/** Citations that matched no evidence line, for diagnostics. */
	unmatched: string[];
	/**
	 * True when the answer rests on no surviving citation. The answer is STILL shown — the operator
	 * asked a question and is owed an answer — but with a visible marker that nothing supports it.
	 */
	unsupported: boolean;
}

export interface AskParseOk {
	ok: true;
	answer: EnforcedAsk;
}

/**
 * Enforce the citation contract on an `ask` answer (T30).
 *
 * Unlike an appraisal, the answer is never downgraded or hidden: the text is kept whole, and only
 * the citations are matched against the evidence. An answer with nothing surviving is reported as
 * `unsupported` so the card can mark it, never dropped — a direct question deserves a direct answer,
 * caveats and all.
 */
export function enforceAsk(
	raw: unknown,
	evidenceLines: readonly string[],
	sourcePolicy: SourcePolicy = NO_SOURCES,
): EnforcedAsk {
	const allowed = allowedLines(evidenceLines);
	const rawAnswer = (raw as { answer?: unknown })?.answer;
	const answer = (typeof rawAnswer === "string" ? rawAnswer.trim() : "").slice(0, 800);
	const { kept, unmatched } = keepSupported(readCited(raw), allowed);
	const suggestions = enforceSuggestions((raw as { suggestions?: unknown })?.suggestions, allowed, sourcePolicy, unmatched);
	return { answer, cited: kept, suggestions, unmatched, unsupported: kept.length === 0 };
}

/** Parse a model response into an enforced ask answer. An empty answer is a parse failure. */
export function parseAsk(
	text: string,
	evidenceLines: readonly string[],
	sourcePolicy: SourcePolicy = NO_SOURCES,
): AskParseOk | ParseFailure {
	const parsed = extractJson(text);
	if (parsed === undefined) return { ok: false, error: "response contained no JSON object" };
	const answer = enforceAsk(parsed, evidenceLines, sourcePolicy);
	if (answer.answer.length === 0) return { ok: false, error: "the answer was empty" };
	return { ok: true, answer };
}

/**
 * The fixed verdict order (ADR 0001). A finding class is ranked by it; with one finding per review
 * the order is a stable tie-break rather than a re-sort, but it is stated once here so a future
 * multi-finding shape cannot invent a different order.
 */
export function reviewVerdictRank(verdict: ReviewVerdict): number {
	return REVIEW_VERDICTS.indexOf(verdict);
}

function reviewText(value: unknown, max: number): string {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Enforce a reviewer finding's rules (T32a).
 *
 * A finding survives only when `rule`, `file` and `text` are present AND at least one `cited` line
 * matches a line the plugin supplied verbatim (list-marker tolerant, exactly like a verdict). An
 * abstention (`insufficient_context`) is the one shape allowed to carry no rule and no file, and
 * its `rule`/`file` are CLEARED so a stray value cannot dress an abstention as a finding. Every
 * unmatched citation, and every dropped finding, is counted into `unmatched` and `dropped`.
 */
export interface EnforcedReview {
	finding: ReviewFinding | undefined;
	/** Citations that matched no supplied line, and the mark for a dropped finding. */
	unmatched: string[];
	/** 1 when the finding was dropped, 0 when it survived. */
	dropped: number;
}

export function enforceReview(raw: unknown, evidenceLines: readonly string[]): EnforcedReview {
	const allowed = allowedLines(evidenceLines);
	const unmatched: string[] = [];
	const verdict = (raw as { verdict?: unknown })?.verdict;
	const verdictOk = typeof verdict === "string" && (REVIEW_VERDICTS as readonly string[]).includes(verdict);
	const text = reviewText((raw as { text?: unknown })?.text, 300);
	if (!verdictOk) {
		unmatched.push("review: unknown verdict");
		return { finding: undefined, unmatched, dropped: 1 };
	}

	const { kept, unmatched: bad } = keepSupported(readCited(raw), allowed);
	unmatched.push(...bad);
	const kind = verdict as ReviewVerdict;

	// Abstention is first-class and needs neither a rule nor a file; the two fields are cleared so
	// the shape stays unambiguous.
	if (kind === "insufficient_context") {
		return { finding: { verdict: kind, rule: "", file: "", text, cited: kept }, unmatched, dropped: 0 };
	}

	const rule = reviewText((raw as { rule?: unknown })?.rule, 300);
	const file = reviewText((raw as { file?: unknown })?.file, 300);
	// No citation, no claim: a non-abstention finding with nothing surviving is dropped.
	if (rule.length === 0 || file.length === 0 || text.length === 0 || kept.length === 0) {
		unmatched.push(`review: ${file.length > 0 ? file : kind}`);
		return { finding: undefined, unmatched, dropped: 1 };
	}

	// The intent line must also be a supplied session line; an unmatched one is dropped (but is not
	// itself a reason to drop the finding, which already carries a citation).
	let intentLine: string | undefined;
	const rawIntent = reviewText((raw as { intentLine?: unknown })?.intentLine, 400);
	if (rawIntent.length > 0) {
		const found = allowed.get(normalize(rawIntent));
		if (found === undefined) unmatched.push(rawIntent);
		else intentLine = found;
	}

	return {
		finding: { verdict: kind, rule, file, text, cited: kept, ...(intentLine ? { intentLine } : {}) },
		unmatched,
		dropped: 0,
	};
}

export type ReviewParseResult =
	| { ok: true; review: EnforcedReview }
	| { ok: false; error: string };

/** Parse a model response into an enforced reviewer finding. Junk is not JSON. */
export function parseReview(body: string, evidenceLines: readonly string[]): ReviewParseResult {
	const parsed = extractJson(body);
	if (parsed === undefined) return { ok: false, error: "response contained no JSON object" };
	return { ok: true, review: enforceReview(parsed, evidenceLines) };
}