/**
 * commands — `/psych`, its report, and its settings.
 *
 * The completion rules that are easy to get wrong, and are therefore spelled out here:
 *
 * - **Trailing Space Contract.** A non-terminal choice that takes further arguments appends a
 *   space, so Tab confirms and immediately offers the next level; a terminal leaf does not.
 * - **Full prefix replacement.** `item.value` replaces the *entire* argument text after
 *   `/psych `, so a nested value carries its parent path (`lang en`, not `en`), and a flag
 *   carries the value it follows (`model a/b --global`). `item.label` stays the clean leaf.
 * - **Lazy parameter completion.** A subcommand with enumerable parameters returns its children
 *   as soon as the token is fully typed — not only after the space. The engine closes the picker
 *   on Tab and switches to file completion once a space exists, so the trailing-space form alone
 *   strands the user.
 * - **Current-value annotation.** A settings menu shows the value actually in effect: `✓` in the
 *   active item's label, `· ●` in its description, and the same marker on the parent's
 *   description. Never in `item.value` (it is inserted verbatim), and never ANSI.
 * - **`--global` is a trailing flag, not a subcommand.** Every setting command accepts it:
 *   with it the patch goes to `~/.pi/agent/pi-devs-psychologist.json`, without it to
 *   `<cwd>/.pi/pi-devs-psychologist.json`.
 *
 * This slice imports nothing from another slice. The report renderer arrives through
 * `CommandDeps`, because the composition root is the only place allowed to cross a slice
 * boundary.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { LOCALES, stringsFor, type Locale } from "../../shared/i18n.js";
import type { DevsPsychologistState } from "../../shared/state.js";

/** What the command needs from the rest of the plugin, injected by the composition root. */
export interface CommandDeps {
	/** Run an appraisal now, ignoring the cadence but not the budget. Returns a status line. */
	now(ctx: ExtensionCommandContext): Promise<string>;
	/** Show the report through whatever surface is available. */
	report(ctx: ExtensionCommandContext): void;
	/** Persist a patch to the chosen layer; returns the path written. */
	save(patch: Record<string, unknown>, isGlobal: boolean, ctx: ExtensionCommandContext): string;
	/** Re-read the config cascade after a write, so the effect is immediate. */
	reload(ctx: ExtensionCommandContext): void;
}

interface Completion {
	value: string;
	label: string;
	description?: string;
}

/** The flag that redirects a setting write to the global layer. */
export const GLOBAL_FLAG = "--global";

/** Subcommands that change a setting, and therefore accept `--global`. */
const SETTINGS_HEADS = new Set(["on", "off", "model", "budget", "lang"]);

/** A terminal choice: no trailing space, because Tab confirms it as final. */
function leaf(value: string, label: string, description?: string): Completion {
	return { value, label, description };
}

/** A choice that takes further arguments: trailing space, so Tab offers the next level. */
function branch(value: string, label: string, description?: string): Completion {
	return { value: `${value} `, label, description };
}

/** The marker that says "this is the value in effect". Never ANSI. */
const MARK = "· ●";

/**
 * The subcommand menu. Settings commands carry the value in effect, because a settings menu
 * that does not show the current setting is a menu you have to leave in order to check.
 */
function subcommands(state: DevsPsychologistState): Completion[] {
	const s = stringsFor(state.config.lang);
	const cap = state.config.maxAppraisalsPerSession;
	return [
		leaf("status", "status", s.reportAppraisal),
		leaf("now", "now", s.done),
		branch("on", "on", state.config.enabled ? `${MARK} ${s.enabled}` : s.enabled),
		branch("off", "off", state.config.enabled ? s.disabled : `${MARK} ${s.disabled}`),
		branch("model", "model", state.config.model || "—"),
		branch("budget", "budget", `${cap === 0 ? "∞" : cap}`),
		branch("lang", "lang", `${MARK} ${state.config.lang}`),
	];
}

/** `lang` children: locale codes, with the one in effect marked. */
function languages(state: DevsPsychologistState): Completion[] {
	return LOCALES.map((locale) =>
		leaf(`lang ${locale}`, locale, locale === state.config.lang ? `${MARK} active` : undefined),
	);
}

/**
 * The optional trailing flag. Offered once the value is settled — after a space, or while a
 * `-` prefix is being typed — and never in place of the value itself.
 */
function flagCompletion(
	typed: string,
	parts: readonly string[],
	description: string,
): Completion[] {
	const endsWithSpace = /\s$/.test(typed);
	const last = parts[parts.length - 1] ?? "";
	const isFlagPrefix = !endsWithSpace && last.startsWith("-");
	if (!endsWithSpace && !isFlagPrefix) return [];
	const base = (isFlagPrefix ? parts.slice(0, -1) : parts).join(" ");
	return [
		{
			// The full argument text, because `value` replaces all of it.
			value: base.length > 0 ? `${base} ${GLOBAL_FLAG}` : GLOBAL_FLAG,
			label: GLOBAL_FLAG,
			description,
		},
	];
}

/**
 * Complete what the operator has typed so far.
 *
 * Returns `null` (not an empty array) when the command has no opinion, so the engine falls back
 * to its own completion for free-text parameters like `model`.
 */
export function completePsych(
	state: DevsPsychologistState,
	argumentText: string,
): Completion[] | null {
	const typed = (argumentText ?? "").trimStart();
	// `hasSpace` distinguishes "the first token is finished" from "a parameter is being typed".
	// Both paths are required: the lazy one must fire *without* the space, because the engine
	// closes the picker on Tab once a space exists.
	const hasSpace = /\s/.test(typed);
	const parts = typed.split(/\s+/).filter((part) => part.length > 0);
	const head = parts[0] ?? "";
	const s = stringsFor(state.config.lang);

	if (!hasSpace) {
		// Lazy parameter completion: the token is complete, no space yet.
		if (head === "lang") return languages(state);
		const all = subcommands(state);
		if (head.length === 0) return all;
		const matching = all.filter((item) => item.label.startsWith(head));
		return matching.length > 0 ? matching : null;
	}

	// A parameter is being typed. Only `lang` is enumerable; `model` and `budget` are free text,
	// and guessing at either would be worse than saying nothing.
	if (head === "lang") {
		const partial = (parts[1] ?? "").toLowerCase();
		const all = languages(state);
		const matching = partial.length === 0 ? all : all.filter((item) => item.label.startsWith(partial));
		if (matching.length > 0) return matching;
	}

	if (SETTINGS_HEADS.has(head)) {
		const flags = flagCompletion(typed, parts, s.globalFlag);
		if (flags.length > 0) return flags;
	}
	return null;
}

/** Split raw arguments into the subcommand, its value and the global flag. */
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

				default:
					notify(
						`${stringsFor(state.config.lang).unknownOption}: ${sub}\n${stringsFor(state.config.lang).usage}`,
						"warning",
					);
			}
		},
	});
}
