/**
 * i18n — the vocabulary the user reads, in one place.
 *
 * The plugin speaks two languages to two audiences and they never mix:
 *
 * - The **plugin's own text** (the statusline chip, the `/psych` report, command
 *   descriptions) is UI copy and comes from this table.
 * - The **psychologist model's prompt and evidence lines** are English in every
 *   locale, because they are instructions to a model, not copy for a human. A
 *   translated evidence line would change the model's reading of the numbers.
 *
 * English stays the default: the plugin is installed from a public repo.
 *
 * Hard invariant, enforced by `test/i18n.test.js`: every key exists in every
 * locale. A missing key would not crash — it would silently render `undefined`
 * into the statusline, which is worse.
 *
 * Never detect the locale from `LANG`/`LC_ALL`/`Intl`: absent on Windows and
 * unreliable in containers. The persisted `lang` setting is the only source of truth.
 */

export const LOCALES = ["en", "cs"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export interface Strings {
	/** Statusline. The product name (`psych`) is identical across locales; the state is not. */
	chipOff: string;
	/** Shown when no model is configured: observation is live, the spend is zero. */
	chipSignals: string;
	/**
	 * `psych 3t · 0/12`.
	 * `waiting` is turns since the last appraisal, `budget` is `used` or `used/cap`.
	 * A function rather than a template string so a locale can reorder the parts.
	 */
	chipAppraisal: (waiting: string, budget: string) => string;
	/** `/psych` report headings. */
	reportTitle: string;
	reportSignals: string;
	reportAppraisal: string;
	reportNone: string;
	reportDisabled: string;
	reportNoModel: string;
	reportBudgetSpent: string;
	/** Command surface. */
	commandDescription: string;
	usage: string;
	unknownOption: string;
	configWritten: (path: string) => string;
	modelSet: (model: string) => string;
	notTui: string;
}

/**
 * `satisfies` rather than `: Record<Locale, Strings>`: it still rejects a locale that
 * is missing a key (the invariant above), but keeps each locale's literal types instead
 * of widening them away.
 */
const STRINGS = {
	en: {
		chipOff: "psych: off",
		chipSignals: "psych: signals",
		chipAppraisal: (waiting, budget) => `psych ${waiting} · ${budget}`,
		reportTitle: "DEVELOPER PSYCHOLOGIST",
		reportSignals: "Observed signals",
		reportAppraisal: "Appraisal",
		reportNone: "Nothing observed yet — the window is empty.",
		reportDisabled: "The psychologist is off. Turn it on with: /psych on",
		reportNoModel: "No psychologist model configured. Set one with: /psych model <provider/id>",
		reportBudgetSpent: "Appraisal budget for this session is spent.",
		commandDescription: "Developer psychologist: observation state, appraisal, and settings",
		usage: "Usage: /psych [status|now|on|off|model <provider/id>|budget <n>|lang <en|cs>|global]",
		unknownOption: "Unknown option",
		configWritten: (path) => `Config written to ${path}`,
		modelSet: (model) => `Psychologist model set to ${model}`,
		notTui: "This view needs a terminal UI.",
	},
	cs: {
		chipOff: "psych: vyp",
		chipSignals: "psych: signály",
		chipAppraisal: (waiting, budget) => `psych ${waiting} · ${budget}`,
		reportTitle: "VÝVOJÁŘSKÝ PSYCHOLOG",
		reportSignals: "Zjištěné signály",
		reportAppraisal: "Posouzení",
		reportNone: "Zatím nic pozorováno — okno je prázdné.",
		reportDisabled: "Psycholog je vypnutý. Zapneš ho: /psych on",
		reportNoModel: "Není nastavený model psychologa. Nastav ho: /psych model <provider/id>",
		reportBudgetSpent: "Rozpočet posouzení pro tuto relaci je vyčerpán.",
		commandDescription: "Vývojářský psycholog: stav pozorování, posouzení a nastavení",
		usage: "Použití: /psych [status|now|on|off|model <provider/id>|budget <n>|lang <en|cs>|global]",
		unknownOption: "Neznámá volba",
		configWritten: (path) => `Konfigurace zapsána do ${path}`,
		modelSet: (model) => `Model psychologa nastaven na ${model}`,
		notTui: "Toto zobrazení potřebuje terminálové UI.",
	},
} satisfies Record<Locale, Strings>;

export function stringsFor(locale: Locale): Strings {
	return STRINGS[locale] ?? STRINGS[DEFAULT_LOCALE];
}

/**
 * Coerce a persisted value into a known locale. An unknown language is a typo,
 * not a reason to fall back to silence, so English wins.
 */
export function normalizeLocale(value: string | null | undefined): Locale {
	// The parameter is deliberately narrower than `unknown`: the JSON boundary in
	// `config.ts` is where unvalidated input is parsed, and by the time a value reaches
	// here it is already known to be a string or absent. The runtime guard stays because
	// JavaScript callers — and a JSON file written by hand — can still violate the type.
	return typeof value === "string" && LOCALES.includes(value as Locale)
		? (value as Locale)
		: DEFAULT_LOCALE;
}
