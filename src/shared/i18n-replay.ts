/**
 * i18n-replay — the vocabulary for the offline replay harness and the two-run eval.
 *
 * Split out of the main table by concept (and to keep every file under the line budget): these are
 * the only strings `/psych replay` and `/psych replay --eval` render, and every one of them is a
 * count, a label or an outcome word — never a session's text.
 *
 * The evidence lines and the model's answer are model-facing / verbatim and stay outside this table,
 * exactly as the rest of the plugin keeps its prompt text out of UI copy.
 */

export interface ReplayStrings {
	/** The command's description in the picker. */
	cmdReplay: string;
	replayTitle: string;
	/** `windows 4 · dry (no model call)` — the window count and which mode ran. */
	replayHeader: (windows: number, mode: string) => string;
	/** The default mode: fold windows only, no model call, zero spend. */
	replayModeDry: string;
	/** `--run`: one model call per window. */
	replayModeRun: string;
	/** `model    provider/id` — the reference the run used. */
	replayModel: (ref: string) => string;
	/** `window 3` — the per-window heading. */
	replayWindow: (n: number) => string;
	/** `triggered by: failure_streak, restatement`. */
	replayTrigger: (reasons: string) => string;
	/** `triggered by: none`. */
	replayNoTrigger: string;
	/** `evidence: 12 live · 8 session line(s)`. */
	replayEvidence: (live: number, session: number) => string;
	/** `enforcement: verdicts kept 3 · claims dropped 0 · intervention name_next_win`. */
	replayEnforcement: (kept: number, dropped: number, kind: string) => string;
	/** Shown in place of an intervention kind when the window named none. */
	replayInterventionNone: string;
	/** The label before the model's own response text. */
	replayResponse: string;
	/** `⚠ 2 window(s) failed to call the model`. */
	replayFailures: (n: number) => string;
	/** Shown when the session has no turn to cut a window at. */
	replayNoWindows: string;
	/** `replay results written to <path>`. */
	replaySaved: (path: string) => string;
	/** `Cannot read <path>: <reason>` — the path and the reason, never swallowed. */
	replayReadError: (path: string, reason: string) => string;
	/** `Cannot write <path>: <reason>`. */
	replayWriteError: (path: string, reason: string) => string;
	/** The usage line when no session file was given. */
	replayNeedsFile: string;
	/** The usage line when `--eval` was given without two result files. */
	replayEvalNeedsFiles: string;
	replayEvalTitle: string;
	/** `windows compared: 4`. */
	replayEvalHeader: (windows: number) => string;
	replayEvalColumns: { metric: string; before: string; after: string };
	replayMetrics: {
		verdictsKept: string;
		claimsDropped: string;
		citationRate: string;
		precision: string;
		abstentionRate: string;
		meanCitations: string;
	};
	/** `window 2: name_next_win → reduce_load (changed)`. */
	replayWindowChange: (n: number, before: string, after: string) => string;
	/** `window 2: name_next_win (unchanged)`. */
	replayWindowUnchanged: (n: number, kind: string) => string;
}

