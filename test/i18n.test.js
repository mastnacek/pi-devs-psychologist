/**
 * Locale table and the chip it drives.
 *
 * One of these tests is a regression test for a real defect: `lang` was validated,
 * persisted, documented — and then ignored, because `status.ts` hardcoded its
 * strings. A config key that silently does nothing is worse than no key at all, so
 * the wiring is pinned here rather than trusted.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOCALE, LABEL_GROUPS, LABEL_SOURCES, LOCALES, normalizeLocale, stringsFor } from "../src/shared/i18n.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { paintChip, STATUS_ID } from "../src/shared/status.js";
import { makeCtx, makeState } from "./fakes.js";

function stateWith(over = {}) {
  return makeState({ config: { ...DEFAULT_CONFIG, ...over } });
}

function chip(state, ctx = makeCtx()) {
  paintChip(state, ctx);
  return ctx.statusCalls.at(-1);
}

test("every locale provides every key, with the same type as English", () => {
  const reference = stringsFor(DEFAULT_LOCALE);
  for (const locale of LOCALES) {
    const strings = stringsFor(locale);
    for (const key of Object.keys(reference)) {
      assert.ok(key in strings, `${locale} is missing key '${key}'`);
      assert.equal(
        typeof strings[key],
        typeof reference[key],
        `${locale}.${key} has the wrong type`,
      );
    }
  }
});

test("no locale ships an empty string: a blank chip is not a translation", () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(stringsFor(locale))) {
      if (typeof value !== "string") continue;
      assert.ok(value.trim().length > 0, `${locale}.${key} is empty`);
    }
  }
});

test("normalizeLocale accepts the known locales and coerces anything else to English", () => {
  assert.equal(normalizeLocale("cs"), "cs");
  assert.equal(normalizeLocale("en"), "en");
  for (const junk of ["de", "", null, undefined, 42, {}, "CS"]) {
    assert.equal(normalizeLocale(junk), "en", `junk locale ${JSON.stringify(junk)}`);
  }
});

test("config.lang actually drives the chip (regression: lang used to be ignored)", () => {
  const en = chip(stateWith({ lang: "en" }));
  const cs = chip(stateWith({ lang: "cs" }));
  assert.deepEqual(en, { id: STATUS_ID, text: "psych: signals" });
  assert.deepEqual(cs, { id: STATUS_ID, text: "psych: signály" });
  assert.notEqual(en.text, cs.text, "the locale must change the painted text");
});

test("an unknown lang falls back to English text rather than to silence", () => {
  const ctx = makeCtx();
  const state = stateWith({ lang: "klingon" });
  // The config layer coerces the typo, but the chip must survive a state that was
  // built without it — a missing locale must never mean a missing chip.
  state.config.lang = "klingon";
  paintChip(state, ctx);
  assert.equal(ctx.statusCalls.at(-1).text, "psych: signals");
});

test("a disabled plugin says so in the configured locale", () => {
  assert.equal(chip(stateWith({ enabled: false })).text, "psych: off");
  assert.equal(chip(stateWith({ enabled: false, lang: "cs" })).text, "psych: vyp");
});

test("off wins over configured: the user must never have to ask whether it is running", () => {
  const state = stateWith({ enabled: false, model: "openrouter-soukr/some/model" });
  assert.equal(chip(state).text, "psych: off");
});

test("with a model configured the chip shows the waiting turns and the budget", () => {
  const state = stateWith({ model: "openrouter-soukr/some/model", maxAppraisalsPerSession: 12 });
  state.turnsSinceAppraisal = 3;
  state.appraisalsThisSession = 0;
  assert.equal(chip(state).text, "psych 3t · 0/12");

  state.appraisalsThisSession = 5;
  assert.equal(chip(state).text, "psych 3t · 5/12");
});

test("an unlimited budget is one number, not a fraction of zero", () => {
  const state = stateWith({ model: "a/b", maxAppraisalsPerSession: 0 });
  state.appraisalsThisSession = 4;
  assert.equal(chip(state).text, "psych 0t · 4");
});

test("an in-flight appraisal is shown, so a slow model does not look like a dead one", () => {
  const state = stateWith({ model: "a/b" });
  state.appraisalInFlight = true;
  assert.equal(chip(state).text, "psych … · 0/12");
});

test("the three chip states are mutually distinguishable at a glance", () => {
  const nothing = chip(stateWith({ enabled: false })).text;
  const signals = chip(stateWith({ model: "" })).text;
  const appraising = chip(stateWith({ model: "a/b" })).text;
  assert.equal(new Set([nothing, signals, appraising]).size, 3);
});

test("the chip is skipped entirely when there is no UI", () => {
  const ctx = makeCtx({ hasUI: false });
  paintChip(stateWith(), ctx);
  assert.deepEqual(ctx.statusCalls, []);
});

/** Every leaf of a strings object as dotted paths, so nested tables are compared too. */
function leafPaths(node, prefix = "") {
  const paths = [];
  for (const name in node) {
    const value = node[name];
    const path = prefix === "" ? name : prefix + "." + name;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...leafPaths(value, path));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}

test("every locale carries the same leaves, recursively", () => {
  // The top-level check could pass while a nested label was missing, and a missing label
  // renders `undefined` into the card rather than failing.
  const reference = leafPaths(stringsFor(DEFAULT_LOCALE));
  for (const locale of LOCALES) {
    assert.deepEqual(leafPaths(stringsFor(locale)), reference, locale + " differs from " + DEFAULT_LOCALE);
  }
});

test("every enum member in the appraisal contract has a human name in every locale", () => {
  // The compile-time `Record<Enum, string>` types already guarantee this; this test is the
  // evidence, because a raw token on screen is what the guarantee exists to prevent.
  for (const group of LABEL_GROUPS) {
    const members = LABEL_SOURCES[group];
    for (const locale of LOCALES) {
      const table = stringsFor(locale).labels[group];
      for (const member of members) {
        assert.equal(
          typeof table[member],
          "string",
          locale + ".labels." + group + "." + member + " is missing",
        );
        assert.ok(table[member].trim().length > 0, locale + ".labels." + group + "." + member + " is empty");
      }
    }
  }
});

test("the two locales actually differ, so the table is not English twice", () => {
  assert.notDeepEqual(stringsFor("en").labels, stringsFor("cs").labels);
  assert.notEqual(stringsFor("cs").reportTitle, stringsFor("en").reportTitle);
});
