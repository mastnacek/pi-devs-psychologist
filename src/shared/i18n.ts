/**
 * i18n — the vocabulary the user reads, in one place.
 *
 * The plugin speaks two languages to two audiences and they never mix:
 *
 * - The **appraiser's own text** (report headings, statusline chip, command
 *   descriptions) is UI copy and comes from this table.
 * - The **psychologist model's prompt and evidence lines** are English in every
 *   locale, because they are instructions to a model, not copy for a human. A
 *   translated evidence line would change the model's reading of the numbers.
 *
 * English stays the default: the plugin is installed from a public repo.
 */

export const LOCALES = ["en", "cs"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export interface Strings {
	/** Statusline chip prefix. Product name, identical across locales. */
	chip: string;
	chipOff: string;
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

const STRINGS: Record<Locale, Strings> = {
	en: {
		chip: "psych",
		chipOff: "psych: off",
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
		chip: "psych",
		chipOff: "psych: vyp",
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
};

export function stringsFor(locale: Locale): Strings {
	return STRINGS[locale] ?? STRINGS[DEFAULT_LOCALE];
}

/**
 * Coerce a persisted value into a known locale. An unknown language is a typo,
 * not a reason to fall back to silence, so English wins.
 * Never detected from LANG/LC_ALL/Intl — absent on Windows, unreliable in
 * containers; the persisted setting is the only source of truth.
 */
export function normalizeLocale(value: unknown): Locale {
	return LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE;
}