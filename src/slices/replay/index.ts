/**
 * replay — `/psych replay <session-file>` and `/psych replay --eval <before> <after>` (idea 1).
 *
 * The observer's window is a pure fold over events, so a *past* session can be folded again offline:
 * this slice reads the session file, reconstructs the observation window (`shared/replay.ts`), cuts
 * it into the appraisal windows the live appraiser would have produced (`shared/replay-windows.ts`),
 * and — only with `--run` — sends each window through the SAME model call the appraiser uses.
 *
 * Four rules make it safe to point at real sessions:
 * - **Offline measurement, not an observation of the operator.** It consumes no budget and is never
 *   recorded in the outcome ledger. Nothing is written into the session being replayed.
 * - **The same data boundary as live evidence.** The model sees the evidence LINES (counts and names),
 *   never the transcript; the report prints counts and verdicts, never prompt text.
 * - **Dry by default.** `--dry` folds windows with no model call. A call happens only with `--run`.
 * - **The API runtime only.** It uses the shared `callModel` seam directly and never spawns a child
 *   pi, so a replay cannot start a second agent.
 *
 * The eval (`shared/replay-eval.ts`) is pure arithmetic over two result files: no model, no session
 * file, no judgement.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { neutralAppraisal } from "../../shared/appraisal.js";
import { enforceEvidence, parseAppraisal } from "../../shared/appraisal-enforce.js";
import { stringsFor } from "../../shared/i18n.js";
import type { ModelCallRequest, ModelRegistry, ModelCallResult } from "../../shared/model-call.js";
import { SYSTEM_PROMPT } from "../../shared/prompt.js";
import { readReplay } from "../../shared/replay.js";
import { evaluateRuns, type ReplayRunResult } from "../../shared/replay-eval.js";
import { sliceWindows, type ReplayWindow } from "../../shared/replay-windows.js";
import { signalOptions, type DevsPsychologistState } from "../../shared/state.js";
import { renderEval, renderReplay } from "./render.js";

export { renderEval, renderReplay } from "./render.js";

/** An appraisal response is a small JSON object; the cap is a spend guard, not a need. */
const REPLAY_MAX_TOKENS = 1200;

/**
 * What the slice needs from the composition root. `readFile` / `writeFile` keep the filesystem out
 * of the pure reader; `callModel` is the SAME seam the appraiser uses, so a replay is byte-identical
 * to a live appraisal.
 */
export interface ReplayDeps {
	/** Read a session or result file. Throws on failure; the handler reports the path and reason. */
	readFile(path: string): string;
	/** Write the `--json` result file. Throws on failure. */
	writeFile(path: string, text: string): void;
	callModel(registry: ModelRegistry, req: ModelCallRequest): Promise<ModelCallResult>;
}

interface ReplayOptions {
	sessionFile?: string;
	run: boolean;
	modelRef?: string;
	cadence?: number;
	jsonPath?: string;
	eval?: [string, string];
}

/**
 * Parse `/psych replay`'s arguments.
 *
 * Tokens are split on whitespace, so a path containing a space is not supported — the same
 * limitation every `/psych` subcommand has, and documented rather than half-handled.
 */
export function parseReplayArgs(raw: string): ReplayOptions {
	const tokens = (raw ?? "").trim().split(/\s+/).filter((token) => token.length > 0);
	const options: ReplayOptions = { run: false };
	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		if (token === "--dry") options.run = false;
		else if (token === "--run") options.run = true;
		else if (token === "--model") options.modelRef = tokens[++i];
		else if (token === "--cadence") options.cadence = Number(tokens[++i]);
		else if (token === "--json") options.jsonPath = tokens[++i];
		else if (token === "--eval") options.eval = [tokens[++i], tokens[++i]];
		else if (!token.startsWith("-") && options.sessionFile === undefined) options.sessionFile = token;
	}
	return options;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** A window with no model output: the neutral enforcement of an empty answer. */
function neutralResult(window: ReplayWindow, responseText = ""): ReplayRunResult {
	return {
		windowIndex: window.index,
		reasons: window.triggerReasons,
		liveLines: window.liveLines,
		sessionLines: window.sessionLines,
		responseText,
		enforcement: enforceEvidence(neutralAppraisal(), window.evidenceLines),
	};
}

