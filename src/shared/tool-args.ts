/**
 * tool-args — the pure extraction of what a tool call carried, shared by the LIVE observer and the
 * offline replay.
 *
 * These four functions used to live in `slices/observer/index.ts`. They are pure (no events, no
 * state, no context), and the replay harness needs them to reconstruct the SAME observation shapes
 * from a past session file. Keeping ONE definition here rather than a second copy in the replay is
 * the whole anti-drift guarantee: the live path and the replay cannot disagree about what a
 * `command` or a failure `signature` is, because there is only one implementation.
 *
 * `slices/observer/index.ts` re-exports every name below, so its public surface — and the tests that
 * import from it — is unchanged.
 */

import { MUTATION_TOOLS, classifyFailure, errorTextFromResult } from "./lexicon.js";

/** Argument spellings seen across the engine's built-in tools. */
const COMMAND_KEYS = ["command", "cmd"] as const;
const PATH_KEYS = ["path", "file_path", "filePath", "file", "target_file"] as const;

function firstString(args: unknown, keys: readonly string[]): string | undefined {
	if (args === null || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

/** The shell command a tool carried, if any. */
export function commandFromArgs(args: unknown): string | undefined {
	return firstString(args, COMMAND_KEYS);
}

/**
 * The file a tool targeted, if any. Only mutation tools count as touching a
 * file: a `read` of the same path is not churn, and counting it would report
 * every file the agent looked at.
 */
export function pathFromArgs(toolName: string, args: unknown): string | undefined {
	if (!MUTATION_TOOLS.has(toolName)) return undefined;
	return firstString(args, PATH_KEYS);
}

/** True when a prompt came from the programmer rather than from an extension. */
export function isProgrammerPrompt(source: unknown): boolean {
	// An extension-injected message is the plugin talking to itself. Counting it
	// as a programmer prompt would corrupt every cadence and restatement signal.
	return source !== "extension";
}

/**
 * The failure signature for a tool that errored, or `undefined`.
 *
 * This is the datum the observer used to throw away. `ToolExecutionEndEvent.result` carries
 * the tool's own error text, and reducing it to `ok: false` is what made this plugin unable
 * to tell "the edit tool could not find its target string" from "the test suite is red" —
 * two failures with opposite remedies, indistinguishable in the evidence set.
 *
 * Only the signature travels. The text itself never leaves this function: `classifyFailure`
 * picks from a fixed vocabulary, so no code, no argument and no path is forwarded.
 */
export function signatureFromResult(isError: boolean, result: unknown): string | undefined {
	if (isError !== true) return undefined;
	return classifyFailure(errorTextFromResult(result));
}
