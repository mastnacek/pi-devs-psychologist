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
	neutralAppraisal,
	type Appraisal,
	type InterventionKind,
	type NeedKey,
} from "./appraisal.js";

/** Comparison form for a citation: case and inner whitespace are not evidence. */
function normalize(line: string): string {
	return line.trim().replace(/\s+/g, " ").toLowerCase();
}

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

/** Structural read of one field, tolerant of junk, so enforcement can run without a validator. */
function readCited(value: unknown): string[] {
	if (value === null || typeof value !== "object") return [];
	const cited = (value as { cited?: unknown }).cited;
	if (!Array.isArray(cited)) return [];
	return cited.filter((entry): entry is string => typeof entry === "string");
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

/**
 * Keep only citations that appear in the supplied evidence, mapped to the canonical
 * spelling. Canonicalising matters: the report must quote the evidence line the plugin
 * produced, not the model's paraphrase of it.
 */
function keepSupported(
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
export function enforceEvidence(raw: Appraisal, evidenceLines: readonly string[]): EnforcementResult {
	const allowed = new Map<string, string>();
	for (const line of evidenceLines) {
		const key = normalize(line);
		if (!allowed.has(key)) allowed.set(key, line.trim().replace(/\s+/g, " "));
	}

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
export function parseAppraisal(text: string, evidenceLines: readonly string[]): ParseOk | ParseFailure {
	const parsed = extractJson(text);
	if (parsed === undefined) return { ok: false, error: "response contained no JSON object" };
	const { appraisal, unmatched, downgraded } = enforceEvidence(parsed as Appraisal, evidenceLines);
	return { ok: true, appraisal, unmatched, downgraded };
}

/** True when the appraisal claims nothing at all — the plugin should then stay silent. */
export function isSilent(appraisal: Appraisal): boolean {
	return (
		appraisal.interventions.length === 0 &&
		NEEDS.every((need) => appraisal.needs[need].state === NEUTRAL.needs[need])
	);
}