/** The parsed payload of a `--json` result file, or an error string. */
function readResults(
	deps: ReplayDeps,
	path: string,
): { runs: ReplayRunResult[] } | { error: string } {
	let text: string;
	try {
		text = deps.readFile(path);
	} catch (error) {
		return { error: describe(error) };
	}
	try {
		const parsed = JSON.parse(text) as { windows?: unknown };
		const windows = Array.isArray(parsed?.windows) ? (parsed.windows as ReplayRunResult[]) : [];
		return { runs: windows };
	} catch (error) {
		return { error: describe(error) };
	}
}

/**
 * The `/psych replay` handler. Returns a status line for the simple skip/error cases; renders the
 * long report (or eval table) itself and returns `""` when it did.
 */
export function replayCommandHandler(
	state: DevsPsychologistState,
	deps: ReplayDeps,
): (ctx: ExtensionCommandContext, args: string) => Promise<string> {
	return async (ctx, args) => {
		const s = stringsFor(state.config.lang);
		if (!state.config.enabled) return s.reportDisabled;
		if (!ctx.hasUI) return s.notTui;
		const options = parseReplayArgs(args);
		const width = (process.stdout?.columns ?? 0) > 0 ? (process.stdout.columns as number) : 100;

		// `--eval` needs no session file and no model: it is pure arithmetic over two result files.
		if (options.eval) {
			const [beforeFile, afterFile] = options.eval;
			if (!beforeFile || !afterFile) return s.replayEvalNeedsFiles;
			const before = readResults(deps, beforeFile);
			if ("error" in before) return s.replayReadError(beforeFile, before.error);
			const after = readResults(deps, afterFile);
			if ("error" in after) return s.replayReadError(afterFile, after.error);
			const result = evaluateRuns(before.runs, after.runs);
			ctx.ui.notify(renderEval({ eval: result, beforeFile, afterFile, lang: state.config.lang, width }), "info");
			return "";
		}

		if (!options.sessionFile) return s.replayNeedsFile;
		const modelRef = options.modelRef ?? state.config.model;
		if (options.run && modelRef.trim().length === 0) return s.reportNoModel;

		let text: string;
		try {
			text = deps.readFile(options.sessionFile);
		} catch (error) {
			return s.replayReadError(options.sessionFile, describe(error));
		}
		const slice = readReplay(text.split(/\r?\n/));
		const cadence =
			typeof options.cadence === "number" && Number.isFinite(options.cadence) && options.cadence > 0
				? Math.floor(options.cadence)
				: state.config.cadenceTurns;
		const windows = sliceWindows(slice.observations, slice.entries, {
			cadenceTurns: cadence,
			signal: signalOptions(state),
			idleGapMs: state.config.idleGapMs,
			thresholds: state.config.triggerThresholds,
		});

		const results: ReplayRunResult[] = [];
		let failures = 0;
		for (const window of windows) {
			if (!options.run) {
				results.push(neutralResult(window));
				continue;
			}
			const call = await deps.callModel(ctx.modelRegistry, {
				modelRef,
				systemPrompt: SYSTEM_PROMPT,
				userText: window.userText,
				maxTokens: REPLAY_MAX_TOKENS,
			});
			if (call.ok === false) {
				failures += 1;
				results.push(neutralResult(window));
				continue;
			}
			const parsed = parseAppraisal(call.text, window.evidenceLines);
			if (parsed.ok === false) {
				failures += 1;
				results.push(neutralResult(window, call.text));
				continue;
			}
			results.push({
				windowIndex: window.index,
				reasons: window.triggerReasons,
				liveLines: window.liveLines,
				sessionLines: window.sessionLines,
				responseText: call.text,
				enforcement: { appraisal: parsed.appraisal, unmatched: parsed.unmatched, downgraded: parsed.downgraded },
			});
		}

		if (options.jsonPath) {
			const payload = {
				version: 1,
				sessionFile: options.sessionFile,
				mode: options.run ? "run" : "dry",
				model: options.run ? modelRef : "",
				windows: results,
			};
			try {
				deps.writeFile(options.jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
			} catch (error) {
				return s.replayWriteError(options.jsonPath, describe(error));
			}
		}

		ctx.ui.notify(
			renderReplay({
				sessionFile: options.sessionFile,
				mode: options.run ? "run" : "dry",
				modelRef,
				windows,
				results,
				failures,
				lang: state.config.lang,
				width,
			}),
			"info",
		);
		if (options.jsonPath) ctx.ui.notify(s.replaySaved(options.jsonPath), "info");
		return "";
	};
}
