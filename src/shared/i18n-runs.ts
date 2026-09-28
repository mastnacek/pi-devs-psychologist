/**
 * i18n-runs — the string table for the async run and its accounting (T26, T27).
 *
 * Split out of `i18n.ts` by concept (and to keep each file under the line budget): this is the
 * vocabulary of "a run is happening", "here is what it did" and "/psych stop", while `i18n.ts`
 * holds the appraisal card, the report shell and the command surface.
 *
 * Kept flat and complete per locale, exactly like the parent table: a missing key must not fall
 * back to English at runtime.
 */

export interface RunStrings {
	/** The chip while the API runtime is running: `psych: researching 42s` (T26). */
	chipResearching: (elapsed: string) => string;
	/** The chip while the agent runtime is running: `psych: researching 42s · 7 tools` (T26). */
	chipResearchingTools: (elapsed: string, tools: string) => string;
	/** The card header when the run took long enough that its window has moved on (T26). */
	cardStaleTurns: (turns: number) => string;
	/** `/psych stop` (T26). */
	cmdStop: string;
	stopRequested: string;
	stopNothing: string;
	/** The failure reason recorded when the operator stops a run. */
	stopReason: string;
	/** `/psych now` when the session agent cost cap is reached (T27). */
	reportCostCap: string;
	/** The `/psych` "Last run" block and its session line (T27). */
	reportLastRun: string;
	runLabels: {
		runtime: string;
		model: string;
		context: string;
		duration: string;
		tools: string;
		tokens: string;
		cost: string;
		outcome: string;
	};
	runSession: (runs: number, cost: string, cap: string) => string;
	runTokens: (input: string, output: string) => string;
	runUnlimited: string;
	runCostCapReached: string;
}

export const RUN_EN: RunStrings = {
	chipResearching: (elapsed) => `psych: researching ${elapsed}`,
	chipResearchingTools: (elapsed, tools) => `psych: researching ${elapsed} · ${tools} tools`,
	cardStaleTurns: (turns) => `based on the session ${turns} turns ago`,
	cmdStop: "kill the running appraisal",
	stopRequested: "Stopping the running appraisal.",
	stopNothing: "Nothing is running.",
	stopReason: "stopped by the operator",
	reportCostCap:
		"The session agent cost cap is reached. Raise agent.maxCostUsdPerSession or start a new session.",
	reportLastRun: "Last run",
	runLabels: {
		runtime: "runtime  ",
		model: "model    ",
		context: "context  ",
		duration: "duration ",
		tools: "tools    ",
		tokens: "tokens   ",
		cost: "cost     ",
		outcome: "outcome  ",
	},
	runSession: (runs, cost, cap) => `runs this session: ${runs} · agent cost ${cost} / ${cap}`,
	runTokens: (input, output) => `${input} in / ${output} out`,
	runUnlimited: "unlimited",
	runCostCapReached: "agent session cost cap reached",
};

export const RUN_CS: RunStrings = {
	chipResearching: (elapsed) => `psych: zkoumám ${elapsed}`,
	chipResearchingTools: (elapsed, tools) => `psych: zkoumám ${elapsed} · ${tools} nástrojů`,
	cardStaleTurns: (turns) => `podle relace před ${turns} tahy`,
	cmdStop: "ukončit běžící posouzení",
	stopRequested: "Ukončuji běžící posouzení.",
	stopNothing: "Nic neběží.",
	stopReason: "ukončeno operátorem",
	reportCostCap:
		"Strop nákladů agenta pro relaci je dosažen. Zvyš agent.maxCostUsdPerSession nebo začni novou relaci.",
	reportLastRun: "Poslední běh",
	runLabels: {
		runtime: "runtime  ",
		model: "model    ",
		context: "kontext  ",
		duration: "trvání   ",
		tools: "nástroje ",
		tokens: "tokeny   ",
		cost: "cena     ",
		outcome: "výsledek ",
	},
	runSession: (runs, cost, cap) => `běhy v této relaci: ${runs} · cena agenta ${cost} / ${cap}`,
	runTokens: (input, output) => `${input} dovnitř / ${output} ven`,
	runUnlimited: "neomezeno",
	runCostCapReached: "strop nákladů agenta dosažen",
};