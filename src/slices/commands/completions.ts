/**
 * commands/completions — the `/psych` argument completion, split out of the handler by concept.
 *
 * The rules that are easy to get wrong, and are therefore spelled out here:
 *
 * - **Trailing Space Contract.** A non-terminal choice that takes further arguments appends a
 *   space, so Tab confirms and immediately offers the next level; a terminal leaf does not.
 * - **Full prefix replacement.** `item.value` replaces the *entire* argument text after `/psych `,
 *   so a nested value carries its parent path (`lang en`, not `en`), and a flag carries the value
 *   it follows (`model a/b --global`). `item.label` stays the clean leaf.
 * - **Lazy parameter completion.** A subcommand with enumerable parameters returns its children as
 *   soon as the token is fully typed — not only after the space. The engine closes the picker on
 *   Tab and switches to file completion once a space exists, so the trailing-space form alone
 *   strands the user.
 * - **Current-value annotation.** A settings menu shows the value actually in effect: `✓` in the
 *   active item's label, `· ●` in its description, and the same marker on the parent's description.
 *   Never in `item.value` (it is inserted verbatim), and never ANSI.
 */

import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { effectiveAgentModel } from "../../shared/config.js";
import { LOCALES, stringsFor, type Strings } from "../../shared/i18n.js";
import type { DevsPsychologistState } from "../../shared/state.js";
import { MARK, branch, leaf, modelCompletions, MODEL_PICKER_CAP } from "./completions-model.js";

// Re-exported so `commands/index.js` stays the one import for the model picker, as tests and
// the composition root expect.
export { MODEL_PICKER_CAP, modelCompletions } from "./completions-model.js";

/** The engine's own item type, so this cannot drift from what the picker reads. */
type Completion = AutocompleteItem;

/** The flag that redirects a setting write to the global layer. */
export const GLOBAL_FLAG = "--global";

/** Subcommands that change a setting, and therefore accept `--global`. */
const SETTINGS_HEADS = new Set([
	"on",
	"off",
	"model",
	"budget",
	"lang",
	"runtime",
	"context",
	"agent-model",
]);


/**
 * `help` children: one leaf per topic, described by the topic's own one-liner. The description is
 * the whole reason the topic row exists — a user who knows the name but not the meaning reads it
 * before descending, and the detail text is one Tab away at `/psych help <topic>`.
 */
function helpTopics(state: DevsPsychologistState, partial: string): Completion[] | null {
	const s = stringsFor(state.config.lang);
	const all = s.helpTopics.map((topic) => leaf(`help ${topic}`, topic, s.helpLine[topic]));
	if (partial.length === 0) return all;
	const matching = all.filter((item) => item.label.startsWith(partial));
	return matching.length > 0 ? matching : null;
}

/**
 * The subcommand menu. Settings commands carry the value in effect, because a settings menu
 * that does not show the current setting is a menu you have to leave in order to check.
 */
