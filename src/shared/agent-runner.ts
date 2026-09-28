/**
 * agent-runner — the process wrapper: spawn the child pi, read its JSON stream, enforce time and
 * cost, and turn the run into the SAME `ModelCallResult` the API runtime returns (T24).
 *
 * Everything that can be pure is elsewhere and tested without a process: `agent-argv.ts` builds the
 * launch, `agent-stream.ts` reduces the stream, `agent-runner-io.ts` is the injectable process
 * surface. What is left here is the run itself.
 *
 * The three limits are the whole reason the child is a subprocess rather than a call: it can hang,
 * and it can spend. So the run ends at the FIRST of: a clean exit, the wall-clock cap (`timeout`),
 * the per-run cost cap (`budget`), or the operator's abort signal (`aborted`). Kill is idempotent
 * because idle, abort and shutdown can all converge on it, and cleanup runs on every path so the
 * temp dir is gone unless the operator asked to keep the transcript.
 *
 * A failure never carries the whole stderr stream — the last 8 KB is the ceiling — and never
 * anything a provider would not put in an error string. The point of a stage and a tail is that an
 * operator can diagnose the run without a debugger and without leaking a credential into a report.
 */

import { buildAgentBrief } from "./agent-brief.js";
import { buildChildLaunch } from "./agent-argv.js";
import { join } from "node:path";
import { agentRunTmpDir, STDERR_TAIL_BYTES, type AgentRunIo, type ChildProcessHandle } from "./agent-runner-io.js";
import { createStreamState, reduceLine, splitLines, totalCostUsd, type AgentStreamState } from "./agent-stream.js";
import type { AgentContextLevel } from "./agent-config.js";
import type { ChildLimits, ChildRole } from "./child-limits.js";
import type { AgentRunMeta, AgentCallStage, ModelCallResult } from "./model-call.js";
import type { Usage } from "@earendil-works/pi-ai";

/** What the child is asked to answer, built from the appraiser's request (seam: `evidence`). */
export interface AgentRunRequest {
	/** `provider/modelId[:thinking]` for `--model`. */
	modelRef: string;
	/** The evidence lines behind the API runtime's user text, rebuilt into the child's message. */
	evidence: { liveLines: readonly string[]; sessionLines: readonly string[] };
	/** A bounded, scrubbed transcript excerpt (T28), prepended when present. */
	digest?: string;
	/** The parent session's abort signal; aborting it kills the child. */
	signal?: AbortSignal;
}

/** Everything the launch needs that is not in the request: the resolved parent-side facts. */
export interface AgentRunOptions {
	cliPath: string;
	execPath: string;
	role: ChildRole;
	context: AgentContextLevel;
	parentSessionFile?: string;
	piVersion: string;
	docsDir?: string;
	thinking: string;
	trusted: boolean;
	cwd: string;
	timeoutMs: number;
	maxCostUsd: number;
	maxToolCalls: number;
	allowWeb: boolean;
	allowMcp: boolean;
	allowNlm: boolean;
	nlmNotebooks: string[];
	extraArgs: string[];
	keepTranscript: boolean;
	baseEnv?: NodeJS.ProcessEnv;
	/**
	 * Called with a kill handle when the child is spawned, and `undefined` when the run ends. The
	 * composition root keeps the handle so `session_shutdown` can kill the child (T24); the kill is
	 * idempotent, so shutdown, timeout and abort can all call it safely.
	 */
	onChild?: (handle: ChildHandle | undefined) => void;
}

/** The handle a caller keeps to kill a running child. */
export interface ChildHandle {
	pid: number | undefined;
	kill(): void;
}

/** The stages a run can end in. `spawn` is handled before the promise resolves. */
type RunStage = AgentCallStage;

/** The runner's own outcome, before it is shaped into an engine-facing result. */
interface RunOutcome {
	state: AgentStreamState;
	stderrTail: string;
	fallback: boolean;
	durationMs: number;
	stage: RunStage;
	exitCode: number | null;
	transcriptPath: string | undefined;
}

function toChunkString(chunk: Buffer | string): string {
	return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
}

