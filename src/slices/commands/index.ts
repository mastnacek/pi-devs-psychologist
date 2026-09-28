/**
 * commands — `/psych`, its report, and its settings.
 *
 * This is the handler and the registration; the argument completion lives in
 * `./completions.ts` (split by concept, and to keep each file under the line budget). The
 * completion rules — Trailing Space Contract, full prefix replacement, lazy parameter listing,
 * current-value annotation — are documented there.
 *
 * This slice imports nothing from another slice. The report renderer arrives through
 * `CommandDeps`, because the composition root is the only place allowed to cross a slice
 * boundary.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { LOCALES, stringsFor, type Locale } from "../../shared/i18n.js";
import type { DevsPsychologistState } from "../../shared/state.js";
import { completePsych, GLOBAL_FLAG } from "./completions.js";

// Re-exported so `commands/index.js` stays the one import for `/psych`, as tests and the
// composition root expect.
export { completePsych, GLOBAL_FLAG, MODEL_PICKER_CAP } from "./completions.js";

/** What the command needs from the rest of the plugin, injected by the composition root. */
export interface CommandDeps {
	/** Run an appraisal now, ignoring the cadence but not the budget. Returns a status line. */
	now(ctx: ExtensionCommandContext): Promise<string>;
	/** Stop the running appraisal (T26). Returns a status line. */
	stop(ctx: ExtensionCommandContext): string;
	/** Show the report through whatever surface is available. */
	report(ctx: ExtensionCommandContext): void;
	/** Show the intervention-effect table (T16). Injected so this slice knows no other slice. */
	effect(ctx: ExtensionCommandContext): void;
	/** Persist a patch to the chosen layer; returns the path written. */
	save(patch: Record<string, unknown>, isGlobal: boolean, ctx: ExtensionCommandContext): string;
	/** Re-read the config cascade after a write, so the effect is immediate. */
	reload(ctx: ExtensionCommandContext): void;
}

/**
 * Split raw arguments into the subcommand, its value and the trailing `--global` flag.
 *
 * Every setting command accepts `--global`: with it the patch is persisted to
 * `~/.pi/agent/pi-devs-psychologist.json`, without it to `<cwd>/.pi/pi-devs-psychologist.json`.
 */
export function parseArgs(raw: string): { sub: string; value: string; isGlobal: boolean } {
	const tokens = (raw ?? "").trim().split(/\s+/).filter((part) => part.length > 0);
	const isGlobal = tokens.includes(GLOBAL_FLAG);
	const rest = tokens.filter((part) => part !== GLOBAL_FLAG);
	return { sub: rest[0] ?? "status", value: rest.slice(1).join(" "), isGlobal };
}

export function registerPsychCommand(
	pi: ExtensionAPI,
	state: DevsPsychologistState,
	deps: CommandDeps,
): void {
	pi.registerCommand("psych", {
		description: stringsFor(state.config.lang).commandDescription,
		getArgumentCompletions: (argumentText: string) => completePsych(state, argumentText),
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const { sub, value, isGlobal } = parseArgs(args);
			const notify = (text: string, level: "info" | "warning" | "error" = "info") => {
				if (ctx.hasUI) ctx.ui.notify(text, level);
			};
			/** Apply a patch to the chosen layer, then re-read so the effect is immediate. */
			const apply = (patch: Record<string, unknown>, say: string) => {
				deps.save(patch, isGlobal, ctx);
				deps.reload(ctx);
				notify(say);
			};

			switch (sub) {
				case "status":
					deps.report(ctx);
					return;

				case "now":
					notify(await deps.now(ctx));
					return;

				case "stop":
					notify(deps.stop(ctx));
					return;

				case "effect":
					deps.effect(ctx);
					return;

				case "on":
				case "off": {
					state.config.enabled = sub === "on";
					const s = stringsFor(state.config.lang);
					apply({ enabled: state.config.enabled }, sub === "on" ? s.enabled : s.disabled);
					return;
				}

				case "model": {
					// An empty value would silently clear the model, which reads as "the feature broke"
					// rather than "the command was incomplete".
					if (value.length === 0) {
						notify(stringsFor(state.config.lang).usage, "warning");
						return;
					}
					state.config.model = value;
					apply({ model: value }, stringsFor(state.config.lang).modelSet(value));
					return;
				}

				case "budget": {
					const parsed = Number(value);
					if (!Number.isFinite(parsed) || parsed < 0) {
						notify(stringsFor(state.config.lang).usage, "warning");
						return;
					}
					const n = Math.floor(parsed);
					state.config.maxAppraisalsPerSession = n;
					apply({ maxAppraisalsPerSession: n }, stringsFor(state.config.lang).budgetSet(n === 0 ? "∞" : String(n)));
					return;
				}

				case "lang": {
					const next = value as Locale;
					if (!LOCALES.includes(next)) {
						notify(stringsFor(state.config.lang).usage, "warning");
						return;
					}
					state.config.lang = next;
					apply({ lang: next }, stringsFor(state.config.lang).languageSet(next));
					return;
				}

				case "runtime": {
					const next = value;
					if (next !== "api" && next !== "agent") {
						notify(stringsFor(state.config.lang).usage, "warning");
						return;
					}
					state.config.runtime = next;
					apply({ runtime: next }, stringsFor(state.config.lang).runtimeSet(next));
					return;
				}

				case "context": {
					const next = value;
					const s = stringsFor(state.config.lang);
					if (next !== "evidence" && next !== "digest" && next !== "fork") {
						notify(s.usage, "warning");
						return;
					}
					if (next === "evidence") {
						state.config.agent.context = next;
						apply({ agent: { context: next } }, s.contextSet(next));
						return;
					}
					// digest and fork change what leaves the machine, so they are a consent decision:
					// outside a terminal there is nobody to confirm it, and a one-run flag must never
					// carry a persisted decision.
					if (ctx.mode !== "tui") {
						notify(s.contextNeedsTui, "warning");
						return;
					}
					const confirmed = await ctx.ui.confirm(s.contextConfirmTitle, s.contextConfirmBody(next));
					if (!confirmed) return;
					state.config.agent.context = next;
					apply({ agent: { context: next } }, s.contextSet(next));
					return;
				}

				case "agent-model": {
					if (value.length === 0) {
						notify(stringsFor(state.config.lang).usage, "warning");
						return;
					}
					state.config.agent.model = value;
					apply({ agent: { model: value } }, stringsFor(state.config.lang).agentModelSet(value));
					return;
				}

				default:
					notify(
						`${stringsFor(state.config.lang).unknownOption}: ${sub}\n${stringsFor(state.config.lang).usage}`,
						"warning",
					);
			}
		},
	});
}
