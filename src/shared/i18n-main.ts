/**
 * i18n-main — the string table itself (the vocabulary the user reads), split out of `i18n.ts`
 * by concept and to keep either file under the line budget. `i18n.ts` is the public barrel: it
 * owns the locale list, the lookup and the coercion, and re-exports the types defined here.
 */

import { CARD_CS, CARD_EN, type CardStrings } from "./i18n-card.js";
import { CS_LABELS, EN_LABELS, type Labels } from "./i18n-labels.js";
import { NOTICE_CS, NOTICE_EN, type NoticeStrings } from "./i18n-notices.js";
import { REPLAY_CS, REPLAY_EN, type ReplayStrings } from "./i18n-replay.js";
import { RUN_CS, RUN_EN, type RunStrings } from "./i18n-runs.js";

export const LOCALES = ["en", "cs"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export interface Strings extends RunStrings, CardStrings, NoticeStrings, ReplayStrings {
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
	/**
	 * Appended to the chip when the observer model IS the working session's model: the observer is
	 * not a second opinion. Short, because the chip is one line (the full sentence is in `/psych`).
	 */
	chipSameModel: string;

	/** The `/psych` report. */
	reportTitle: string;
	reportSignals: string;
	reportSession: string;
	/** The objective repo-map section heading (T8). */
	reportRepoMap: string;
	/** Shown when `mapRepo` is off or `cwd` is outside a git work tree (T8). */
	reportMapUnavailable: string;
	/** `map age: N turn(s)` — shown only once the cached map has gone stale (T8). */
	reportMapAge: (n: number) => string;
	reportAppraisal: string;
	/** `/psych` line when the observer model equals the working session's model. */
	reportSameModel: string;
	reportNone: string;
	reportNever: string;
	reportEmpty: string;
	reportWhy: string;
	reportErr: string;
	reportSpend: string;
	reportBudget: (used: number, cap: string) => string;
	reportDisabled: string;
	reportNoModel: string;
	/** `trigger   signals` — which rule decides when the appraiser runs. */
	reportTrigger: string;
	/** `triggered by failure_streak, restatement` — the reasons the last appraisal fired. */
	reportTriggered: string;
	/** `appraisals skipped: N (no new evidence)` — the measured saving of the trigger rule. */
	reportSkipped: (n: number) => string;
	/** `/psych effect` — whether the delivered interventions helped (T16). */
	effectTitle: string;
	/** Shown when nothing was delivered this session, so an empty table is never a silent one. */
	effectEmpty: string;
	/** Column headings for the per-kind effect table. */
	effectColumns: { kind: string; delivered: string; improved: string; unchanged: string; worse: string; followed: string };
	/**
	 * The delivery-boundary notification (T15): a commit shipped a change set no run ever proved.
	 * English mirrors the evidence line exactly; the count is the number of file changes.
	 */
	commitUnverified: (count: number) => string;

	/** Command surface. */
	commandDescription: string;
	usage: string;
	unknownOption: string;
	configWritten: (path: string) => string;
	configSeeded: (path: string) => string;
	/** What each subcommand does, for the picker's description column. */
	cmdStatus: string;
	cmdNow: string;
	cmdEffect: string;
	/** `/psych ask <question>` (T30). */
	cmdAsk: string;
	/** `/psych scout [topic]` (T31). */
	cmdScout: string;
	/** `/psych review` (T32a): review the change since the last delivery. */
	cmdReview: string;
	/** The reviewer role needs the agent runtime (T32a). */
	reviewNeedsAgent: string;
	/** The reviewer role's consent gate is off (T32a). */
	reviewDisabled: string;
	/** `/psych review` outside a git repository: nothing to review (T32a). */
	reviewNoGit: string;
	/** The scout role needs the agent runtime (T31); the reason is named, not the failure. */
	scoutNeedsAgent: string;
	/** The scout role's consent gate is off (T31). */
	scoutDisabled: string;
	/** One scout candidate in the notification fallback: name, fit, why, install spec and url. */
	notifyScoutCandidate: (name: string, fit: string, why: string, installSpec: string, url: string) => string;
	/** An unset setting, shown in a parent row rather than a bare dash. */
	notSet: string;
	/** `(now: 12)` — a parent row's value, labelled. */
	nowValue: (value: string) => string;
	/** The trailing `--global` flag on a setting command. */
	globalFlag: string;
	/** The model picker's overflow row: how many entries were not shown. */
	modelMore: (n: number) => string;
	/** The estimated price of one appraisal, shown next to a model in the picker. */
	costPerAppraisal: (usd: string) => string;
	/** Shown instead of a price when the registry rate is unknown — never a guess. */
	priceUnknown: string;
	typeToNarrow: string;
	modelSet: (model: string) => string;
	languageSet: (lang: string) => string;
	budgetSet: (n: string) => string;
	enabled: string;
	disabled: string;
	notTui: string;
	done: string;
	/** `/psych now` while another appraisal is already running. */
	busy: string;
	/** The chip when `runtime: "agent"` but no model resolves: observation only, said out loud. */
	chipAgentNoModel: string;
	/** The subcommand descriptions for the runtime switch. */
	cmdRuntime: string;
	cmdContext: string;
	cmdAgentModel: string;
	runtimeSet: (mode: string) => string;
	contextSet: (level: string) => string;
	agentModelSet: (model: string) => string;
	/** Shown when `--psych-runtime` carries something other than `api`/`agent`. */
	runtimeFlagInvalid: (value: string) => string;
	/** The consent dialog before `digest`/`fork` is persisted: it states what leaves the machine. */
	contextConfirmTitle: string;
	contextConfirmBody: (level: string) => string;
	/** Outside a terminal there is nobody to confirm consent for `digest`/`fork`. */
	contextNeedsTui: string;
	/** The run-time consent for the first `fork` of a session, with the size and price estimate. */
	contextForkConfirmTitle: string;
	contextForkConfirm: (tokens: string, price: string) => string;
	/** The same confirm when the child model's price is unknown: tokens only. */
	contextForkConfirmTokens: (tokens: string) => string;
	/** `fork` was configured but this session has no file to fork (an ephemeral parent). */
	contextForkNoSession: string;
	/** `fork` was configured but there is no terminal to confirm it in. */
	contextForkNeedsTui: string;
	/** Report row labels for the runtime switch. */
	reportRuntime: string;
	reportContext: string;
	reportAgentModel: string;
	labels: Labels;
	/**
	 * The names of the three verdict ROWS. Distinct from `labels.progressStates` etc., which
	 * name the values inside them: using a state word as a row label renders `high high` and
	 * `advancing blocked`, which reads as nonsense.
	 */
	fields: { progress: string; load: string; flow: string };
}

export const EN: Strings = {
	...RUN_EN,
	...CARD_EN,
	...NOTICE_EN,
	...REPLAY_EN,
	chipOff: "psych: off",
	chipSignals: "psych: signals",
	chipConfigError: "psych: check model",
	chipAppraisal: (waiting, budget) => `psych ${waiting} · ${budget}`,
	chipSameModel: "same model",

	cardFooter: { close: "close", scroll: "scroll" },

	reportTitle: "DEVELOPER PSYCHOLOGIST",
	reportSignals: "Observed signals",
	reportSession: "Session record",
	reportRepoMap: "Repo map",
	reportMapUnavailable: "repo map unavailable",
	reportMapAge: (n) => `map age: ${n} turn(s)`,
	reportAppraisal: "Appraisal",
	reportSameModel: "the observer is the same model as the working agent",
	reportNone: "Not yet: no appraisal has run. Set a model with /psych model <provider/id>.",
	reportNever: "no appraisal yet",
	reportEmpty: "nothing to report",
	reportWhy: "why",
	reportErr: "last appraisal failed",
	reportSpend: "appraisal spend (not counted by the session meter)",
	reportBudget: (used, cap) => `budget ${used}/${cap}`,
	reportDisabled: "The psychologist is off. Turn it on with: /psych on",
	reportNoModel: "No psychologist model configured. Set one with: /psych model <provider/id>",
	reportTrigger: "trigger  ",
	reportTriggered: "triggered by",
	reportSkipped: (n) => `appraisals skipped: ${n} (no new evidence)`,
	effectTitle: "INTERVENTION EFFECT",
	effectEmpty: "nothing delivered yet this session",
	effectColumns: {
		kind: "kind",
		delivered: "delivered",
		improved: "improved",
		unchanged: "unchanged",
		worse: "worse",
		followed: "followed",
	},
	commitUnverified: (count) => `commit after ${count} file change(s) with no verified run since`,

	commandDescription: "Developer psychologist: appraisal now, state, and settings",
	cmdStatus: "show the report",
	cmdNow: "run an appraisal now",
	cmdEffect: "show whether the interventions helped",
	cmdAsk: "ask the observer a direct question",
	cmdScout: "find an existing plugin for recurring friction, or a gap worth building",
	cmdReview: "review the change since the last delivery against the stated conventions",
	reviewNeedsAgent: "Reviewing needs the agent runtime. Set it with: /psych runtime agent",
	reviewDisabled: "The reviewer role is off. Set roles.reviewer.enabled in the config file to enable it.",
	reviewNoGit: "This project is not a git repository, so there is no delivery to review.",
	scoutNeedsAgent: "Scouting needs the agent runtime. Set it with: /psych runtime agent",
	scoutDisabled: "The scout role is off. Set roles.scout.enabled in the config file to enable it.",
	notifyScoutCandidate: (name, fit, why, installSpec, url) => `${name} (${fit}) — ${why}\n${installSpec}\n${url}`,
	notSet: "(not set)",
	nowValue: (value) => `(now: ${value})`,
	// The help must not advertise a `global` subcommand: it is a trailing flag, and a user who
	// followed the old text got "Unknown option: global".
	usage: "Usage: /psych [status|now|stop|effect|ask <question>|scout [topic]|review|on|off|model <provider/id>|budget <n>|lang <en|cs>|runtime <api|agent>|context <evidence|digest|fork>|agent-model <provider/id>] [--global]",
	unknownOption: "Unknown option",
	configWritten: (path) => `Config written to ${path}`,
	configSeeded: (path) => `pi-devs-psychologist: config created at ${path}`,
	globalFlag: "write to ~/.pi/agent instead of the project",
	modelMore: (n) => `… ${n} more`,
	costPerAppraisal: (usd) => `(~$${usd} per appraisal)`,
	priceUnknown: "price unknown",
	typeToNarrow: "type to narrow",
	modelSet: (model) => `Psychologist model set to ${model}`,
	languageSet: (lang) => `Language set to ${lang}`,
	budgetSet: (n) => `Appraisals per session set to ${n}`,
	enabled: "Psychologist on",
	disabled: "Psychologist off",
	notTui: "This view needs a terminal UI. Use /psych status for the text report.",
	done: "Appraisal complete.",
	busy: "An appraisal is already running.",
	chipAgentNoModel: "psych: agent, no model",
	cmdRuntime: "switch between the API call and a child pi agent",
	cmdContext: "how much session context the child agent may see",
	cmdAgentModel: "model for the child agent (empty = the shared model)",
	runtimeSet: (mode) => `Runtime set to ${mode}`,
	contextSet: (level) => `Context level set to ${level}`,
	agentModelSet: (model) => `Agent model set to ${model}`,
	runtimeFlagInvalid: (value) => `Ignoring --psych-runtime ${value}: use api or agent`,
	contextConfirmTitle: "Send session context to the child agent?",
	contextConfirmBody: (level) =>
		level === "fork"
			? "The child agent will be given the entire session, tool outputs included, and sends it to the model provider."
			: "The child agent will be given scrubbed excerpts of your prompts and the assistant's text, sent to the model provider.",
	contextNeedsTui: "Setting digest or fork needs a terminal UI. Set agent.context in the config file instead.",
	contextForkConfirmTitle: "Fork your session into the child agent?",
	contextForkConfirm: (tokens, price) =>
		`The child agent will be given the entire session, tool outputs included (~${tokens} input tokens, about $${price} at the observer's rate). Continue?`,
	contextForkConfirmTokens: (tokens) =>
		`The child agent will be given the entire session, tool outputs included (~${tokens} input tokens; the observer's price is unknown). Continue?`,
	contextForkNoSession:
		"Session context is set to fork, but this session has no file to fork. Using digest instead.",
	contextForkNeedsTui:
		"Fork needs a terminal UI to confirm. Using digest instead; set agent.context in the config file to change this.",
	reportRuntime: "runtime  ",
	reportContext: "context  ",
	reportAgentModel: "agent    ",

	labels: EN_LABELS,
	fields: { progress: "Progress", load: "Load", flow: "Flow" },
};

export const CS: Strings = {
	...RUN_CS,
	...CARD_CS,
	...NOTICE_CS,
	...REPLAY_CS,
	chipOff: "psych: vyp",
	chipSignals: "psych: signály",
	chipConfigError: "psych: zkontroluj model",
	chipAppraisal: (waiting, budget) => `psych ${waiting} · ${budget}`,
	chipSameModel: "stejný model",

	cardFooter: { close: "zavřít", scroll: "posun" },

	reportTitle: "VÝVOJÁŘSKÝ PSYCHOLOG",
	reportSignals: "Zjištěné signály",
	reportSession: "Záznam relace",
	reportRepoMap: "Mapa repa",
	reportMapUnavailable: "mapa repa nedostupná",
	reportMapAge: (n) => `stáří mapy: ${n} tahů`,
	reportAppraisal: "Posouzení",
	reportSameModel: "pozorovatel je stejný model jako pracovní agent",
	reportNone: "Zatím ne: posouzení ještě neproběhlo. Nastav model: /psych model <provider/id>.",
	reportNever: "posouzení zatím žádné",
	reportEmpty: "není co hlásit",
	reportWhy: "proč",
	reportErr: "poslední posouzení selhalo",
	reportSpend: "výdaj za posouzení (do měřiče relace se nepočítá)",
	reportBudget: (used, cap) => `rozpočet ${used}/${cap}`,
	reportDisabled: "Psycholog je vypnutý. Zapneš ho: /psych on",
	reportNoModel: "Není nastavený model psychologa. Nastav ho: /psych model <provider/id>",
	reportTrigger: "spouštěč ",
	reportTriggered: "spuštěno:",
	reportSkipped: (n) => `posouzení přeskočeno: ${n} (žádný nový důkaz)`,
	effectTitle: "ÚČINEK ZÁSAHŮ",
	effectEmpty: "v této relaci zatím nic předáno",
	effectColumns: {
		kind: "druh",
		delivered: "předáno",
		improved: "zlepšeno",
		unchanged: "beze změny",
		worse: "horší",
		followed: "následováno",
	},
	commitUnverified: (count) => `commit po ${count} změnách bez ověřeného běhu`,

	commandDescription: "Vývojářský psycholog: posouzení teď, stav a nastavení",
	cmdStatus: "zobrazit report",
	cmdNow: "spustit posouzení teď",
	cmdEffect: "zobrazit, zda zásahy pomohly",
	cmdAsk: "zeptat se pozorovatele přímo",
	cmdScout: "najít existující plugin pro opakující se tření, nebo mezeru k postavení",
	cmdReview: "posoudit změnu od poslední dodávky vuči uvedeným konvencím",
	reviewNeedsAgent: "Posuzování vyžaduje agent runtime. Nastav: /psych runtime agent",
	reviewDisabled: "Role recenzenta je vypnutá. Zapni ji přes roles.reviewer.enabled v konfiguračním souboru.",
	reviewNoGit: "Tento projekt není git repozitář, takže není žádná dodávka k posouzení.",
	scoutNeedsAgent: "Skauting vyžaduje agent runtime. Nastav: /psych runtime agent",
	scoutDisabled: "Role skauta je vypnutá. Zapni ji přes roles.scout.enabled v konfiguračním souboru.",
	notifyScoutCandidate: (name, fit, why, installSpec, url) => `${name} (${fit}) — ${why}\n${installSpec}\n${url}`,
	notSet: "(nenastaveno)",
	nowValue: (value) => `(nyní: ${value})`,
	usage: "Použití: /psych [status|now|stop|effect|ask <dotaz>|scout [téma]|review|on|off|model <provider/id>|budget <n>|lang <en|cs>|runtime <api|agent>|context <evidence|digest|fork>|agent-model <provider/id>] [--global]",
	unknownOption: "Neznámá volba",
	configWritten: (path) => `Konfigurace zapsána do ${path}`,
	configSeeded: (path) => `pi-devs-psychologist: konfigurace vytvořena v ${path}`,
	globalFlag: "zapsat do ~/.pi/agent místo do projektu",
	modelMore: (n) => `… dalších ${n}`,
	costPerAppraisal: (usd) => `(~$${usd} za posouzení)`,
	priceUnknown: "cena neznámá",
	typeToNarrow: "piš dál pro zúžení",
	modelSet: (model) => `Model psychologa nastaven na ${model}`,
	languageSet: (lang) => `Jazyk nastaven na ${lang}`,
	budgetSet: (n) => `Počet posouzení na relaci nastaven na ${n}`,
	enabled: "Psycholog zapnut",
	disabled: "Psycholog vypnut",
	notTui: "Toto zobrazení potřebuje terminálové UI. Použij /psych status pro textový report.",
	done: "Posouzení dokončeno.",
	busy: "Posouzení už běží.",
	chipAgentNoModel: "psych: agent, bez modelu",
	cmdRuntime: "přepnout mezi voláním API a podřízeným pi agentem",
	cmdContext: "kolik kontextu relace smí podřízený agent vidět",
	cmdAgentModel: "model pro podřízeného agenta (prázdné = sdílený model)",
	runtimeSet: (mode) => `Runtime nastaven na ${mode}`,
	contextSet: (level) => `Úroveň kontextu nastavena na ${level}`,
	agentModelSet: (model) => `Model agenta nastaven na ${model}`,
	runtimeFlagInvalid: (value) => `Přepínač --psych-runtime ${value} ignorován: použij api nebo agent`,
	contextConfirmTitle: "Poslat kontext relace podřízenému agentovi?",
	contextConfirmBody: (level) =>
		level === "fork"
			? "Podřízený agent dostane celou relaci včetně výstupů nástrojů a pošle ji poskytovateli modelu."
			: "Podřízený agent dostane očištěné výňatky z tvých zadání a textu asistenta a pošle je poskytovateli modelu.",
	contextNeedsTui: "Nastavení digest nebo fork vyžaduje terminálové UI. Nastav agent.context v konfiguračním souboru.",
	contextForkConfirmTitle: "Rozdělit relaci do podřízeného agenta?",
	contextForkConfirm: (tokens, price) =>
		`Podřízený agent dostane celou relaci včetně výstupů nástrojů (~${tokens} vstupních tokenů, asi $${price} za sazbu pozorovatele). Pokračovat?`,
	contextForkConfirmTokens: (tokens) =>
		`Podřízený agent dostane celou relaci včetně výstupů nástrojů (~${tokens} vstupních tokenů; cena pozorovatele není známa). Pokračovat?`,
	contextForkNoSession:
		"Úroveň kontextu je fork, ale tato relace nemá soubor k rozdělení. Použije se digest.",
	contextForkNeedsTui:
		"Fork vyžaduje terminálové UI pro potvrzení. Použije se digest; změň to přes agent.context v konfiguračním souboru.",
	reportRuntime: "runtime  ",
	reportContext: "kontext  ",
	reportAgentModel: "agent    ",

	labels: CS_LABELS,
	fields: { progress: "Postup", load: "Zátěž", flow: "Tok" },
};

/**
 * `satisfies` rather than `: Record<Locale, Strings>`: it still rejects a locale missing a
 * key (the invariant above), but keeps each locale's literal types instead of widening them.
 */
