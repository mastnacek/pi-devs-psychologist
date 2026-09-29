/**
 * replay — read a PAST session file and reconstruct the exact observation window the LIVE observer
 * would have built from it.
 *
 * The observer is deliberately a fold over events (`slices/observer/index.ts`); its whole value
 * proposition is that a window always folds to the same signals. This file makes that literal: it
 * takes the parsed JSONL lines of a finished session and produces the same `Observation[]`, so an
 * appraisal the operator disagrees with can be re-run offline, for zero budget, over real sessions.
 *
 * It is PURE. No filesystem, no process, no clock — the caller reads the file and hands over the
 * lines. That is what lets the arithmetic be unit-tested against a hand-written fixture and what
 * keeps the "reads a session" boundary in one place (the command slice).
 *
 * It reuses the observer's own extractors (`shared/tool-args.ts`) rather than re-deriving them, so
 * the replay and the live path cannot drift about what a `command`, a `path` or a failure
 * `signature` is.
 *
 * DATA BOUNDARY: the reader never emits a message body as an observation. A prompt becomes a
 * `prompt` observation (its text, exactly as the live observer records it); everything else becomes
 * a count, a tool name, a path or a fixed-vocabulary signature. No assistant text, no thinking
 * block, no tool output is ever carried into an observation — the same rule the live window obeys.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Observation } from "./signals.js";
import { commandFromArgs, isProgrammerPrompt, pathFromArgs, signatureFromResult } from "./tool-args.js";

/** What a replayed session file yields, in the shapes the folds downstream consume. */
export interface ReplaySlice {
	/** The same `Observation[]` the live observer would have produced, in event order. */
	observations: Observation[];
	/**
	 * The session's entries in linear branch order — exactly what `foldHistory` consumes. The
	 * `session` header is excluded, because `getBranch()` (the live input) never contains it.
	 */
	entries: SessionEntry[];
	/** Data of every `custom` entry with `customType: "psych-appraisal"` (TUI-only). */
	appraisals: unknown[];
	/** Data of every `custom` entry with `customType: "psych-outcome"` (TUI-only). */
	outcomes: unknown[];
}

/** One in-flight tool call, captured from its assistant `toolCall` block. */
interface PendingCall {
	toolName: string;
	command?: string;
	path?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The text of a user message: a string, or the joined `text` blocks of a block array. */
function userText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is Record<string, unknown> => isRecord(part) && part.type === "text")
		.map((part) => (typeof part.text === "string" ? part.text : ""))
		.join("");
}

/** ISO entry timestamp as ms, or `undefined` when unparseable. */
export function entryTime(entry: unknown): number | undefined {
	if (!isRecord(entry)) return undefined;
	const raw = entry.timestamp;
	if (typeof raw !== "string") return undefined;
	const ms = Date.parse(raw);
	return Number.isNaN(ms) ? undefined : ms;
}

/** The ms timestamp of a message: the nested `message.timestamp`, else the entry's ISO timestamp. */
function messageTime(message: Record<string, unknown>, entry: Record<string, unknown>): number {
	if (typeof message.timestamp === "number") return message.timestamp;
	return entryTime(entry) ?? 0;
}

/** The toolCall blocks of an assistant message's content array. */
function toolCalls(content: unknown): Record<string, unknown>[] {
	if (!Array.isArray(content)) return [];
	return content.filter(
		(part): part is Record<string, unknown> =>
			isRecord(part) && (part.type === "toolCall" || part.type === "tool_call"),
	);
}

/**
 * Parse the parsed-or-raw lines of a session and fold them into observations plus the entries and
 * the TUI-only custom payloads the appraiser reads.
 *
 * Unknown or unparsable lines are skipped silently, exactly like `foldHistory` ignores unknown entry
 * types: forward compatibility is the engine's contract, and a session written by a newer build must
 * not make the replay crash.
 */
export function readReplay(lines: readonly string[]): ReplaySlice {
	const observations: Observation[] = [];
	const entries: SessionEntry[] = [];
	const appraisals: unknown[] = [];
	const outcomes: unknown[] = [];
	const pending = new Map<string, PendingCall>();

	for (const line of lines) {
		if (typeof line !== "string" || line.trim().length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(parsed)) continue;
		const type = parsed.type;

		if (type === "custom") {
			if (parsed.customType === "psych-appraisal") appraisals.push(parsed.data);
			else if (parsed.customType === "psych-outcome") outcomes.push(parsed.data);
			continue;
		}
		// The session header is metadata, not a branch entry: `getBranch()` never returns it.
		if (type === "session") continue;
		// `SessionEntry` is a strict discriminated union, but this reader validates a session file line
		// by line and must tolerate shapes a newer engine wrote. `foldHistory` reads only the fields it
		// knows and ignores unknown entry types.
		// SAFETY: the cast is sound because every consumer reads a known optional field, never the
		// discriminant's payloads, and a missing field reads as absent rather than throwing.
		const entry = parsed as unknown as SessionEntry;
		if (typeof type === "string") entries.push(entry);
		if (type !== "message") continue;

		const message = parsed.message;
		if (!isRecord(message)) continue;
		const role = message.role;

		if (role === "user") {
			// Reuses the live rule: an extension-injected message is the plugin talking to itself.
			if (!isProgrammerPrompt(message.source)) continue;
			observations.push({ kind: "prompt", at: messageTime(message, parsed), text: userText(message.content) });
			continue;
		}

		if (role === "assistant") {
			const calls = toolCalls(message.content);
			for (const call of calls) {
				const id = typeof call.id === "string" ? call.id : undefined;
				if (id === undefined) continue;
				const name = typeof call.name === "string" ? call.name : "";
				pending.set(id, {
					toolName: name,
					command: commandFromArgs(call.arguments),
					path: pathFromArgs(name, call.arguments),
				});
			}
			// A `turn` observation at every assistant message that is NOT a toolResult. The live
			// observer emits one at `turn_end`; a session file has no such entry, so this is the
			// documented approximation: an assistant message carrying a toolCall is MID-turn (the
			// agent is still working), one carrying only text/thinking ENDS a turn. It reproduces the
			// live window's turn COUNT and their relative position, which is all the signal fold reads.
			if (calls.length === 0) observations.push({ kind: "turn", at: messageTime(message, parsed) });
			continue;
		}

		if (role === "toolResult") {
			// A result with no matching start (or a start with no result) yields NO tool observation:
			// the live observer records the tool at its END, so without an end there is nothing.
			const id = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
			const start = id === undefined ? undefined : pending.get(id);
			if (id !== undefined) pending.delete(id);
			const toolName = typeof message.toolName === "string" ? message.toolName : (start?.toolName ?? "");
			const ok = message.isError !== true;
			const signature = signatureFromResult(ok === false, message);
			observations.push({
				kind: "tool",
				at: messageTime(message, parsed),
				toolName,
				command: start?.command,
				path: start?.path,
				ok,
				...(signature === undefined ? {} : { errorSignature: signature }),
			});
		}
	}

	return { observations, entries, appraisals, outcomes };
}