export const REPLAY_EN: ReplayStrings = {
	cmdReplay: "replay a past session offline, and eval two runs against each other",
	replayTitle: "SESSION REPLAY",
	replayHeader: (windows, mode) => `windows ${windows} · ${mode}`,
	replayModeDry: "dry (no model call)",
	replayModeRun: "run (one model call per window)",
	replayModel: (ref) => `model    ${ref}`,
	replayWindow: (n) => `window ${n}`,
	replayTrigger: (reasons) => `triggered by: ${reasons}`,
	replayNoTrigger: "triggered by: none",
	replayEvidence: (live, session) => `evidence: ${live} live · ${session} session line(s)`,
	replayEnforcement: (kept, dropped, kind) =>
		`enforcement: verdicts kept ${kept} · claims dropped ${dropped} · intervention ${kind}`,
	replayInterventionNone: "(none)",
	replayResponse: "model",
	replayFailures: (n) => `⚠ ${n} window(s) failed to call the model`,
	replayNoWindows: "no windows: the session has no turns to cut at",
	replaySaved: (path) => `replay results written to ${path}`,
	replayReadError: (path, reason) => `Cannot read ${path}: ${reason}`,
	replayWriteError: (path, reason) => `Cannot write ${path}: ${reason}`,
	replayNeedsFile:
		"Usage: /psych replay <session-file> [--run] [--model <provider/id>] [--cadence <n>] [--json <file>] | --eval <before.json> <after.json>",
	replayEvalNeedsFiles: "Usage: /psych replay --eval <before.json> <after.json>",
	replayEvalTitle: "REPLAY EVAL",
	replayEvalHeader: (windows) => `windows compared: ${windows}`,
	replayEvalColumns: { metric: "metric", before: "before", after: "after" },
	replayMetrics: {
		verdictsKept: "verdicts kept",
		claimsDropped: "claims dropped",
		citationRate: "citation rate",
		precision: "precision",
		abstentionRate: "abstention rate",
		meanCitations: "citations/finding",
	},
	replayWindowChange: (n, before, after) => `window ${n}: ${before} → ${after} (changed)`,
	replayWindowUnchanged: (n, kind) => `window ${n}: ${kind} (unchanged)`,
};

export const REPLAY_CS: ReplayStrings = {
	cmdReplay: "přehrát minulou relaci offline a porovnat dva běhy proti sobě",
	replayTitle: "PŘEHRÁNÍ RELACE",
	replayHeader: (windows, mode) => `oken ${windows} · ${mode}`,
	replayModeDry: "nasucho (bez volání modelu)",
	replayModeRun: "běh (jedno volání modelu na okno)",
	replayModel: (ref) => `model    ${ref}`,
	replayWindow: (n) => `okno ${n}`,
	replayTrigger: (reasons) => `spuštěno: ${reasons}`,
	replayNoTrigger: "spuštěno: nic",
	replayEvidence: (live, session) => `důkazy: ${live} živých · ${session} řádků relace`,
	replayEnforcement: (kept, dropped, kind) =>
		`vynucení: ponechaná hodnocení ${kept} · zahozené nároky ${dropped} · zásah ${kind}`,
	replayInterventionNone: "(žádný)",
	replayResponse: "model",
	replayFailures: (n) => `⚠ ${n} oken nezvládlo zavolat model`,
	replayNoWindows: "žádná okna: relace nemá žádné tahy, kde řezat",
	replaySaved: (path) => `výsledky přehrání zapsány do ${path}`,
	replayReadError: (path, reason) => `Nelze přečíst ${path}: ${reason}`,
	replayWriteError: (path, reason) => `Nelze zapsat ${path}: ${reason}`,
	replayNeedsFile:
		"Použití: /psych replay <soubor-relace> [--run] [--model <provider/id>] [--cadence <n>] [--json <soubor>] | --eval <před.json> <po.json>",
	replayEvalNeedsFiles: "Použití: /psych replay --eval <před.json> <po.json>",
	replayEvalTitle: "VYHODNOCENÍ PŘEHRÁNÍ",
	replayEvalHeader: (windows) => `porovnaná okna: ${windows}`,
	replayEvalColumns: { metric: "metrika", before: "před", after: "po" },
	replayMetrics: {
		verdictsKept: "ponechaná hodnocení",
		claimsDropped: "zahozené nároky",
		citationRate: "míra citací",
		precision: "přesnost",
		abstentionRate: "míra zdrženlivosti",
		meanCitations: "citace/nález",
	},
	replayWindowChange: (n, before, after) => `okno ${n}: ${before} → ${after} (změněno)`,
	replayWindowUnchanged: (n, kind) => `okno ${n}: ${kind} (beze změny)`,
};
