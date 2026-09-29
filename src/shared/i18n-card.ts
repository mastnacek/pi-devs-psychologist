/**
 * i18n-card — the vocabulary of the appraisal card and the `ask` card.
 *
 * Split out of `i18n.ts` by concept (and to keep each file under the line budget): these are the
 * strings the two TUI cards render, while `i18n.ts` holds the report shell and the command surface
 * and `i18n-runs.ts` the async-run wording. Kept flat and complete per locale, like every table
 * here: a missing key must not fall back to English at runtime.
 */

export interface CardStrings {
	cardTitle: string;
	cardVerdicts: string;
	cardIntervention: string;
	cardNothingToAct: string;
	/**
	 * Shown when no field carries a single citation, so the card reached no verdict at all.
	 * Distinct from `cardNothingToAct`: that one says "appraised, nothing to do", this one says
	 * "nothing was appraised". Presenting the second as the first reads as a clean bill of health.
	 */
	cardNoObservation: string;
	cardCited: string;
	cardUnmatched: (count: number) => string;
	/** Header of the card's researched-suggestions section (T25); the section is omitted when empty. */
	cardSuggestions: string;
	/** One suggestion in the notification fallback: its text and its enforced source. */
	notifySuggestion: (text: string, source: string) => string;
	cardFooter: { close: string; scroll: string };

	/** The `ask` card (`/psych ask <question>`, T30). */
	askQuestion: string;
	askAnswer: string;
	/** Shown when no citation survived: the answer is kept, but marked as resting on nothing. */
	askUnsupported: string;
	/** Shown on the API runtime, which has no tools: research was impossible. */
	askNoResearch: string;
}

export const CARD_EN: CardStrings = {
	cardTitle: "DEVELOPER PSYCHOLOGIST",
	cardVerdicts: "What the session shows",
	cardIntervention: "One thing, if it helps",
	cardNothingToAct: "Nothing to act on. That is a normal outcome.",
	cardNoObservation: "The model cited nothing, so no verdict was reached. Not a statement about the session.",
	cardCited: "from",
	cardUnmatched: (count) => `${count} unsupported claim(s) dropped`,
	cardSuggestions: "Researched suggestions",
	notifySuggestion: (text, source) => `${text} (source: ${source})`,
	cardFooter: { close: "close", scroll: "scroll" },

	askQuestion: "Question",
	askAnswer: "Answer",
	askUnsupported: "Unsupported: this answer cites no evidence line.",
	askNoResearch: "api runtime — no research",
};

export const CARD_CS: CardStrings = {
	cardTitle: "VÝVOJÁŘSKÝ PSYCHOLOG",
	cardVerdicts: "Co relace ukazuje",
	cardIntervention: "Jedna věc, pokud pomůže",
	cardNothingToAct: "Není co dělat. To je normální výsledek.",
	cardNoObservation: "Model nic nedoložil, žádný výrok nepadl. Není to tvrzení o relaci.",
	cardCited: "z",
	cardUnmatched: (count) => `${count} nepodložených tvrzení zahozeno`,
	cardSuggestions: "Prozkoumané náměty",
	notifySuggestion: (text, source) => `${text} (zdroj: ${source})`,
	cardFooter: { close: "zavřít", scroll: "posun" },

	askQuestion: "Dotaz",
	askAnswer: "Odpověď",
	askUnsupported: "Nepodloženo: tato odpověď necituje žádnou řádku důkazů.",
	askNoResearch: "api runtime — bez rešerše",
};
