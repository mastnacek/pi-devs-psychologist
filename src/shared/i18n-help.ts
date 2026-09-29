/**
 * i18n-help — the vocabulary for `/psych help [item]`.
 *
 * Split out of the main table by concept (and to keep each file under the line budget), like
 * `i18n-notices.ts` and the other satellites: `/psych help` is the setup vocabulary, and it is the
 * only place that answers both questions a new user has about a setting — *what is this item* and
 * *what happens after I set it*. The picker's one-word descriptions cannot carry that, and a user
 * who has to leave the picker to read a README is a user who does not set the item up.
 *
 * The per-item detail text is deliberately prose, not terse: help is where length is the point.
 * Everything else in this table stays short because it is read many times; this is read once,
 * when the operator is deciding.
 */

/** The items `/psych help` explains. Each is command-settable; `global` is the one that is a flag. */
export type HelpTopic =
	| "model"
	| "budget"
	| "lang"
	| "runtime"
	| "context"
	| "agent-model"
	| "role"
	| "on"
	| "global";

export interface HelpStrings {
	/** The bare `/psych help` header. */
	helpTitle: string;
	/** The one paragraph under the header: the only item that must be set, and where to look next. */
	helpOverview: string;
	/** The closing line: how to read one item in full. */
	helpFooter: string;
	/** The items, in the order the bare listing prints them. */
	helpTopics: readonly HelpTopic[];
	/** The one-line listing entry per item. Short: it is the menu; the detail text is the manual. */
	helpLine: Record<HelpTopic, string>;
	/** The full explanation per item: what it is, what happens after you set it, how to check. */
	helpDetail: Record<HelpTopic, string>;
	/** An unknown item: name the items that exist, so the typo is correctable without re-typing `/psych help`. */
	helpUnknown: (item: string, items: string) => string;
	/** The picker description for the `help` subcommand. */
	cmdHelp: string;
}

