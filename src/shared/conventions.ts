/**
 * conventions — the repo's STATED rules, as quoteable evidence (T32a).
 *
 * The reviewer runs in a child that reads the diff with its own tools, and the parent deliberately
 * retains no change content (ADR 0001). Enforcement still needs something the parent can verify a
 * citation against, so the parent supplies the one thing it can read cheaply and deliberately: the
 * repo's own rule lines. Without them a correct finding is dropped, because the child quotes the
 * rule's TEXT while the parent only knows the rule's PATH — a live run showed exactly that.
 *
 * Bounded on purpose: `MAX_RULE_LINES` per file, `MAX_RULE_CHARS` per file, a byte cap per read,
 * and the configured file list only. This is the same "data is a function of what is enabled"
 * discipline the mapper follows, and it never sees source code.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Lines that are structure, not rules, and would only dilute the quoteable set. */
const SKIP_PREFIX = /^\s*(#|<!--|```|\||>)/;
/** Markdown list bullets and bold markers, stripped so the bare rule text is what the child quotes. */
const RULE_LINE = /^\s*(?:[-*+]\s+|\d+\.\s+)?\*{0,2}(.+?)\*{0,2}\s*$/;

/**
 * The words a rule uses to bind a reader: an obligation, a prohibition, or a precondition.
 * `gets`/`needs`/`has to` matter as much as `must` — a workshop AGENTS.md is full of rules like
 * "every new source file gets a test", and a keyword list that misses them loses real rules.
 */
const OBLIGATION =
	/\b(must|mustn't|never|always|do not|don't|should|shouldn't|shall|require[sd]?|required|forbidden|avoid|prefer|only|get[sd]?|need(?:s|ed)?|has to|have to|keep|ensure|make sure)\b/i;

export const MAX_RULE_LINES = 40;
export const MAX_RULE_CHARS = 2000;
export const MAX_CONVENTION_BYTES = 256 * 1024;

export interface ConventionRule {
	/** `AGENTS.md:12` — where the rule came from, so a card can point at it. */
	source: string;
	/** The rule's own text, verbatim, minus the bullet. This is the citable line. */
	text: string;
}

/** Pure: given a file's text and its name, the quoteable rule lines. */
export function ruleLines(fileName: string, text: string, limit = MAX_RULE_LINES): ConventionRule[] {
	const rules: ConventionRule[] = [];
	const lines = text.split("\n");
	for (let i = 0; i < lines.length && rules.length < limit; i += 1) {
		const raw = lines[i];
		if (raw.length === 0 || raw.length > MAX_RULE_CHARS) continue;
		if (SKIP_PREFIX.test(raw)) continue;
		const match = RULE_LINE.exec(raw);
		const body = match?.[1]?.trim();
		// A rule states an obligation or a prohibition. Anything without one is a description.
		if (body === undefined || body.length < 8) continue;
		// Description guards come FIRST: "states nothing anyone must not do" contains "must", so
		// the obligation test alone would read a sentence about rules as a rule.
		if (/\b(descriptive|states nothing|for example|e\.g\.|i\.e\.|prose)\b/i.test(body)) continue;
		if (!OBLIGATION.test(body)) continue;
		rules.push({ source: `${fileName}:${i + 1}`, text: body });
	}
	return rules;
}

/** The impure read: the configured files that exist, in order, bounded per file. */
export function readConventionRules(
	cwd: string,
	files: readonly string[],
	io: { exists: (path: string) => boolean; read: (path: string) => string } = {
		exists: existsSync,
		read: (path) => readFileSync(path, "utf8"),
	},
): ConventionRule[] {
	const rules: ConventionRule[] = [];
	for (const file of files) {
		const path = join(cwd, file);
		if (!io.exists(path)) continue;
		let text: string;
		try {
			text = io.read(path);
		} catch {
			continue;
		}
		if (text.length > MAX_CONVENTION_BYTES) text = text.slice(0, MAX_CONVENTION_BYTES);
		for (const rule of ruleLines(file, text)) {
			if (rules.length >= MAX_RULE_LINES * files.length) break;
			rules.push(rule);
		}
	}
	return rules;
}

/** The evidence lines the brief and the enforcement set both carry. */
export function conventionEvidenceLines(rules: readonly ConventionRule[]): string[] {
	return rules.map((rule) => `${rule.source}: ${rule.text}`);
}