function subcommands(state: DevsPsychologistState): Completion[] {
	const s = stringsFor(state.config.lang);
	const cap = state.config.maxAppraisalsPerSession;
	return [
		leaf("status", "status", s.cmdStatus),
		leaf("now", "now", s.cmdNow),
		// A terminal leaf: no trailing space, because Tab confirms it as final (T26).
		leaf("stop", "stop", s.cmdStop),
		// A terminal leaf: no trailing space, because Tab confirms it as final (T16).
		leaf("effect", "effect", s.cmdEffect),
		// A terminal leaf (T10). The description names the record's state in effect, so the menu says
		// whether anything is being kept without running the command.
		leaf(
			"history",
			"history",
			state.config.history.enabled ? `${MARK} ${s.historyRecordOn}` : s.historyRecordOff,
		),
		// A non-terminal that takes free text (T30): the trailing space opens the question, and there is
		// nothing enumerable to complete after it, so no further items are offered.
		branch("ask", "ask", s.cmdAsk),
		// The scout takes free text too, and its topic is optional (T31): the trailing space opens it,
		// and running it with no topic scouts the top recurring fingerprint.
		branch("scout", "scout", s.cmdScout),
		// A terminal leaf: no trailing space, because Tab confirms it as final (T32a).
		leaf("review", "review", s.cmdReview),
		// Non-terminal (idea 1): it takes a session-file path, and there is nothing enumerable to
		// complete after it, so the trailing space opens the free-form parameter.
		branch("replay", "replay", s.cmdReplay),
		// Non-terminal: it takes an optional topic, whose children are listed with their meanings,
		// so a new user can set the plugin up without leaving the picker (the setup-help slice).
		branch("help", "help", s.cmdHelp),
		// The marker goes in `label` (display-only, the primary column) as well as the description:
		// a settings menu that does not show which choice is in effect makes the user run `status`
		// first to find out. `value` stays a clean token because it is inserted verbatim.
		branch("on", state.config.enabled ? "on ✓" : "on", state.config.enabled ? `${MARK} ${s.enabled}` : s.enabled),
		branch("off", state.config.enabled ? "off" : "off ✓", state.config.enabled ? s.disabled : `${MARK} ${s.disabled}`),
		// A labelled value, not a bare one: `12` alone does not say which setting it is.
		branch("model", "model", state.config.model ? s.nowValue(state.config.model) : s.notSet),
		branch("budget", "budget", s.nowValue(cap === 0 ? "∞" : String(cap))),
		branch("lang", "lang", `${MARK} ${state.config.lang}`),
		// The runtime switch and the consent level. The parent row names the value in effect, so the
		// first-level menu already answers "which runtime am I on?".
		branch("runtime", "runtime", `${MARK} ${state.config.runtime}`),
		branch("context", "context", `${MARK} ${state.config.agent.context}`),
		branch(
			"agent-model",
			"agent-model",
			effectiveAgentModel(state.config) ? s.nowValue(effectiveAgentModel(state.config)) : s.notSet,
		),
		// The role consent gates: on/off from the menu, never only from the config file.
		branch("role", "role", s.cmdRole),
	];
}

/** `lang` children: locale codes, with the one in effect marked. */
function languages(state: DevsPsychologistState): Completion[] {
	return LOCALES.map((locale) =>
		leaf(
			`lang ${locale}`,
			// ✓ in the label is the primary-column marker; the description carries the text form.
			locale === state.config.lang ? `${locale} ✓` : locale,
			locale === state.config.lang ? `${MARK} active` : undefined,
		),
	);
}

/** `context` children: the three consent levels, each with its plain-word meaning; the one in effect marked. */
function contexts(state: DevsPsychologistState): Completion[] {
	const s = stringsFor(state.config.lang);
	const current = state.config.agent.context;
	const meaning: Record<string, string> = {
		evidence: s.contextEvidence,
		digest: s.contextDigest,
		fork: s.contextFork,
	};
	return (["evidence", "digest", "fork"] as const).map((level) =>
		leaf(
			`context ${level}`,
			level === current ? `${level} ✓` : level,
			(level === current ? `${MARK} ` : "") + meaning[level],
		),
	);
}

/** `replay` children: the terminal mode leaves, with the default (`--dry`) marked. */
function replayOptions(state: DevsPsychologistState): Completion[] {
	const s = stringsFor(state.config.lang);
	return [
		leaf("replay --run", "run", s.replayModeRun),
		// The default mode is dry: no model call, zero spend. The value in effect is marked in the
		// label (primary column) and the description, never in `value` (inserted verbatim).
		leaf("replay --dry", "dry ✓", `${MARK} ${s.replayModeDry}`),
		leaf("replay --eval", "eval", s.replayEvalOption),
	];
}

/** `runtime` children: the two runtime modes, each with its plain-word meaning; the one in effect marked. */
function runtimes(state: DevsPsychologistState): Completion[] {
	const current = state.config.runtime;
	const meaning = (mode: "api" | "agent") => (mode === "api" ? stringsFor(state.config.lang).runtimeApi : stringsFor(state.config.lang).runtimeAgent);
	return (["api", "agent"] as const).map((mode) =>
		leaf(
			`runtime ${mode}`,
			mode === current ? `${mode} ✓` : mode,
			(mode === current ? `${MARK} ` : "") + meaning(mode),
		),
	);
}

/**
 * `role` children: one leaf per role-and-state, described by the role's own one-liner with the
 * gate's state marked. Terminal leaves — no trailing space — because nothing follows `on|off`.
 */
