/**
 * commands/completions-model — the model picker, split out of `completions.ts` by concept (and to
 * keep both files under the line budget). It hosts the two shared item constructors (`leaf`,
 * `branch`) and the current-value marker (`MARK`) as well, so the two completion files import
 * helpers from one direction only and no import cycle exists.
 *
 * The model picker's rules are spelled out here because they are easy to get wrong:
 * - every level is completed FROM THE REGISTRY (`state.modelCatalog` / `state.modelProviders`),
 *   so a completed value is always something the engine can resolve — never invented free text;
 * - the ✓ marker and the per-appraisal cost estimate share one description line, and the marker
 *   for the active reference is carried on the PROVIDER row too, so the current value is visible
 *   without descending;
 * - the list is capped at `MODEL_PICKER_CAP` and the overflow row re-inserts the typed text,
 *   because a picker that silently truncates hides models with no way to tell.
 */

import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { appraisalCostUsd } from "../../shared/cost.js";
import { stringsFor, type Strings } from "../../shared/i18n.js";
import type { DevsPsychologistState } from "../../shared/state.js";

/** The engine's own item type, so this cannot drift from what the picker reads. */
type Completion = AutocompleteItem;

/** A terminal choice: no trailing space, because Tab confirms it as final. */
export function leaf(value: string, label: string, description?: string): Completion {
	return { value, label, description };
}

/** A choice that takes further arguments: trailing space, so Tab offers the next level. */
export function branch(value: string, label: string, description?: string): Completion {
	return { value: `${value} `, label, description };
}

/** The marker that says "this is the value in effect". Never ANSI. */
export const MARK = "· ●";


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
