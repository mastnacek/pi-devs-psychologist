/**
 * i18n — the vocabulary the user reads, in one place.
 *
 * The plugin speaks two languages to two audiences and they never mix:
 *
 * - The **plugin's own text** (the appraisal card, the `/psych` report, command
 *   descriptions) is UI copy and comes from this table.
 * - The **psychologist model's prompt and evidence lines** are English in every
 *   locale, because they are instructions to a model, not copy for a human. A
 *   translated evidence line would change the model's reading of the numbers.
 *
 * English stays the default regardless of the repository's visibility: it is the fallback
 * when no language is configured, and the model-facing text is English in every locale.
 *
 * Hard invariant, enforced by `test/i18n.test.js`: every key exists in every
 * locale, recursively. A missing key would not crash — it would silently render
 * `undefined` into the card, which is worse.
 *
 * Never detect the locale from `LANG`/`LC_ALL`/`Intl`: absent on Windows and
 * unreliable in containers. The persisted `lang` setting is the only source of truth.
 */


import { CS, EN, LOCALES, DEFAULT_LOCALE, type Locale, type Strings } from "./i18n-main.js";

export { LABEL_GROUPS, LABEL_SOURCES, type Labels } from "./i18n-labels.js";
export { LOCALES, DEFAULT_LOCALE } from "./i18n-main.js";
export type { Locale, Strings } from "./i18n-main.js";

const STRINGS = { en: EN, cs: CS } satisfies Record<Locale, Strings>;

export function stringsFor(locale: Locale): Strings {
	return STRINGS[locale] ?? STRINGS[DEFAULT_LOCALE];
}

/**
 * Coerce a persisted value into a known locale. An unknown language is a typo, not a reason
 * to fall back to silence, so English wins. The runtime guard stays because a hand-written
 * JSON file can still violate the type.
 */
export function normalizeLocale(value: string | null | undefined): Locale {
	return typeof value === "string" && LOCALES.includes(value as Locale)
		? (value as Locale)
		: DEFAULT_LOCALE;
}