/** The last `limit` characters, so a long stream cannot grow the failure payload. */
function tail(text: string, limit: number): string {
	return text.length <= limit ? text : text.slice(text.length - limit);
}

/** The engine-facing usage object, built from the stream's totals so `summarizeUsage` reads it. */
function usageFrom(state: AgentStreamState): Usage {
	return {
		input: state.usage.input,
		output: state.usage.output,
		cacheRead: state.usage.cacheRead,
		cacheWrite: state.usage.cacheWrite,
		totalTokens: state.usage.input + state.usage.output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: state.usage.cost },
	};
}

function metaFrom(outcome: RunOutcome): AgentRunMeta {
	return {
		durationMs: outcome.durationMs,
		toolCounts: outcome.state.toolCounts,
		costUsd: outcome.state.usage.cost,
		fallback: outcome.fallback,
		...(outcome.transcriptPath ? { transcriptPath: outcome.transcriptPath } : {}),
	};
}

/** A short, safe explanation for a run that did not submit: last assistant text, then stderr tail. */
function failureDetail(outcome: RunOutcome, label: string): string {
	const said = outcome.state.lastAssistantText.trim();
	if (said.length > 0) return `${label}: ${tail(said, 300)}`;
	const tailText = outcome.stderrTail.trim();
	if (tailText.length > 0) return `${label}: ${tail(tailText, 300)}`;
	return `${label}: no psych_submit call and no assistant text`;
}

/** Map a finished run onto the engine-facing result (D1). */
function outcomeToResult(outcome: RunOutcome): ModelCallResult {
	if (outcome.state.submitted) {
		return {
			ok: true,
			// The args are the answer; `parseAppraisal` reads them exactly as it reads API text (D1).
			text: JSON.stringify(outcome.state.submittedArgs),
			provider: "",
			modelId: "",
			label: "",
			usage: usageFrom(outcome.state),
			run: metaFrom(outcome),
		};
	}
	// A settled run that never submitted is `no_submission`; a run that died before settling is `exit`.
	const stage: RunStage =
		outcome.stage === "exit" && outcome.state.settled ? "no_submission" : outcome.stage;
	const error =
		stage === "timeout"
			? `the child pi exceeded its time limit (${outcome.durationMs} ms)`
			: stage === "budget"
				? `the child pi exceeded its per-run cost cap ($${outcome.state.usage.cost.toFixed(4)})`
				: stage === "aborted"
					? "the appraisal was aborted"
					: stage === "spawn"
						? failureDetail(outcome, "the child pi could not be started")
						: stage === "no_submission"
							? failureDetail(outcome, "the child pi finished without submitting")
							: failureDetail(outcome, `the child pi exited (code ${outcome.exitCode})`);
	return { ok: false, stage, error, run: metaFrom(outcome) };
}

/**
 * Run one child pi and reduce it to a `ModelCallResult`.
 *
 * The function never rejects: a spawn failure, a kill and a clean finish are all results. The run
 * directory is removed on every path unless the transcript was explicitly kept.
 */
