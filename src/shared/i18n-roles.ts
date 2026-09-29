/**
 * i18n-roles — the vocabulary for `/psych role` and the plain-word value descriptions.
 *
 * Split out of the main table by concept (and to keep each file under the line budget), like the
 * other satellites. Two jobs:
 *
 * - `/psych role <scout|reviewer> <on|off>`: the consent gates of the two optional roles get a
 *   command path, because a gate that can only be enabled by editing a JSON file is a gate the
 *   operator has to study before using — the exact complaint that motivated `/psych help`. The
 *   notice the operator sees when a role refuses now names this command, not the config file.
 * - the plain-word one-liners for the `runtime` and `context` values. The picker previously
 *   marked only WHICH value was active, never what the words meant, so a new user saw
 *   "api | agent" and "evidence | digest | fork" with no way to choose. These strings are the
 *   descriptions under each child row: the meaning is readable in the menu, before descending.
 */

export interface RoleStrings {
	/** The picker description for the `role` subcommand. */
	cmdRole: string;
	/** `/psych role` with no arguments: both gates with their states. */
	roleList: (scout: string, reviewer: string) => string;
	/** The value rows in the bare listing. */
	roleStateOn: string;
	roleStateOff: string;
	/** The one-liner per role, shown in the picker and the listing. */
	roleScoutDesc: string;
	roleReviewerDesc: string;
	/** The set confirmation. */
	roleSet: (role: string, state: string) => string;
	/** An unknown role or state: names what exists. */
	roleUnknown: (tokens: string, allowed: string) => string;
	/** Plain-word descriptions for the runtime values (the picker's description column). */
	runtimeApi: string;
	runtimeAgent: string;
	/** Plain-word descriptions for the context values. */
	contextEvidence: string;
	contextDigest: string;
	contextFork: string;
	/** The role gates' refusal notices: the command path now, not the config file. */
	scoutDisabled: string;
	reviewDisabled: string;
	/**
	 * The first-run welcome, shown once per machine (the marker lives in the global config file,
	 * outside the cascade). It names the state the plugin is ALREADY in — signals live, zero
	 * model spend — the one step that changes anything, and where the full setup help is. With
	 * a model configured it says that instead, so it never lies about the current state.
	 */
	welcomeFirstRun: (hasModel: boolean) => string;
}

export const ROLE_EN: RoleStrings = {
	cmdRole: "turn the scout or reviewer role on/off",
	roleList: (scout, reviewer) => `roles — scout: ${scout} · reviewer: ${reviewer}`,
	roleStateOn: "on",
	roleStateOff: "off",
	roleScoutDesc: "scout — finds an existing plugin for recurring friction (costs model money)",
	roleReviewerDesc: "reviewer — reviews the last delivery against the repo's conventions (reads source)",
	roleSet: (role, state) => `${role} role ${state}`,
	roleUnknown: (tokens, allowed) => `Unknown role setting: ${tokens}. Use: ${allowed}`,
	runtimeApi: "api — cheapest: one model call per appraisal, no tools",
	runtimeAgent: "agent — a child pi with tools; needed by /psych scout and /psych review",
	contextEvidence: "evidence — facts only; nothing raw leaves the machine",
	contextDigest: "digest — cleaned excerpts of the conversation (asks for confirmation)",
	contextFork: "fork — the whole session including tool outputs (widest consent)",
	scoutDisabled: "The scout role is off. Turn it on with: /psych role scout on",
	reviewDisabled: "The reviewer role is off. Turn it on with: /psych role reviewer on",
	welcomeFirstRun: (hasModel) =>
		hasModel
			? "pi-devs-psychologist is watching (zero-config defaults). /psych help explains every setting."
			: "pi-devs-psychologist: signals are live, zero model spend. To enable appraisals: /psych model <provider/id> — /psych help explains every setting.",
};

export const ROLE_CS: RoleStrings = {
	cmdRole: "zapnout nebo vypnout roli scout nebo reviewer",
	roleList: (scout, reviewer) => `role — scout: ${scout} · reviewer: ${reviewer}`,
	roleStateOn: "zapnuto",
	roleStateOff: "vypnuto",
	roleScoutDesc: "scout — najde existující plugin pro opakující se tření (stojí peníze za model)",
	roleReviewerDesc: "reviewer — posoudí poslední dodávku vůči konvencím repozitáře (čte zdroják)",
	roleSet: (role, state) => `role ${role} ${state}`,
	roleUnknown: (tokens, allowed) => `Neznámé nastavení role: ${tokens}. Použij: ${allowed}`,
	runtimeApi: "api — nejlevnější: jedno volání modelu na posouzení, bez nástrojů",
	runtimeAgent: "agent — podřízený pi s nástroji; potřebují ho /psych scout a /psych review",
	contextEvidence: "evidence — jen fakta; nic syrového neopouští stroj",
	contextDigest: "digest — očištěné výňatky z konverzace (žádá potvrzení)",
	contextFork: "fork — celá relace včetně výstupů nástrojů (nejširší souhlas)",
	scoutDisabled: "Role scout je vypnutá. Zapni ji: /psych role scout on",
	reviewDisabled: "Role reviewer je vypnutá. Zapni ji: /psych role reviewer on",
	welcomeFirstRun: (hasModel) =>
		hasModel
			? "pi-devs-psychologist sleduje (výchozí nastavení beze změn). /psych help vysvětlí každé nastavení."
			: "pi-devs-psychologist: signály běží, nula utracených tokenů. Posouzení zapneš přes /psych model <provider/id> — /psych help vysvětlí každé nastavení.",
};
