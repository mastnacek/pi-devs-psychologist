/**
 * digest — a bounded, scrubbed excerpt of the session's own transcript (T28).
 *
 * `agent.context: "digest"` is a consent level, not a quality knob: it widens the data boundary
 * from "counts and names" to "some of the operator's own words", and it does so under three
 * deliberate ceilings. The excerpt carries the operator's prompts and the assistant's *text*, a
 * one-line summary of what the tools did, and **never** a tool result and **never** a thinking
 * block. A secret that slipped into a prompt is redacted last, after the caps, so nothing the
 * scrubber cannot see can leave through a truncation.
 *
 * The module is PURE: entries in, string out. No filesystem, no clock, no model. `scrubSecrets`
 * is exported on its own so a test can pin each secret form without building a session.
 *
 * DATA BOUNDARY: this is the widest thing the plugin reads from the session, and it still reads
 * only message *content* the operator already sees — not system prompts, not tool declarations,
 * not tool outputs. See ADR 0002 §2.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** The token every secret form is replaced with. */
export const REDACTED = "[redacted]";

/** The shapes a tool call can name its target with, in the order they are preferred. */
const TOOL_PATH_KEYS = ["path", "file_path", "filePath"] as const;

export interface DigestOptions {
	/** Total character ceiling; the oldest lines are dropped first. Default 6000. */
	maxChars?: number;
	/** How many of the most recent operator prompts to keep. Default 12. */
	maxPrompts?: number;
	/** Per-prompt character ceiling. Default 500. */
	promptChars?: number;
	/** Per-assistant-text character ceiling. Default 300. */
	assistantChars?: number;
	/** Command character ceiling on a tool line. Default 60. */
	commandChars?: number;
}

const DEFAULTS = {
	maxChars: 6000,
	maxPrompts: 12,
	promptChars: 500,
	assistantChars: 300,
	commandChars: 60,
} as const;

/** A finite integer at or above one, or the fallback. */
function positive(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** Flatten a block to one line and clamp it, so a prompt can never break the line format. */
function oneLine(text: string, limit: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > limit ? flat.slice(0, limit) : flat;
}

/** The text blocks of a user message, whether its content is a bare string or a block array. */
function textBlocks(content: unknown): string[] {
	if (typeof content === "string") return content.length > 0 ? [content] : [];
	if (!Array.isArray(content)) return [];
	const out: string[] = [];
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;
		const typed = block as { type?: unknown; text?: unknown };
		if (typed.type === "text" && typeof typed.text === "string" && typed.text.length > 0) {
			out.push(typed.text);
		}
	}
	return out;
}

