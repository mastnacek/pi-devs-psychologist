/**
 * run-account — the two records the async appraiser keeps (T26, T27).
 *
 * `shared/` rather than a slice because the state kernel owns them and the report reads them:
 * moving them here is what lets `state.ts` stay the kernel instead of importing a slice.
 *
 * - `PendingAppraisal` is a finished result held until the agent pauses.
 * - `LastRunAccount` is the accounting of the last run, for the report's "Last run" block.
 * - `TimerIo` is the injectable interval clock the researching chip runs on, so no test owns a
 *   real timer and `session_shutdown` can always stop it.
 */

import type { Appraisal } from "./appraisal.js";

/**
 * An enforced appraisal held until the agent pauses (T26).
 *
 * A slow run must never cut the working agent off mid-stream, so its result waits here and is
 * presented on the next `agent_end`. `startedTurn` is when the run began, which is what the
 * delivered card uses to say how stale it is.
 */
export interface PendingAppraisal {
	appraisal: Appraisal;
	/** Show it even when it carries no intervention (an operator-requested run). */
	evenIfSilent: boolean;
	startedTurn: number;
}

/**
 * Accounting for one appraiser run (T27). Runtime-agnostic: the API path fills tokens/cost from
 * usage and leaves `toolCounts` empty; the agent path fills tools and cost from the runner.
 */
export interface LastRunAccount {
	runtime: "api" | "agent";
	/** The model reference actually used, `provider/modelId[:thinking]`. */
	model: string;
	/** The consent level for the agent runtime, or `evidence` for the API call. */
	context: string;
	durationMs: number;
	/** Tool calls the child executed, by name. Empty for the API runtime. */
	toolCounts: Record<string, number>;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	/** `ok`, or the failure stage that ended the run. */
	stage: string;
}

/** The handle `TimerIo.setInterval` returns: opaque to every caller but its own `TimerIo`. */
export type TimerToken = ReturnType<typeof setInterval>;

/**
 * An injectable interval clock, so the researching chip's timer is testable and shuts down
 * deterministically (T26). The real implementation is the global `setInterval`/`clearInterval`.
 */
export interface TimerIo {
	setInterval(callback: () => void, ms: number): TimerToken;
	clearInterval(handle: TimerToken): void;
	now(): number;
}

/** The real clock. Every other field keeps its default; only the timer is swapped in tests. */
export function realTimerIo(): TimerIo {
	return {
		setInterval: (callback, ms) => setInterval(callback, ms),
		clearInterval: (handle) => clearInterval(handle),
		now: () => Date.now(),
	};
}

/** The inputs a finished run contributes to its accounting record. */
export interface RunAccountInput {
	runtime: "api" | "agent";
	model: string;
	context: string;
	durationMs: number;
	toolCounts?: Record<string, number>;
	inputTokens?: number;
	outputTokens?: number;
	costUsd?: number;
	stage: string;
}

/** Build the record, defaulting every optional figure so the report never renders `undefined`. */
export function buildRunAccount(input: RunAccountInput): LastRunAccount {
	return {
		runtime: input.runtime,
		model: input.model,
		context: input.context,
		durationMs: Math.max(0, input.durationMs),
		toolCounts: input.toolCounts ?? {},
		inputTokens: input.inputTokens ?? 0,
		outputTokens: input.outputTokens ?? 0,
		costUsd: input.costUsd ?? 0,
		stage: input.stage,
	};
}