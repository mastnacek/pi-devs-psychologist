/**
 * child — what this package becomes when it runs as the child pi (T22).
 *
 * The runner (T24) spawns a second pi with `PI_DEVS_PSYCH_CHILD=1`, and the *installed* copy of this
 * extension loads there too (spike Q9). This barrel is the branch it takes: a read-only guard and one
 * submission tool, and nothing else. No observer (the child must not observe itself), no appraiser
 * (the child IS the appraisal), no `/psych`, no statusline chip — a headless print run has no operator
 * watching a chip, and every handler registered here is a handler that could interfere with the run it
 * is part of.
 *
 * The one thing beyond the guard and the tool is the `session_shutdown` drain, because a subscription
 * without a stored unsubscribe leaks into any later session in that process (skill §4, and the repo's
 * own lifecycle invariant). It is plumbing, not a feature: it holds no child state and paints nothing.
 * Unlike the parent it drains a local list rather than a state kernel, because child mode deliberately
 * never creates the kernel.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChildLimits, ChildRole } from "../../shared/child-limits.js";
import { type ChildBudget, guardToolCall } from "./guard.js";
import { registerSubmitTool, type SubmitState } from "./submit.js";

/** Wire the two child-mode pieces onto the engine. Called only from the composition root. */
export function registerChildSlice(pi: ExtensionAPI, role: ChildRole, limits: ChildLimits): void {
	const budget: ChildBudget = { allowedCalls: 0 };
	const submit: SubmitState = { submitted: false, failures: 0 };
	const unsubscribers: Array<() => void> = [];

	const toolCall = pi.on("tool_call", async (event) =>
		guardToolCall(
			{ toolName: event.toolName, input: event.input as Record<string, unknown> },
			limits,
			budget,
		),
	);
	// Older engine typings declare `pi.on()` as void, so only a callable is worth storing.
	if (typeof toolCall === "function") unsubscribers.push(toolCall as () => void);

	registerSubmitTool(pi, role, submit);

	// The drainer itself is not stored. Idempotent: exit and reload can both converge here.
	pi.on("session_shutdown", async () => {
		while (unsubscribers.length > 0) {
			try {
				unsubscribers.pop()?.();
			} catch {
				// ignore
			}
		}
	});
}