/** The human-readable target of a tool call: a command (clamped) or a path, never the result. */
function toolTarget(args: unknown, commandChars: number): string {
	if (args === null || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;
	if (typeof record.command === "string" && record.command.length > 0) {
		return record.command.slice(0, commandChars);
	}
	for (const key of TOOL_PATH_KEYS) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return "";
}

interface DigestItem {
	/** `prompt` items are counted for the `maxPrompts` limit; the label is already applied. */
	kind: "prompt" | "text" | "tool";
	text: string;
}

/**
 * Fold the branch into a bounded, scrubbed transcript excerpt, or `undefined` when there is
 * nothing to show.
 *
 * Ordering is chronological and stays chronological: the ceilings drop whole items off the
 * front (the oldest), so what remains is always the most recent contiguous slice of the session.
 */
export function buildDigest(
	entries: readonly SessionEntry[],
	options: DigestOptions = {},
): string | undefined {
	const maxChars = positive(options.maxChars, DEFAULTS.maxChars);
	const maxPrompts = positive(options.maxPrompts, DEFAULTS.maxPrompts);
	const promptChars = positive(options.promptChars, DEFAULTS.promptChars);
	const assistantChars = positive(options.assistantChars, DEFAULTS.assistantChars);
	const commandChars = positive(options.commandChars, DEFAULTS.commandChars);

	// First pass: the outcome of every tool call, so a call can be rendered `ok`/`fail` without a
	// second scan. ONLY the `isError` flag is read — the result content is never touched.
	const toolFailed = new Map<string, boolean>();
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message as { role?: unknown; toolCallId?: unknown; isError?: unknown };
		if (message.role === "toolResult" && typeof message.toolCallId === "string") {
			toolFailed.set(message.toolCallId, message.isError === true);
		}
	}

	const items: DigestItem[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message as { role?: unknown; content?: unknown };

		if (message.role === "user") {
			for (const block of textBlocks(message.content)) {
				items.push({ kind: "prompt", text: `user: ${oneLine(block, promptChars)}` });
			}
			continue;
		}

		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (block === null || typeof block !== "object") continue;
			const typed = block as {
				type?: unknown;
				text?: unknown;
				id?: unknown;
				name?: unknown;
				arguments?: unknown;
			};
			if (typed.type === "text" && typeof typed.text === "string" && typed.text.length > 0) {
				items.push({ kind: "text", text: `assistant: ${oneLine(typed.text, assistantChars)}` });
			} else if (typed.type === "toolCall" && typeof typed.name === "string") {
				const target = toolTarget(typed.arguments, commandChars);
				const shown = target.length > 0 ? `${typed.name}(${target})` : typed.name;
				const failed = typeof typed.id === "string" && toolFailed.get(typed.id) === true;
				items.push({ kind: "tool", text: `tool: ${shown} ${failed ? "fail" : "ok"}` });
			}
			// A `thinking` block, or any block this build does not recognise, is skipped on purpose:
			// thinking is the model's private reasoning and has never been part of the boundary.
		}
	}

	if (items.length === 0) return undefined;

	// Keep only the last `maxPrompts` operator prompts (their assistant text and tool lines stay,
	// so the shape of the recent work is not lost when the prompt count is trimmed).
	const keep = new Array<boolean>(items.length).fill(true);
	let seenPrompts = 0;
	for (let i = items.length - 1; i >= 0; i -= 1) {
		if (items[i].kind !== "prompt") continue;
		seenPrompts += 1;
		if (seenPrompts > maxPrompts) keep[i] = false;
	}
	const selected = items.filter((_item, index) => keep[index]);

	// The character ceiling, dropping the OLDEST items first. `+ 1` accounts for the newline
	// each line costs, so the joined result is guaranteed to be at or under the cap.
	let total = selected.reduce((sum, item) => sum + item.text.length + 1, 0);
	while (selected.length > 0 && total > maxChars) {
		total -= selected[0].text.length + 1;
		selected.shift();
	}
	if (selected.length === 0) return undefined;

	return scrubSecrets(selected.map((item) => item.text).join("\n"));
}

/**
 * Replace every recognisable secret with `[redacted]`.
 *
 * Pure and total: it takes a string and returns a string, and it is applied to the digest as the
 * very last step. The patterns are ordinary regular expressions with `\s`/`\b` escapes — no raw
 * control characters anywhere in the source — so a checkout on any platform reads them the same.
 */
export function scrubSecrets(text: string): string {
	if (typeof text !== "string" || text.length === 0) return text;

	let out = text;
	// PEM blocks first: they span lines and may contain anything, including the patterns below.
	out = out.replace(
		/-----BEGIN [A-Z0-9 ]*KEY-----[\s\S]*?-----END [A-Z0-9 ]*KEY-----/g,
		REDACTED,
	);
	// Authorization headers.
	out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
	// Vendor-prefixed API keys and tokens.
	out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED);
	out = out.replace(/\bgh[pous]_[A-Za-z0-9]{8,}/g, REDACTED);
	out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{8,}/g, REDACTED);
	out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED);
	out = out.replace(/\bxox[bp]-[A-Za-z0-9-]{8,}/g, REDACTED);
	// `KEY=value` / `KEY: value` where the key names a credential. The key and separator are kept
	// so the line still reads as a setting; only the value is replaced.
	out = out.replace(
		/\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"'`]+)/gi,
		(_match, name: string, separator: string) => `${name}${separator}${REDACTED}`,
	);
	return out;
}
