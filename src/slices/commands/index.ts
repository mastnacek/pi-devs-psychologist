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
import { effectiveAgentModel } from "../../shared/config.js";
import { LOCALES, stringsFor, type Locale } from "../../shared/i18n.js";
import type { HelpTopic } from "../../shared/i18n-help.js";
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
	/**
	 * Show the opt-in cross-session record (`/psych history`, T10). Returns a status line when it
	 * should not render (off, or no UI), and `""` when it has shown the table itself.
	 */
	history(ctx: ExtensionCommandContext): string;
	/**
	 * Ask the observer a direct question (`/psych ask <question>`, T30). Returns a status line for the
	 * skip/failure cases; an empty string when the answer was already shown as a card or notification.
	 */
	ask(ctx: ExtensionCommandContext, question: string): Promise<string>;
	/**
	 * Scout the ecosystem for recurring friction (`/psych scout [topic]`, T31). The topic defaults to
	 * the top recurring fingerprint. Same status-line contract as `ask`.
	 */
	scout(ctx: ExtensionCommandContext, topic: string): Promise<string>;
	/**
	 * Review the change since the last delivery (`/psych review`, T32a). Ignores the once-per-delivery
	 * rule but not the budget. Same status-line contract as `ask`.
	 */
	review(ctx: ExtensionCommandContext): Promise<string>;
	/**
	 * Replay a past session offline, or eval two runs (`/psych replay`, idea 1). Consumes no budget and
	 * is never recorded. Same status-line contract as `ask`: `""` when it rendered its own report.
	 */
	replay(ctx: ExtensionCommandContext, args: string): Promise<string>;
	/** Persist a patch to the chosen layer; returns the path written. */
	save(patch: Record<string, unknown>, isGlobal: boolean, ctx: ExtensionCommandContext): string;
	/** Re-read the config cascade after a write, so the effect is immediate. */
	reload(ctx: ExtensionCommandContext): void;
}

/**
 * The `/psych help` text.
 *
 * This is the setup help the picker's one-word descriptions cannot carry: the listing says what
 * each item IS and shows the value in effect, so it also answers "what am I on?" without leaving
 * the screen, and `/psych help <item>` answers the follow-up question a new user actually has —
 * what happens after it is set, and how to check that it took.
 */
function renderHelp(state: DevsPsychologistState, item: string): string {
	const s = stringsFor(state.config.lang);
	const topic = item.trim().toLowerCase() as HelpTopic;
	if (topic.length > 0) return s.helpDetail[topic];
	const cap = state.config.maxAppraisalsPerSession;
	const values: Record<HelpTopic, string> = {
		model: state.config.model || s.notSet,
		budget: cap === 0 ? "∞" : String(cap),
		lang: state.config.lang,
		runtime: state.config.runtime,
		context: state.config.agent.context,
		"agent-model": effectiveAgentModel(state.config) || s.notSet,
		role: `scout ${state.config.roles.scout.enabled ? "on" : "off"} · reviewer ${state.config.roles.reviewer.enabled ? "on" : "off"}`,
		on: state.config.enabled ? "on" : "off",
		global: s.notSet,
	};
	const lines = [s.helpTitle, "", s.helpOverview, ""];
	for (const t of s.helpTopics) {
		lines.push(`${t.padEnd(12)}${values[t].padEnd(15)}${s.helpLine[t]}`);
	}
	lines.push("", s.helpFooter);
	return lines.join("\n");
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

				case "help": {
					// Pure text: it never saves, never reloads, never touches the budget. An unknown
					// item is an incomplete command, not a silent no-op, so it goes out as a warning.
					const help = stringsFor(state.config.lang);
					const topic = value.trim().toLowerCase() as HelpTopic;
					if (topic.length > 0 && !help.helpTopics.includes(topic)) {
						notify(help.helpUnknown(value.trim(), help.helpTopics.join(" | ")), "warning");
						return;
					}
					notify(renderHelp(state, value));
					return;
				}

				case "now":
					notify(await deps.now(ctx));
					return;

				case "stop":
					notify(deps.stop(ctx));
					return;

				case "effect":
					deps.effect(ctx);
					return;

				case "history": {
					// A terminal leaf with no argument (T10): the slice returns the line to say, or "" when
					// it has rendered the table itself.
					const line = deps.history(ctx);
					if (line.length > 0) notify(line);
					return;
				}

				case "ask": {
					// An empty question is an incomplete command, not a silent no-op: say so.
					if (value.length === 0) {
						notify(stringsFor(state.config.lang).usage, "warning");
						return;
					}
					const line = await deps.ask(ctx, value);
					if (line.length > 0) notify(line);
					return;
				}

				case "scout": {
					// The topic is optional: with none, the slice derives one from the top recurring
					// fingerprint and answers with the usage line when there is nothing to derive from.
					const line = await deps.scout(ctx, value);
					if (line.length > 0) notify(line);
					return;
				}

				case "review": {
					// A terminal leaf with no argument (T32a): run one review now, ignoring once-per-delivery.
					const line = await deps.review(ctx);
					if (line.length > 0) notify(line);
					return;
				}

				case "replay": {
					// The whole tail is handed over verbatim (spacing preserved) because a session path must
					// survive: `parseArgs` joins tokens and would collapse a path's internal spacing.
					const rest = (args ?? "").trim().replace(/^replay\b\s*/, "");
					const line = await deps.replay(ctx, rest);
					if (line.length > 0) notify(line);
					return;
				}

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

				case "role": {
					// `/psych role` — the consent gates of the two optional roles, from the menu and not
					// from a JSON file. Bare, it lists both gates with their states; with a role and a
					// state it persists `{ roles: { <role>: { enabled } } }` to the chosen layer (the
					// per-key merge keeps the other role and the role's other keys intact).
					const s = stringsFor(state.config.lang);
					const parts = value.trim().split(/\s+/).filter((p) => p.length > 0);
					if (parts.length === 0) {
						notify(
							s.roleList(
								state.config.roles.scout.enabled ? s.roleStateOn : s.roleStateOff,
								state.config.roles.reviewer.enabled ? s.roleStateOn : s.roleStateOff,
							),
						);
						return;
					}
					const role = parts[0].toLowerCase();
					const action = (parts[1] ?? "").toLowerCase();
					if ((role !== "scout" && role !== "reviewer") || (action !== "on" && action !== "off")) {
						notify(s.roleUnknown(value.trim(), "role scout on|off · role reviewer on|off"), "warning");
						return;
					}
					const enabled = action === "on";
					state.config.roles[role].enabled = enabled;
					apply({ roles: { [role]: { enabled } } }, s.roleSet(role, action));
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
