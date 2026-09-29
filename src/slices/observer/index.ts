/**
 * observer — turns engine events into the observation window. Nothing else.
 *
 * This slice never interprets and never calls a model. It records what happened,
 * in order, and hands the log to the signal fold. Keeping it that narrow is what
 * lets the whole psychological layer be *replayed*: the same window always folds
 * to the same signals, so an appraisal the programmer disagrees with can be
 * traced back to the events that produced it.
 *
 * Two engine facts shape the code:
 *
 * - Tool calls from one assistant message can run in parallel, so a start event
 *   must never be assumed to precede its sibling's end. Starts are stored by
 *   `toolCallId` and an end without a start is recorded honestly with no command
 *   and no path rather than dropped.
 * - Attribute names differ per tool (`command`, `path`, `file_path`, …), so the
 *   extraction is a lookup over known spellings. An unknown tool simply records
 *   neither, which the fold treats as "no verification evidence".
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MUTATION_TOOLS, classifyFailure, errorTextFromResult, isCommitCommand } from "../../shared/lexicon.js";
import type { DevsPsychologistState } from "../../shared/state.js";
import { mutationsSinceVerified } from "../../shared/signals.js";

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

/**
 * Cross-slice dependency the observer needs: delivering the commit-check text is a slice's job,
 * so the composition root injects it rather than the observer importing another slice.
 */
export interface ObserverDeps {
	/**
	 * Deliver the delivery-boundary notification (T15). Injected by the composition root, which is
	 * the only multi-slice importer — the observer records the fact, a slice delivers the text.
	 */
	notifyUnverifiedCommit?(ctx: ExtensionContext, count: number): void;
	/**
	 * Ledger reactions (T16). The observer is the only place that sees a raw prompt or tool name, so
	 * it forwards exactly those two facts and lets the ledger decide what they mean — the observer
	 * itself stays free of outcome logic.
	 */
	outcome?: {
		notePrompt?(text: string): void;
		noteToolCall?(toolName: string): void;
	};
	/**
	 * A delivery boundary the reviewer role triggers on (T32a): a successful commit/push, or a
	 * `/label` bookmark. Independent of the T15 commit check — that one names an unverified commit,
	 * this one starts a review of whatever was delivered. Nothing is blocked or delayed (D8/D8).
	 */
	onDeliveryBoundary?(ctx: ExtensionContext, kind: "commit" | "label"): void;
}

/**
 * Wire the observation events. Every subscription is tracked so
 * `session_shutdown` can drain it.
 */
export function registerObserver(pi: ExtensionAPI, state: DevsPsychologistState, deps: ObserverDeps = {}): void {
	state.track(
		pi.on("input", (event, ctx) => {
			if (!state.config.enabled) return;
			if (!isProgrammerPrompt(event.source)) return;
			const text = event.text ?? "";
			state.observe({ kind: "prompt", at: Date.now(), text });
			deps.outcome?.notePrompt?.(text);
			// A `/label` bookmark is a delivery boundary the reviewer triggers on (T32a).
			if (/^\s*\/label\b/.test(text)) deps.onDeliveryBoundary?.(ctx, "label");
		}),
	);

	state.track(
		pi.on("tool_execution_start", (event, _ctx) => {
			if (!state.config.enabled) return;
			state.pendingTools.set(event.toolCallId, {
				toolName: event.toolName,
				command: commandFromArgs(event.args),
				path: pathFromArgs(event.toolName, event.args),
			});
		}),
	);

	state.track(
		pi.on("tool_execution_end", (event, ctx) => {
			if (!state.config.enabled) return;
			const pending = state.pendingTools.get(event.toolCallId);
			state.pendingTools.delete(event.toolCallId);
			const ok = event.isError !== true;
			const signature = signatureFromResult(ok === false, event.result);
			// The key is added only when there is something to put in it: an `undefined`
			// property would still occupy a slot in every observation, and the window holds up
			// to `retainObservations` of them.
			state.observe({
				kind: "tool",
				at: Date.now(),
				toolName: event.toolName,
				command: pending?.command,
				path: pending?.path,
				// `isError` is the engine's own verdict; `!event.isError` is not the
				// same as "the command succeeded", and the fold only claims the former.
				ok,
				...(signature === undefined ? {} : { errorSignature: signature }),
			});

			// The `quick_win` reaction (T16): the observer is the only place that sees a tool name, so
			// it forwards it and the ledger decides whether it follows a `name_next_win`.
			deps.outcome?.noteToolCall?.(event.toolName);

			// Delivery-boundary check (T15). Observe only — the command is never blocked or delayed
			// (D8). A successful commit that ships unproven work is named for zero tokens; nothing
			// else happens (a failure, a verified change set, or `commitCheck: false` are all silent).
			if (ok && isCommitCommand(pending?.command)) {
				const mutations = mutationsSinceVerified(state.observations);
				if (state.config.commitCheck && mutations > 0) deps.notifyUnverifiedCommit?.(ctx, mutations);
				// The reviewer trigger (T32a) fires on ANY successful delivery, independent of T15.
				deps.onDeliveryBoundary?.(ctx, "commit");
			}
		}),
	);

	state.track(
		pi.on("turn_end", (_event, _ctx) => {
			if (!state.config.enabled) return;
			state.observe({ kind: "turn", at: Date.now() });
			state.turnsSinceAppraisal += 1;
			state.turnCount += 1;
		}),
	);
}