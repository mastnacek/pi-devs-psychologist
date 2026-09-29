/**
 * i18n-history — the vocabulary for the opt-in cross-session record (`/psych history`, T10).
 *
 * Split out of the main table by concept and to keep each file under the line budget. The words
 * here are deliberately plain and factual: the record is a fact table, so its copy never reads a
 * mood and never frames a number about the operator (PRD §5).
 */

export interface HistoryStrings {
	/** The report heading. */
	historyTitle: string;
	/** The `/psych history` picker description. */
	cmdHistory: string;
	/**
	 * The picker row for the feature's own state. NOT the master switch's strings: the plugin can be
	 * on while this record is off, and reusing "Psychologist off" made one row contradict the `on ✓`
	 * row directly above it. The reference makes the same distinction (references/command-completions.md:
	 * the parent row is annotated `· ○ VYPNUTO`, which says the SETTING is off, not the tool).
	 */
	historyRecordOn: string;
	historyRecordOff: string;
	/** One line when the feature is off: nothing written, nothing read, how to turn it on. */
	historyOff: string;
	/** `sessions recorded: N`. */
	historySessions: (n: number) => string;
	/** `date range: <from> .. <to>` (ISO dates). */
	historyRange: (from: string, to: string) => string;
	/** The date-range line when the record is empty. */
	historyRangeEmpty: string;
	/** The four-way verdict columns. */
	historyColumns: { kind: string; improved: string; unchanged: string; worse: string; unresolved: string };
	/** Shown when no delivery verdict was kept. */
	historyNoVerdicts: string;
	/** The notice when every line on disk was dropped (old, or unreadable). */
	historyAllDropped: (n: number) => string;
	/** Names the file and states that deleting it erases the record. */
	historyRecordPath: (path: string) => string;
}

export const HISTORY_EN: HistoryStrings = {
	historyTitle: "LONGITUDINAL HISTORY (opt-in)",
	cmdHistory: "show the opt-in cross-session delivery record",
	historyRecordOn: "cross-session record on",
	historyRecordOff: "cross-session record off (nothing kept)",
	historyOff:
		"The cross-session record is off. Nothing is written and nothing was read. Turn it on by setting history.enabled to true in your pi-devs-psychologist config.",
	historySessions: (n) => `sessions recorded: ${n}`,
	historyRange: (from, to) => `date range: ${from} .. ${to}`,
	historyRangeEmpty: "date range: —",
	historyColumns: { kind: "kind", improved: "improved", unchanged: "unchanged", worse: "worse", unresolved: "unresolved" },
	historyNoVerdicts: "no verdicts were kept: nothing to show",
	historyAllDropped: (n) => `every recorded line was dropped (${n}); nothing to show`,
	historyRecordPath: (path) => `record: ${path} — delete this file to erase the record.`,
};

export const HISTORY_CS: HistoryStrings = {
	historyTitle: "DLOUHODOBÁ HISTORIE (opt-in)",
	cmdHistory: "zobrazit opt-in záznam předání mezi relacemi",
	historyRecordOn: "záznam mezi relacemi zapnutý",
	historyRecordOff: "záznam mezi relacemi vypnutý (nic se neuchovává)",
	historyOff:
		"Záznam mezi relacemi je vypnutý. Nic se nezapisuje a nic se nečetlo. Zapneš ho nastavením history.enabled na true v konfiguraci pi-devs-psychologist.",
	historySessions: (n) => `zaznamenaných relací: ${n}`,
	historyRange: (from, to) => `rozsah: ${from} .. ${to}`,
	historyRangeEmpty: "rozsah: —",
	historyColumns: { kind: "druh", improved: "zlepšeno", unchanged: "beze změny", worse: "horší", unresolved: "nevyřešeno" },
	historyNoVerdicts: "nebyla uchována žádná hodnocení: není co zobrazit",
	historyAllDropped: (n) => `všechny řádky záznamu byly zahozeny (${n}); není co zobrazit`,
	historyRecordPath: (path) => `záznam: ${path} — smazáním souboru záznam zrušíš.`,
};
