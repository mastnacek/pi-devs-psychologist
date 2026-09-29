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
import { appraisalCostUsd } from "../../shared/cost.js";
import { LOCALES, stringsFor, type Strings } from "../../shared/i18n.js";
import type { DevsPsychologistState } from "../../shared/state.js";

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
		leaf("status", "status", s.cmdStatus),
		leaf("now", "now", s.cmdNow),
		// A terminal leaf: no trailing space, because Tab confirms it as final (T26).
		leaf("stop", "stop", s.cmdStop),
		// A terminal leaf: no trailing space, because Tab confirms it as final (T16).
		leaf("effect", "effect", s.cmdEffect),
		// A non-terminal that takes free text (T30): the trailing space opens the question, and there is
		// nothing enumerable to complete after it, so no further items are offered.
		branch("ask", "ask", s.cmdAsk),
		// The scout takes free text too, and its topic is optional (T31): the trailing space opens it,
		// and running it with no topic scouts the top recurring fingerprint.
		branch("scout", "scout", s.cmdScout),
		// A terminal leaf: no trailing space, because Tab confirms it as final (T32a).
		leaf("review", "review", s.cmdReview),
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

/** `context` children: the three consent levels, with the one in effect marked. */
function contexts(state: DevsPsychologistState): Completion[] {
	const current = state.config.agent.context;
	return (["evidence", "digest", "fork"] as const).map((level) =>
		leaf(
			`context ${level}`,
			level === current ? `${level} ✓` : level,
			level === current ? `${MARK} active` : undefined,
		),
	);
}

/** `runtime` children: the two runtime modes, with the one in effect marked. */
function runtimes(state: DevsPsychologistState): Completion[] {
	const current = state.config.runtime;
	return (["api", "agent"] as const).map((mode) =>
		leaf(
			`runtime ${mode}`,
			mode === current ? `${mode} ✓` : mode,
			mode === current ? `${MARK} active` : undefined,
		),
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
	}

	if (SETTINGS_HEADS.has(head)) {
		const flags = flagCompletion(typed, parts, s.globalFlag);
		if (flags.length > 0) return flags;
	}
	return null;
}

/**
 * How many model rows the picker will show before it stops and says so.
 *
 * The catalog can hold hundreds of entries — an OpenRouter account alone reuses the whole
 * built-in catalog — and a 400-row picker is exactly the nagging this plugin exists to avoid.
 * Narrowing costs one keystroke; scrolling costs attention.
 */
export const MODEL_PICKER_CAP = 50;

/**
 * Model completions, in two levels, all of them from the registry.
 *
 * - nothing or a partial provider → the providers, as `<head> <provider>/`, so the next level is
 *   one Tab away;
 * - a settled provider → that provider's models, as `<head> <provider>/<id>`;
 * - a partial reference → matching references.
 *
 * `head` is the subcommand token (`model` or `agent-model`), so the same picker serves the shared
 * model and the agent model without duplicating a line. `activeRef` is the reference in effect, so
 * the ✓ marker points at the right row in each case.
 *
 * A provider that is not in the registry is never offered, and nothing is invented, so a completed
 * value is always something the engine can resolve — which is the whole reason to ask the registry
 * instead of accepting free text.
 */
export function modelCompletions(
	state: DevsPsychologistState,
	partial: string,
	options: { head?: string; activeRef?: string } = {},
): Completion[] | null {
	// Read at completion time, never captured at registration, so a config change shows up.
	const s = stringsFor(state.config.lang);
	const head = options.head ?? "model";
	const activeRef = options.activeRef ?? state.config.model;
	const refs = state.modelCatalog;
	const providers = state.modelProviders;
	// No catalog (a registry that answered nothing): defer to the engine rather than failing.
	if (refs.length === 0 && providers.length === 0) return null;

	// ✓ in `label` (the primary column) and the text form in `description`; never in `value`,
	// which is inserted verbatim, and never ANSI, which cancels the theme colour.
	const marker = (ref: string) => (ref === activeRef ? `${MARK} current` : undefined);
	const ticked = (text: string, active: boolean) => (active ? `${text} ✓` : text);
	// The estimated price per appraisal, from the registry rate. An unknown rate says so rather than
	// guessing (T: cost estimate); the ✓ marker and the cost still share one description line.
	const costText = (ref: string): string => {
		const usd = appraisalCostUsd(state.modelCosts[ref], state.config.estimateTokens);
		return usd === undefined ? s.priceUnknown : s.costPerAppraisal(usd.toFixed(2));
	};
	const refDescription = (ref: string): string =>
		[marker(ref), costText(ref)].filter((part): part is string => part !== undefined).join(" · ");
	const refItem = (ref: string): Completion => leaf(`${head} ${ref}`, ticked(ref, ref === activeRef), refDescription(ref));

	// Level three: a settled provider prefix — only its own models can follow.
	if (partial.endsWith("/")) {
		const provider = partial.slice(0, -1);
		if (!providers.includes(provider)) return null;
		const prefix = provider + "/";
		return capped(
			refs
				.filter((ref) => ref.startsWith(prefix))
				.map((ref) => leaf(`${head} ${ref}`, ticked(ref.slice(prefix.length), ref === activeRef), refDescription(ref))),
			partial,
			s,
			head,
		);
	}

	// Level two: a partial reference.
	if (partial.includes("/")) {
		// Substring, not prefix: the interesting part of a reference is often in the middle.
		// Typing `soukr` should find `openrouter-soukr`, and `claude` a `deepseek/…/claude-…`
		// entry, without knowing the account prefix first.
		// The label is the full reference here, because the whole path is what was matched.
		const matching = refs.filter((ref) => ref.includes(partial)).map(refItem);
		return matching.length > 0 ? capped(matching, partial, s, head) : null;
	}

	// Level one: providers, then any reference that matches the same text.
	const providerItems = providers
		// Substring for the same reason as level two: `soukr` must find `openrouter-soukr`.
		.filter((provider) => provider.includes(partial))
		.map((provider) =>
			// The parent level carries the marker too when the model in effect lives under it, which
			// is the whole point of annotating a hierarchy: you can see the current value without
			// descending into it.
			leaf(
				`${head} ${provider}/`,
				ticked(provider, activeRef.startsWith(provider + "/")),
				activeRef.startsWith(provider + "/") ? `${MARK} current` : undefined,
			),
		);
	const refItems = partial.length === 0 ? [] : refs.filter((ref) => ref.includes(partial)).map(refItem);
	const items = [...providerItems, ...refItems];
	return items.length > 0 ? capped(items, partial, s, head) : null;
}

/**
 * Cap the list and say what was left out.
 *
 * The remainder row deliberately re-inserts the text that is already typed, so selecting it changes
 * nothing: a picker that silently truncates would hide models with no way to tell.
 */
function capped(items: Completion[], partial: string, s: Strings, head: string): Completion[] {
	if (items.length <= MODEL_PICKER_CAP) return items;
	const rest = items.length - MODEL_PICKER_CAP;
	return [
		...items.slice(0, MODEL_PICKER_CAP),
		// `value` replaces the entire argument text after `/psych `, so the remainder row must
		// carry the `<head> ` prefix and the trailing state the operator already typed. Selecting
		// it therefore re-inserts exactly what is there: a picker that silently truncates hides
		// models with no way to tell.
		{ value: `${head} ` + partial, label: s.modelMore(rest), description: s.typeToNarrow },
	];
}