export const HELP_EN: HelpStrings = {
	helpTitle: "SETUP — what each setting is, and what happens after you set it",
	helpOverview:
		"The one item the plugin needs is the observer model: /psych model <provider/id>. " +
		"With none set it observes and reports signals but never spends a token. " +
		"Everything else ships with a default that is safe to keep.",
	helpFooter: "/psych help <item> — the full text for one item.",
	helpTopics: ["model", "budget", "lang", "runtime", "context", "agent-model", "role", "on", "global"],
	helpLine: {
		model: "the observer model (provider/modelId); empty = no model call ever",
		budget: "max appraisal attempts per session; 0 = unlimited (not recommended)",
		lang: "the plugin's own UI language (en|cs); switches at once",
		runtime: "api = one completion call per appraisal; agent = a child pi with tools",
		context: "what the child agent may see (agent runtime): evidence | digest | fork",
		"agent-model": "model for the child agent; empty = the shared observer model",
		role: "turn the scout or reviewer role on/off: /psych role scout|reviewer on|off",
		on: "the master switch; off observes nothing and spends nothing",
		global: "trailing flag: write the setting for every project, not just this one",
	},
	helpDetail: {
		model:
			"WHAT\n" +
			"  The model that plays the psychologist, as provider/modelId — the same reference\n" +
			"  the model picker offers. It should be a DIFFERENT model than the one doing the work:\n" +
			"  an observer sharing the working model's blind spots is not an observer.\n\n" +
			"AFTER YOU SET IT\n" +
			"  · A window of new evidence (a tool failure, a restatement, verified progress, …) triggers\n" +
			"    an appraisal. Each appraisal is one completion call; the model picker showed the\n" +
			"    estimated price per appraisal next to the reference you picked.\n" +
			"  · maxAppraisalsPerSession caps the attempts, so a set model cannot run unbounded.\n" +
			"  · The chip and /psych status switch from signals-only to showing the appraisal state.\n\n" +
			"EMPTY (the default)\n" +
			"  Observation with zero model spend: signals and the objective report still work.\n\n" +
			"CHECK: /psych status — or the chip.",
		budget:
			"WHAT\n" +
			"  maxAppraisalsPerSession — the hard ceiling on appraisal ATTEMPTS in this session.\n" +
			"  It caps /psych now too: now ignores the cadence, never the budget.\n\n" +
			"AFTER YOU SET IT\n" +
			"  · Attempts stop at the ceiling until the next session starts.\n" +
			"  · 0 means unlimited — not recommended: an observer that can call itself unlimited\n" +
			"    times is a billing incident, not a psychologist.\n\n" +
			"CHECK: the chip — it reads used/cap (e.g. `psych 3t · 2/12`).",
		lang:
			"WHAT\n" +
			"  The language of the plugin's OWN text: the report, the cards, this help, the picker.\n" +
			"  Text written for the model stays English in every locale — a translated evidence\n" +
			"  line would change the model's reading of the numbers.\n\n" +
			"AFTER YOU SET IT\n" +
			"  · The next render uses it — no reload needed.\n" +
			"  · With --global it becomes the language in every project that does not override it.\n\n" +
			"CHECK: run /psych again — the report answers in the language you set.",
		runtime:
			"WHAT\n" +
			"  How an appraisal is formed.\n" +
			"  · api (the default): one completion call that receives the factual evidence lines.\n" +
			"    Cheap, no tools, the answer is one card.\n" +
			"  · agent: a headless child pi with its own model, tools and cost caps. Needed by\n" +
			"    /psych scout and /psych review, which inspect the repo rather than the evidence.\n\n" +
			"AFTER YOU SET IT\n" +
			"  · The switch is read at call time — no reload, the next appraisal runs on it.\n" +
			"  · agent needs agent-model (or falls back to the shared observer model) and obeys the\n" +
			"    agent cost caps (agent.maxCostUsd per run, agent.maxCostUsdPerSession).\n\n" +
			"CHECK: /psych status — the report names the runtime in effect.",
		context:
			"WHAT\n" +
			"  How much session context the child agent may see (agent runtime only):\n" +
			"  · evidence (the default): the factual evidence lines only. Nothing raw leaves the machine.\n" +
			"  · digest: cleaned excerpts of your prompts and the assistant's text. That is content,\n" +
			"    so setting it asks for confirmation and is persisted as a decision, never a one-run flag.\n" +
			"  · fork: the whole session, including tool outputs — the widest consent, same confirmation.\n\n" +
			"AFTER YOU SET IT\n" +
			"  · The next child spawn runs at that level. digest and fork need a terminal UI to confirm;\n" +
			"    in json/print mode they are refused rather than assumed.\n\n" +
			"CHECK: /psych status — the report names the context level.",
		"agent-model":
			"WHAT\n" +
			"  The model the child agent runs on (agent runtime only). Empty means the shared\n" +
			"  observer model is used, so /psych model alone is a complete agent-runtime setup.\n\n" +
			"AFTER YOU SET IT\n" +
			"  · The next agent-runtime appraisal, /psych scout or /psych review runs on it.\n" +
			"  · The picker and /psych status show the RESOLVED model — agent-model when set,\n" +
			"    otherwise the shared one — so there is never a hidden default.\n\n" +
			"CHECK: /psych status — the agent row names the resolved model.",
		role:
			"WHAT\n" +
			"  The consent gates of the two optional roles, both OFF by default:\n" +
			"  · scout — /psych scout finds an existing plugin for recurring friction. It costs model\n" +
			"    money, so nothing runs until you turn it on.\n" +
			"  · reviewer — /psych review reads the repo's source code with a model that leaves the\n" +
			"    machine, so it is its own gate, separate from the psychologist's model.\n\n" +
			"AFTER YOU SET IT\n" +
			"  · /psych role scout on — /psych scout runs (it also needs runtime: agent).\n" +
			"  · /psych role reviewer on — /psych review runs (also needs runtime: agent).\n" +
			"  · off — the role refuses with a notice naming this command; nothing runs, nothing spends.\n\n" +
			"CHECK: bare /psych role lists both gates with their states.",
		on:
			"WHAT\n" +
			"  The master switch. OFF: the plugin observes nothing, spends nothing, and the chip\n" +
			"  reads `psych: off`. ON: observation and the trigger rule resume.\n\n" +
			"AFTER YOU SET IT\n" +
			"  · on — the next window of evidence can trigger an appraisal (if a model is set).\n" +
			"  · off — nothing is recorded, nothing is called; the config stays, so /psych on\n" +
			"    restores the previous settings exactly.\n\n" +
			"CHECK: the chip, or /psych status.",
		global:
			"WHAT\n" +
			"  A trailing flag on any setting command, e.g. /psych lang cs --global. WITHOUT it the\n" +
			"  value is written to <cwd>/.pi/pi-devs-psychologist.json — this project only.\n\n" +
			"AFTER YOU SET IT (with the flag)\n" +
			"  · The value lands in ~/.pi/agent/pi-devs-psychologist.json and applies to every\n" +
			"    project that does not override it. The cascade is defaults <- global <- project,\n" +
			"    and the project file wins, so a project can always disagree.\n\n" +
			"CHECK: the command says which file it wrote.",
	},
	helpUnknown: (item, items) => `Unknown help item: ${item}. Items: ${items}`,
	cmdHelp: "explain a setting: what it is and what happens after you set it",
};