function roleChildren(state: DevsPsychologistState, partial: string): Completion[] | null {
	const s = stringsFor(state.config.lang);
	const desc = (role: "scout" | "reviewer") =>
		role === "scout" ? s.roleScoutDesc : s.roleReviewerDesc;
	const all = (["scout", "reviewer"] as const).flatMap((role) =>
		(["on", "off"] as const).map((state_) => {
			const active = state.config.roles[role].enabled === (state_ === "on");
			return leaf(
				`role ${role} ${state_}`,
				active ? `${role} ${state_} ✓` : `${role} ${state_}`,
				(active ? `${MARK} ` : "") + desc(role),
			);
		}),
	);
	if (partial.length === 0) return all;
	const matching = all.filter((item) => item.label.startsWith(partial));
	return matching.length > 0 ? matching : null;
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
	// The `agent-model` picker marks the model in effect, which is `agent.model` when set, else the
	// shared `model` — the same resolution the chip and the report use.
	const agentPick = { head: "agent-model", activeRef: effectiveAgentModel(state.config) };

	if (!hasSpace) {
		// Lazy parameter completion, and it is MANDATORY rather than a nicety: Tab-confirming a
		// non-terminal token closes the picker, and typing a space switches the engine to file
		// completion. So a fully-typed `lang` or `model` must offer its parameters *here*, or they
		// are unreachable by Tab altogether (references/command-completions.md §Lazy).
		if (head === "lang") return languages(state);
		if (head === "model") return modelCompletions(state, "");
		if (head === "runtime") return runtimes(state);
		if (head === "context") return contexts(state);
		if (head === "agent-model") return modelCompletions(state, "", agentPick);
		if (head === "replay") return replayOptions(state);
		if (head === "help") return helpTopics(state, "");
		if (head === "role") return roleChildren(state, "");
		// A partial prefix keeps the trailing-space parent item, so Tab still inserts token + space.
		const all = subcommands(state);
		if (head.length === 0) return all;
		const matching = all.filter((item) => item.label.startsWith(head));
		return matching.length > 0 ? matching : null;
	}

	// `lang` is a closed set of two; `model` comes from the engine's registry, so the picker
	// lists real models instead of inviting a typo in `openrouter-soukr/deepseek/...`.
	// A value is "settled" once something has been typed for it AND either a space follows or a
	// further token has begun. Only then can the trailing flag come next; before that the value
	// itself is still being completed. Getting this wrong made `lang cs --global` and
	// `model <ref> --global` accepted by the handler but unreachable by Tab.
	const afterHead = typed.slice(head.length);
	const valueText = afterHead.trim();
	const hasValue = valueText.length > 0;
	const settled = hasValue && (/\s$/.test(typed) || valueText.split(/\s+/).length > 1);

	if (head === "lang") {
		if (settled) return flagCompletion(typed, parts, s.globalFlag);
		const partial = (parts[1] ?? "").toLowerCase();
		const all = languages(state);
		const matching = partial.length === 0 ? all : all.filter((item) => item.label.startsWith(partial));
		if (matching.length > 0) return matching;
	} else if (head === "model") {
		if (settled) return flagCompletion(typed, parts, s.globalFlag);
		return modelCompletions(state, valueText);
	} else if (head === "runtime") {
		if (settled) return flagCompletion(typed, parts, s.globalFlag);
		return runtimes(state);
	} else if (head === "context") {
		if (settled) return flagCompletion(typed, parts, s.globalFlag);
		return contexts(state);
	} else if (head === "agent-model") {
		if (settled) return flagCompletion(typed, parts, s.globalFlag);
		return modelCompletions(state, valueText, agentPick);
	} else if (head === "replay") {
		return replayOptions(state);
	} else if (head === "help") {
		// A topic is terminal and help is not a setting, so no --global follows it.
		return helpTopics(state, valueText);
	} else if (head === "role") {
		// The gate is terminal; role is not a plain setting in the SETTINGS_HEADS sense but it
		// still accepts --global, so the flag completion runs first.
		const flags = flagCompletion(typed, parts, s.globalFlag);
		if (flags.length > 0) return flags;
		return roleChildren(state, valueText);
	}

	if (SETTINGS_HEADS.has(head)) {
		const flags = flagCompletion(typed, parts, s.globalFlag);
		if (flags.length > 0) return flags;
	}
	return null;
}

