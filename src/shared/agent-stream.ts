/**
 * agent-stream — the pure JSONL reducer for a child pi's stdout (T24).
 *
 * The child writes one JSON object per line (docs/json.md). The parent only needs four facts out of
 * that stream, and this module is the whole of that reading: what `psych_submit` was called with
 * (D3 — structured output by tool, never prose), the running token/cost total, a tool-call census
 * for T27, and the last thing the assistant said (so a run that never submits can still explain
 * itself).
 *
 * It is PURE and total: a line is a string in, state is mutated. A malformed line, a torn chunk or
 * an event type this plugin does not know are all ignored, because a JSON stream from a live model
 * is allowed to contain anything, and a reader that throws on the first surprise is a reader that
 * loses the answer that was already in hand.
 *
 * `splitLines` is separate and equally pure: stdout arrives in chunks that split records mid-line,
 * so the carry between chunks is explicit state and is tested directly.
 */

import { CHILD_SUBMIT_TOOL } from "./lexicon.js";

/** Running token and cost totals, summed across every assistant message the child produced. */
export interface AgentStreamTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface AgentStreamState {
	/** The arguments of the `psych_submit` call, as seen at `tool_execution_start`. */
	submittedArgs: unknown;
	/** True once a `psych_submit` `tool_execution_end` arrived for that call without an error. */
	submitted: boolean;
	/** The `toolCallId` of the `psych_submit` call awaiting its end event. */
	submitCallId: string | undefined;
	/** Summed usage over every assistant `message_end`. */
	usage: AgentStreamTotals;
	/** `tool_execution_start` counts, by tool name. */
	toolCounts: Record<string, number>;
	/** The last assistant message's text, trimmed to `LAST_TEXT_LIMIT` characters. */
	lastAssistantText: string;
	/** True once `agent_settled` arrived: pi has no more automatic work. */
	settled: boolean;
}

/** A failure message is a diagnostic, not a transcript; 300 characters is plenty to name the cause. */
export const LAST_TEXT_LIMIT = 300;

export function createStreamState(): AgentStreamState {
	return {
		submittedArgs: undefined,
		submitted: false,
		submitCallId: undefined,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		toolCounts: {},
		lastAssistantText: "",
		settled: false,
	};
}

/** The running cost, the single figure the per-run budget is compared against. */
export function totalCostUsd(state: AgentStreamState): number {
	return state.usage.cost;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The plain text of a message's content blocks, joined. Never thinking, never tool calls. */
function messageText(message: unknown): string {
	if (!isRecord(message)) return "";
	const content = message.content;
	if (!Array.isArray(content)) {
		return typeof content === "string" ? content : "";
	}
	const parts: string[] = [];
	for (const part of content) {
		if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
			parts.push(part.text);
		}
	}
	return parts.join("");
}

/** Sum one assistant message's usage into the running total. */
function addUsage(state: AgentStreamState, message: unknown): void {
	if (!isRecord(message)) return;
	const usage = message.usage;
	if (!isRecord(usage)) return;
	state.usage.input += numberOrZero(usage.input);
	state.usage.output += numberOrZero(usage.output);
	state.usage.cacheRead += numberOrZero(usage.cacheRead);
	state.usage.cacheWrite += numberOrZero(usage.cacheWrite);
	const cost = usage.cost;
	if (isRecord(cost)) state.usage.cost += numberOrZero(cost.total);
}

/**
 * Feed one already-split line into the state.
 *
 * Unknown event types, blank lines and lines that do not parse are ignored on purpose. The
 * discriminated switch is the whole contract with the engine: five `type` values, and nothing else
 * is read.
 */
export function reduceLine(state: AgentStreamState, line: string): void {
	const trimmed = line.replace(/\r$/, "").trim();
	if (trimmed.length === 0) return;
	let event: unknown;
	try {
		event = JSON.parse(trimmed);
	} catch {
		return;
	}
	if (!isRecord(event)) return;

	switch (event.type) {
		case "tool_execution_start": {
			const toolName = event.toolName;
			if (typeof toolName !== "string") return;
			state.toolCounts[toolName] = (state.toolCounts[toolName] ?? 0) + 1;
			if (toolName === CHILD_SUBMIT_TOOL) {
				state.submitCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
				state.submittedArgs = event.args;
			}
			return;
		}
		case "tool_execution_end": {
			// Success requires the SAME call: an errored submit must not count as an answer, because
			// the child is told to retry and the parent must read the accepted one.
			if (
				event.toolName === CHILD_SUBMIT_TOOL &&
				typeof event.toolCallId === "string" &&
				event.toolCallId === state.submitCallId &&
				event.isError !== true
			) {
				state.submitted = true;
			}
			return;
		}
		case "message_end": {
			const message = event.message;
			if (!isRecord(message) || message.role !== "assistant") return;
			addUsage(state, message);
			const text = messageText(message).trim();
			if (text.length > 0) state.lastAssistantText = text.slice(0, LAST_TEXT_LIMIT);
			return;
		}
		case "agent_settled": {
			state.settled = true;
			return;
		}
		default:
			return;
	}
}

export interface SplitLines {
	/** Complete lines, ready to reduce. */
	lines: string[];
	/** The trailing partial line to keep until the next chunk. */
	carry: string;
}

/**
 * Split a stdout chunk on `\n`, keeping the trailing fragment as carry.
 *
 * `docs/json.md` is explicit that records are framed by LF only and that unicode line separators
 * inside a JSON string are not boundaries — which is exactly why `readline` is wrong here and a
 * plain `\n` split with an explicit carry is right.
 */
export function splitLines(carry: string, chunk: string): SplitLines {
	const combined = carry + chunk;
	const parts = combined.split("\n");
	const nextCarry = parts.pop() ?? "";
	return { lines: parts, carry: nextCarry };
}
