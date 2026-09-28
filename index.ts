/**
 * pi-devs-psychologist — a second model watches the session as an engineering
 * psychologist.
 *
 * Composition root ONLY: it creates the state kernel, wires slices onto Pi
 * events, and injects each slice's cross-slice dependency. No business logic
 * lives here:
 * - objective session signals  → src/shared/signals + src/shared/lexicon
 * - config cascade             → src/shared/config
 * - statusline ownership       → src/shared/status
 * - event → observation window → src/slices/observer
 *
 * What this plugin is NOT: it is not a coach with opinions about code, not a
 * score, and not an authority over the working agent. It observes, it may name
 * one intervention, and it always shows the evidence it used.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createDevsPsychologistState, reloadConfig } from "./src/shared/state.js";
import { registerObserver } from "./src/slices/observer/index.js";
import { clearChip, paintChip } from "./src/shared/status.js";

export default function devsPsychologistExtension(pi: ExtensionAPI): void {
	// Subagent and child sessions load every global extension. An observer that
	// watched its own children would fold its own prompts into the programmer's
	// signals and spend the session's appraisal budget on noise (skill §8).
	if (process.env.PI_SUBAGENT === "true" || Boolean(process.env.PI_CHILD_SESSION)) return;

	const state = createDevsPsychologistState(pi);

	// Session init: reload the cascading config (which needs a cwd that does not
	// exist at extension-load time) and start from an empty observation window, so
	// a new session is never appraised using an old session's events.
	state.track(
		pi.on("session_start", async (_event, ctx) => {
			reloadConfig(state, ctx.cwd);
			state.resetWindow();
			paintChip(state, ctx);
		}),
	);

	registerObserver(pi, state);

	// Cleanup: drain listeners and release the statusline slot. Idempotent,
	// because cancellation, reload and exit can all converge here.
	pi.on("session_shutdown", async (_event, ctx) => {
		while (state.unsubscribers.length > 0) {
			try {
				state.unsubscribers.pop()?.();
			} catch {
				// ignore
			}
		}
		state.resetWindow();
		state.ifLive(() => clearChip(ctx));
	});
}