/**
 * ask — the `AskCardInput` DTO shared by the ask slice and the overlay card (T30).
 *
 * The card's whole content, defined once here because two slices need the same vocabulary and
 * slices may not import each other: the ask slice produces this object, the overlay renders it.
 */

import type { Suggestion } from "./appraisal.js";

export interface AskCardInput {
	/** The operator's question, verbatim. */
	question: string;
	/** The enforced answer. Kept whole; the marker, not the text, carries any doubt. */
	answer: string;
	/** Citations that matched an evidence line, canonicalised. */
	cited: string[];
	/** Researched suggestions, already enforced. Operator-only. */
	suggestions: Suggestion[];
	/** True when no citation survived: the answer is shown, but marked unsupported. */
	unsupported: boolean;
	/** True when the API runtime answered: no tools were available for research. */
	noResearch: boolean;
}
