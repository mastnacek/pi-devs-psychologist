/**
 * i18n — the vocabulary the user reads, in one place.
 *
 * The plugin speaks two languages to two audiences and they never mix:
 *
 * - The **plugin's own text** (the appraisal card, the `/psych` report, command
 *   descriptions) is UI copy and comes from this table.
 * - The **psychologist model's prompt and evidence lines** are English in every
 *   locale, because they are instructions to a model, not copy for a human. A
 *   translated evidence line would change the model's reading of the numbers.
 *
 * English stays the default: the plugin is installed from a public repo.
 *
 * Hard invariant, enforced by `test/i18n.test.js`: every key exists in every
 * locale, recursively. A missing key would not crash — it would silently render
 * `undefined` into the card, which is worse.
 *
 * Never detect the locale from `LANG`/`LC_ALL`/`Intl`: absent on Windows and
 * unreliable in containers. The persisted `lang` setting is the only source of truth.
 */

import {
	FLOW_STATES,
	INTERVENTION_KINDS,
	LOAD_LEVELS,
	NEED_STATES,
	NEEDS,
	PROGRESS_STATES,
	type InterventionKind,
	type NeedKey,
} from "./appraisal.js";

export const LOCALES = ["en", "cs"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

type NeedState = (typeof NEED_STATES)[number];
type LoadLevel = (typeof LOAD_LEVELS)[number];
type ProgressState = (typeof PROGRESS_STATES)[number];
type FlowState = (typeof FLOW_STATES)[number];

/**
 * Human names for the appraisal's vocabulary. Complete by construction: each map is
 * typed against the enum it names, so adding a state to the contract without naming it
 * in both locales is a compile error rather than a raw token on screen.
 */
export interface Labels {
	needs: Record<NeedKey, string>;
	needStates: Record<NeedState, string>;
	loadLevels: Record<LoadLevel, string>;
	progressStates: Record<ProgressState, string>;
	flowStates: Record<FlowState, string>;
	interventionKinds: Record<InterventionKind, string>;
}

export interface Strings {
	/** Statusline. The product name (`psych`) is identical across locales; the state is not. */
	chipOff: string;
	/** Shown when no model is configured: observation is live, the spend is zero. */
	chipSignals: string;
	/**
	 * Shown when the configured model cannot be resolved or has no credentials. Persistent
	 * rather than a notification: only the operator can fix it, and a nag would be worse.
	 */
	chipConfigError: string;
	/** `psych 3t · 0/12`. `waiting` is turns since the last appraisal, `budget` is used/cap. */
	chipAppraisal: (waiting: string, budget: string) => string;

	/** The appraisal card. */
	cardTitle: string;
	cardVerdicts: string;
	cardIntervention: string;
	cardNothingToAct: string;
	cardCited: string;
	cardUnmatched: (count: number) => string;
	cardFooter: { close: string; scroll: string };

	/** The `/psych` report. */
	reportTitle: string;
	reportSignals: string;
	reportSession: string;
	reportAppraisal: string;
	reportNone: string;
	reportNever: string;
	reportEmpty: string;
	reportWhy: string;
	reportErr: string;
	reportSpend: string;
	reportBudget: (used: number, cap: string) => string;
	reportDisabled: string;
	reportNoModel: string;

	/** Command surface. */
	commandDescription: string;
	usage: string;
	unknownOption: string;
	configWritten: (path: string) => string;
	configSeeded: (path: string) => string;
	/** The trailing `--global` flag on a setting command. */
	globalFlag: string;
	modelSet: (model: string) => string;
	languageSet: (lang: string) => string;
	budgetSet: (n: string) => string;
	enabled: string;
	disabled: string;
	notTui: string;
	done: string;
	/** `/psych now` while another appraisal is already running. */
	busy: string;
	labels: Labels;
}

const EN: Strings = {
	chipOff: "psych: off",
	chipSignals: "psych: signals",
	chipConfigError: "psych: check model",
	chipAppraisal: (waiting, budget) => `psych ${waiting} · ${budget}`,

	cardTitle: "DEVELOPER PSYCHOLOGIST",
	cardVerdicts: "What the session shows",
	cardIntervention: "One thing, if it helps",
	cardNothingToAct: "Nothing to act on. That is a normal outcome.",
	cardCited: "from",
	cardUnmatched: (count) => `${count} unsupported claim(s) dropped`,
	cardFooter: { close: "close", scroll: "scroll" },

	reportTitle: "DEVELOPER PSYCHOLOGIST",
	reportSignals: "Observed signals",
	reportSession: "Session record",
	reportAppraisal: "Appraisal",
	reportNone: "Not yet: no appraisal has run. Set a model with /psych model <provider/id>.",
	reportNever: "no appraisal yet",
	reportEmpty: "nothing to report",
	reportWhy: "why",
	reportErr: "last appraisal failed",
	reportSpend: "appraisal spend (not counted by the session meter)",
	reportBudget: (used, cap) => `budget ${used}/${cap}`,
	reportDisabled: "The psychologist is off. Turn it on with: /psych on",
	reportNoModel: "No psychologist model configured. Set one with: /psych model <provider/id>",

	commandDescription: "Developer psychologist: appraisal now, state, and settings",
	usage: "Usage: /psych [status|now|on|off|model <provider/id>|budget <n>|lang <en|cs>|global]",
	unknownOption: "Unknown option",
	configWritten: (path) => `Config written to ${path}`,
	configSeeded: (path) => `pi-devs-psychologist: config created at ${path}`,
	globalFlag: "write to ~/.pi/agent instead of the project",
	modelSet: (model) => `Psychologist model set to ${model}`,
	languageSet: (lang) => `Language set to ${lang}`,
	budgetSet: (n) => `Appraisals per session set to ${n}`,
	enabled: "Psychologist on",
	disabled: "Psychologist off",
	notTui: "This view needs a terminal UI. Use /psych status for the text report.",
	done: "Appraisal complete.",
	busy: "An appraisal is already running.",

	labels: {
		needs: {
			autonomy: "Autonomy",
			competence: "Competence",
			relatedness: "Relatedness",
		},
		needStates: {
			met: "met",
			at_risk: "at risk",
			unmet: "unmet",
			unassessed: "not assessed",
		},
		loadLevels: {
			low: "low",
			moderate: "moderate",
			high: "high",
			unassessed: "not assessed",
		},
		progressStates: {
			advanced: "advancing",
			blocked: "blocked",
			unproven: "unproven",
		},
		flowStates: {
			in_flow: "in flow",
			broken: "broken",
			unassessed: "not assessed",
		},
		interventionKinds: {
			name_next_win: "name the next win",
			thin_slice: "cut it thinner",
			reduce_load: "verify before writing more",
			protect_flow: "protect the flow",
			close_loop: "close the loop",
			return_autonomy: "hand the decision back",
			stop: "stop",
		},
	},
};

const CS: Strings = {
	chipOff: "psych: vyp",
	chipSignals: "psych: signály",
	chipConfigError: "psych: zkontroluj model",
	chipAppraisal: (waiting, budget) => `psych ${waiting} · ${budget}`,

	cardTitle: "VÝVOJÁŘSKÝ PSYCHOLOG",
	cardVerdicts: "Co relace ukazuje",
	cardIntervention: "Jedna věc, pokud pomůže",
	cardNothingToAct: "Není co dělat. To je normální výsledek.",
	cardCited: "z",
	cardUnmatched: (count) => `${count} nepodložených tvrzení zahozeno`,
	cardFooter: { close: "zavřít", scroll: "posun" },

	reportTitle: "VÝVOJÁŘSKÝ PSYCHOLOG",
	reportSignals: "Zjištěné signály",
	reportSession: "Záznam relace",
	reportAppraisal: "Posouzení",
	reportNone: "Zatím ne: posouzení ještě neproběhlo. Nastav model: /psych model <provider/id>.",
	reportNever: "posouzení zatím žádné",
	reportEmpty: "není co hlásit",
	reportWhy: "proč",
	reportErr: "poslední posouzení selhalo",
	reportSpend: "výdaj za posouzení (do měřiče relace se nepočítá)",
	reportBudget: (used, cap) => `rozpočet ${used}/${cap}`,
	reportDisabled: "Psycholog je vypnutý. Zapneš ho: /psych on",
	reportNoModel: "Není nastavený model psychologa. Nastav ho: /psych model <provider/id>",

	commandDescription: "Vývojářský psycholog: posouzení teď, stav a nastavení",
	usage: "Použití: /psych [status|now|on|off|model <provider/id>|budget <n>|lang <en|cs>|global]",
	unknownOption: "Neznámá volba",
	configWritten: (path) => `Konfigurace zapsána do ${path}`,
	configSeeded: (path) => `pi-devs-psychologist: konfigurace vytvořena v ${path}`,
	globalFlag: "zapsat do ~/.pi/agent místo do projektu",
	modelSet: (model) => `Model psychologa nastaven na ${model}`,
	languageSet: (lang) => `Jazyk nastaven na ${lang}`,
	budgetSet: (n) => `Počet posouzení na relaci nastaven na ${n}`,
	enabled: "Psycholog zapnut",
	disabled: "Psycholog vypnut",
	notTui: "Toto zobrazení potřebuje terminálové UI. Použij /psych status pro textový report.",
	done: "Posouzení dokončeno.",
	busy: "Posouzení už běží.",

	labels: {
		needs: {
			autonomy: "Autonomie",
			competence: "Kompetence",
			relatedness: "Sounáležitost",
		},
		needStates: {
			met: "naplněno",
			at_risk: "ohroženo",
			unmet: "nenaplněno",
			unassessed: "nevyhodnoceno",
		},
		loadLevels: {
			low: "nízká",
			moderate: "přiměřená",
			high: "vysoká",
			unassessed: "nevyhodnoceno",
		},
		progressStates: {
			advanced: "postupuje",
			blocked: "zablokováno",
			unproven: "neprokázáno",
		},
		flowStates: {
			in_flow: "v toku",
			broken: "přerušený",
			unassessed: "nevyhodnoceno",
		},
		interventionKinds: {
			name_next_win: "pojmenuj nejbližší výhru",
			thin_slice: "nakrájej to tenčeji",
			reduce_load: "ověř, než napíšeš další kód",
			protect_flow: "chraň tok",
			close_loop: "uzavři smyčku",
			return_autonomy: "vrať rozhodnutí člověku",
			stop: "skonči",
		},
	},
};

/**
 * `satisfies` rather than `: Record<Locale, Strings>`: it still rejects a locale missing a
 * key (the invariant above), but keeps each locale's literal types instead of widening them.
 */
const STRINGS = { en: EN, cs: CS } satisfies Record<Locale, Strings>;

export function stringsFor(locale: Locale): Strings {
	return STRINGS[locale] ?? STRINGS[DEFAULT_LOCALE];
}

/**
 * Coerce a persisted value into a known locale. An unknown language is a typo, not a reason
 * to fall back to silence, so English wins. The runtime guard stays because a hand-written
 * JSON file can still violate the type.
 */
export function normalizeLocale(value: string | null | undefined): Locale {
	return typeof value === "string" && LOCALES.includes(value as Locale)
		? (value as Locale)
		: DEFAULT_LOCALE;
}

/** Every label key, for the completeness test and for the command's `lang` help. */
export const LABEL_GROUPS = [
	"needs",
	"needStates",
	"loadLevels",
	"progressStates",
	"flowStates",
	"interventionKinds",
] as const;

/** Compile-time proof that the label maps name every enum member. Unused at runtime. */
export const LABEL_SOURCES = {
	needs: NEEDS,
	needStates: NEED_STATES,
	loadLevels: LOAD_LEVELS,
	progressStates: PROGRESS_STATES,
	flowStates: FLOW_STATES,
	interventionKinds: INTERVENTION_KINDS,
} as const;