export const HELP_CS: HelpStrings = {
	helpTitle: "NASTAVENÍ — co každá položka je a co se stane po jejím nastavení",
	helpOverview:
		"Jediné, co plugin potřebuje, je model pozorovatele: /psych model <provider/id>. " +
		"Bez něj jen sleduje a hlásí signály, ale neutratí ani token. " +
		"Všechno ostatní má výchozí hodnotu, se kterou lze spokojeně zůstat.",
	helpFooter: "/psych help <položka> — celý text pro jednu položku.",
	helpTopics: ["model", "budget", "lang", "runtime", "context", "agent-model", "role", "on", "global"],
	helpLine: {
		model: "model pozorovatele (provider/modelId); prázdné = nikdy žádné volání modelu",
		budget: "maximální počet pokusů o posouzení za relaci; 0 = bez limitu (nedoporučuje se)",
		lang: "jazyk vlastních textů pluginu (en|cs); přepne se hned",
		runtime: "api = jedno volání modelu na posouzení; agent = podřízený pi s nástroji",
		context: "co uvidí podřízený agent (agent runtime): evidence | digest | fork",
		"agent-model": "model pro podřízeného agenta; prázdné = společný model pozorovatele",
		role: "zapnout nebo vypnout roli scout nebo reviewer: /psych role scout|reviewer on|off",
		on: "hlavní vypínač; vypnuto = nic nesleduje a nic neutratí",
		global: "příznak na konci: uložit nastavení pro všechny projekty, ne jen tenhle",
	},
	helpDetail: {
		model:
			"CO\n" +
			"  Model, který hraje psychologa, jako provider/modelId — stejný formát, jaký nabízí\n" +
			"  výběr modelů. Měl by být JINÝ než model, který dělá práci: pozorovatel sdílející\n" +
			"  slepá místa pracovního modelu není pozorovatel.\n\n" +
			"PO NASTAVENÍ\n" +
			"  · Okno s novými důkazy (selhání nástroje, opakovaný dotaz, ověřený pokrok, …)\n" +
			"    spustí posouzení. Každé posouzení je jedno volání modelu; výběr modelů ukazoval\n" +
			"    odhad ceny za posouzení vedle zvoleného odkazu.\n" +
			"  · maxAppraisalsPerSession stropí počet pokusů, takže nastavený model nemůže běžet bez limitu.\n" +
			"  · Čip i /psych status přepnou ze samotných signálů na stav posouzení.\n\n" +
			"PRÁZDNÉ (výchozí)\n" +
			"  Sledování bez utraceného tokenu: signály a objektivní report fungují dál.\n\n" +
			"KONTROLA: /psych status — nebo čip.",
		budget:
			"CO\n" +
			"  maxAppraisalsPerSession — tvrdý strop POKUSŮ o posouzení v této relaci.\n" +
			"  Stropí i /psych now: now ignoruje kadenci, nikdy ne strop.\n\n" +
			"PO NASTAVENÍ\n" +
			"  · Pokusy se u stropu zastaví až do nové relace.\n" +
			"  · 0 znamená bez limitu — nedoporučuje se: pozorovatel, který si může volat\n" +
			"    neomezeně sám na sebe, je účetní incident, ne psycholog.\n\n" +
			"KONTROLA: čip — ukazuje used/cap (např. `psych 3t · 2/12`).",
		lang:
			"CO\n" +
			"  Jazyk VLASTNÍCH textů pluginu: report, karty, tahle nápověda, výběr možností.\n" +
			"  Text psaný pro model zůstává anglicky v každém jazyce — přeložený řádek důkazů\n" +
			"  by změnil čtení čísel modelem.\n\n" +
			"PO NASTAVENÍ\n" +
			"  · Další výpis ho použije — bez nutnosti načítat znovu.\n" +
			"  · S --global to bude jazyk všech projektů, které ho nepřepíší.\n\n" +
			"KONTROLA: spusť /psych znovu — report odpovídá nastaveným jazykem.",
		runtime:
			"CO\n" +
			"  Jak se posouzení vytvoří.\n" +
			"  · api (výchozí): jedno volání modelu, které dostane řádky s faktickými důkazy.\n" +
			"    Levné, bez nástrojů, odpověď je jedna karta.\n" +
			"  · agent: bezhlavý podřízený pi s vlastním modelem, nástroji a stropy nákladů.\n" +
			"    Potřebují ho /psych scout a /psych review, které se dívají do repozitáře, ne na důkazy.\n\n" +
			"PO NASTAVENÍ\n" +
			"  · Přepínač se čte při volání — bez opětovného načtení, další posouzení už běží na něm.\n" +
			"  · agent potřebuje agent-model (nebo se vrátí ke společnému modelu pozorovatele)\n" +
			"    a drží stropy agenta (agent.maxCostUsd na běh, agent.maxCostUsdPerSession).\n\n" +
			"KONTROLA: /psych status — report pojmenovává běžící režim.",
		context:
			"CO\n" +
			"  Kolik kontextu relace smí vidět podřízený agent (jen v agent runtime):\n" +
			"  · evidence (výchozí): jen řádky s faktickými důkazy. Nic syrového neopouští stroj.\n" +
			"  · digest: očištěné výňatky z tvých zadání a textu asistenta. To už je obsah, takže\n" +
			"    nastavení žádá potvrzení a ukládá se jako rozhodnutí, ne jako přepínač na jedno spuštění.\n" +
			"  · fork: celá relace včetně výstupů nástrojů — nejširší souhlas, stejné potvrzení.\n\n" +
			"PO NASTAVENÍ\n" +
			"  · Další spuštění podřízeného agenta běží na téhle úrovni. digest a fork potřebují\n" +
			"    terminálové UI kvůli potvrzení; v režimu json/print jsou odmítnuty, ne předpokládány.\n\n" +
			"KONTROLA: /psych status — report pojmenovává úroveň kontextu.",
		"agent-model":
			"CO\n" +
			"  Model, na kterém běží podřízený agent (jen v agent runtime). Prázdné znamená\n" +
			"  společný model pozorovatele, takže samotné /psych model stačí jako kompletní nastavení.\n\n" +
			"PO NASTAVENÍ\n" +
			"  · Další posouzení v agent režimu, /psych scout nebo /psych review běží na něm.\n" +
			"  · Výběr modelů i /psych status ukazují VYŘEŠENÝ model — agent-model, když je nastaven,\n" +
			"    jinak ten společný — takže skrytá výchozí hodnota neexistuje.\n\n" +
			"KONTROLA: /psych status — řádek agenta pojmenovává vyřešený model.",
		role:
			"CO\n" +
			"  Souhlasové brány dvou volitelných rolí, obě výchozí vypnuté:\n" +
			"  · scout — /psych scout najde existující plugin pro opakující se tření. Stojí peníze\n" +
			"    za model, takže nic neběží, dokud ho nezapneš.\n" +
			"  · reviewer — /psych review čte zdrojový kód repozitáře modelem, který opouští stroj,\n" +
			"    takže má vlastní bránu, oddělenou od modelu psychologa.\n\n" +
			"PO NASTAVENÍ\n" +
			"  · /psych role scout on — /psych scout poběží (potřebuje taky runtime: agent).\n" +
			"  · /psych role reviewer on — /psych review poběží (také potřebuje runtime: agent).\n" +
			"  · vyp — role odmítne s upozorněním, které pojmenovává tenhle příkaz; nic neběží, nic neutratí.\n\n" +
			"KONTROLA: samotné /psych role vypíše obě brány s jejich stavy.",
		on:
			"CO\n" +
			"  Hlavní vypínač. VYP: plugin nic nesleduje, nic neutratí a čip čte `psych: off`.\n" +
			"  ZAP: sledování a pravidlo spouštěče se obnoví.\n\n" +
			"PO NASTAVENÍ\n" +
			"  · zap — další okno důkazů může spustit posouzení (když je nastaven model).\n" +
			"  · vyp — nic se nezaznamenává a nic se nevolá; konfigurace zůstává, takže /psych on\n" +
			"    obnoví předchozí nastavení přesně tak, jak bylo.\n\n" +
			"KONTROLA: čip, nebo /psych status.",
		global:
			"CO\n" +
			"  Příznak na konci libovolného nastavovacího příkazu, např. /psych lang cs --global.\n" +
			"  BEZ něj se hodnota zapíše do <cwd>/.pi/pi-devs-psychologist.json — jen pro tenhle projekt.\n\n" +
			"PO NASTAVENÍ (s příznakem)\n" +
			"  · Hodnota skončí v ~/.pi/agent/pi-devs-psychologist.json a platí pro každý projekt,\n" +
			"    který ji nepřepíše. Kaskáda je výchozí <- globální <- projekt, a soubor projektu\n" +
			"    vyhrává, takže se projekt může vždycky odsoudit.\n\n" +
			"KONTROLA: příkaz řekne, do kterého souboru zapsal.",
	},
	helpUnknown: (item, items) => `Neznámá položka nápovědy: ${item}. Položky: ${items}`,
	cmdHelp: "vysvětlit nastavení: co to je a co se stane po nastavení",
};