export async function runAgent(
	request: AgentRunRequest,
	options: AgentRunOptions,
	io: AgentRunIo,
): Promise<ModelCallResult> {
	const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const runTmp = agentRunTmpDir(runId);
	const started = io.now();

	const limits: ChildLimits = {
		maxToolCalls: options.maxToolCalls,
		allowWeb: options.allowWeb,
		allowMcp: options.allowMcp,
		allowNlm: options.allowNlm,
	};
	const brief = buildAgentBrief({
		role: options.role,
		piVersion: options.piVersion,
		docsDir: options.docsDir,
		liveLines: request.evidence.liveLines,
		sessionLines: request.evidence.sessionLines,
		limits,
		nlmNotebooks: options.nlmNotebooks,
		...(request.digest ? { digest: request.digest } : {}),
	});
	const launch = buildChildLaunch({
		cliPath: options.cliPath,
		execPath: options.execPath,
		context: options.context,
		parentSessionFile: options.parentSessionFile,
		runTmp,
		modelRef: request.modelRef,
		thinking: options.thinking,
		trusted: options.trusted,
		extraArgs: options.extraArgs,
		role: options.role,
		runId,
		limits,
		baseEnv: options.baseEnv ?? process.env,
	});

	const state = createStreamState();
	let carry = "";
	let stdoutRaw = "";
	let stderrRaw = "";
	let killed = false;
	let timedOut = false;
	let overBudget = false;
	let aborted = false;
	let fired = false;
	let timeoutHandle: ReturnType<AgentRunIo["setTimeout"]> | undefined;
	let child: ChildProcessHandle | undefined;

	const kill = (): void => {
		if (killed) return;
		killed = true;
		io.killTree(child?.pid);
	};

	await io.mkdir(runTmp);
	await io.writeFile(join(runTmp, "brief.md"), brief.systemAppend);
	await io.writeFile(join(runTmp, "message.md"), brief.userMessage);

	return await new Promise<ModelCallResult>((resolve) => {
		const finish = (stage: RunStage, exitCode: number | null): void => {
			if (fired) return;
			fired = true;
			if (timeoutHandle !== undefined) io.clearTimeout(timeoutHandle);
			killed = true;
			options.onChild?.(undefined);
			const outcome: RunOutcome = {
				state,
				stderrTail: tail(stderrRaw, STDERR_TAIL_BYTES),
				fallback: launch.fallback,
				durationMs: Math.max(0, io.now() - started),
				stage,
				exitCode,
				transcriptPath: options.keepTranscript ? join(runTmp, "events.jsonl") : undefined,
			};
			const cleanup = options.keepTranscript
				? io.writeFile(join(runTmp, "events.jsonl"), stdoutRaw)
				: io.rm(runTmp);
			Promise.resolve(cleanup).then(
				() => resolve(outcomeToResult(outcome)),
				() => resolve(outcomeToResult(outcome)),
			);
		};

		try {
			child = io.spawn(launch.command, launch.args, {
				cwd: options.cwd,
				env: launch.env,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				// POSIX needs a process group so `process.kill(-pid)` reaches the whole tree (Q10).
				detached: process.platform !== "win32",
				windowsHide: true,
			});
		} catch (error) {
			// The spawn error is the only explanation there is; keep it as the tail so it is reported.
			// `finish` runs the same cleanup as every other path, so the temp dir is still removed.
			stderrRaw = error instanceof Error ? error.message : String(error);
			finish("spawn", null);
			return;
		}

		options.onChild?.({ pid: child.pid, kill });

		child.stdout?.on("data", (chunk) => {
			const text = toChunkString(chunk);
			stdoutRaw += text;
			const split = splitLines(carry, text);
			carry = split.carry;
			for (const line of split.lines) {
				reduceLine(state, line);
				if (options.maxCostUsd > 0 && totalCostUsd(state) > options.maxCostUsd) overBudget = true;
			}
			if (overBudget) {
				kill();
				finish("budget", null);
			}
		});
		child.stderr?.on("data", (chunk) => {
			stderrRaw = tail(stderrRaw + toChunkString(chunk), STDERR_TAIL_BYTES);
		});
		child.on("error", (error) => {
			stderrRaw = tail(stderrRaw + error.message, STDERR_TAIL_BYTES);
			finish("spawn", null);
		});
		child.on("close", (code) => {
			if (carry.trim().length > 0) reduceLine(state, carry);
			finish(timedOut ? "timeout" : aborted ? "aborted" : "exit", code);
		});

		if (options.timeoutMs > 0) {
			timeoutHandle = io.setTimeout(() => {
				timedOut = true;
				kill();
				finish("timeout", null);
			}, options.timeoutMs);
		}
		if (request.signal) {
			const onAbort = (): void => {
				aborted = true;
				kill();
				finish("aborted", null);
			};
			if (request.signal.aborted) onAbort();
			else request.signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}

export { agentRunTmpDir, defaultAgentRunIo } from "./agent-runner-io.js";
export type { AgentRunIo } from "./agent-runner-io.js";
