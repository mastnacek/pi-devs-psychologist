/**
 * `/psych effect` (T16) — the intervention-effect table and its completion.
 *
 * Two things are pinned here: the completion is a terminal leaf (no trailing space, per the
 * workshop's Trailing Space Contract), and the table is width-safe — a narrow terminal must clip
 * the report, never crash the host process (`pi-tui` throws when a rendered line overflows).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { completePsych, registerPsychCommand } from "../src/slices/commands/index.js";
import { renderEffect } from "../src/slices/report/index.js";
import { LOCALES, stringsFor } from "../src/shared/i18n.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

function stateWith(over = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, model: "a/b", ...over };
  return state;
}

function outcome(over = {}) {
  return {
    id: over.id ?? "o1",
    kind: over.kind ?? "thin_slice",
    deliveredAtTurn: 0,
    channel: "card",
    before: { failureRate: 0.5, turnsSinceVerifiedProgress: 4, restatements: 3, aborts: 2 },
    text: "cut the change in half",
    ...over,
  };
}

test("/psych effect is a terminal leaf: no trailing space, so Tab confirms it", () => {
  const items = completePsych(stateWith(), "");
  const effect = items.find((item) => item.label === "effect");
  assert.ok(effect, "the subcommand is offered");
  assert.equal(effect.value, "effect", "a final choice must not append a space");
  assert.equal(effect.description, stringsFor("en").cmdEffect);
});

test("the effect handler is reached for the `effect` subcommand and renders nothing else", async () => {
  const pi = makePi();
  let effects = 0;
  registerPsychCommand(pi, stateWith(), {
    now: async () => "done",
    report: () => {},
    effect: () => {
      effects += 1;
    },
    save: () => "x",
    reload: () => {},
  });
  await pi.commands.get("psych").handler("effect", makeCtx());
  assert.equal(effects, 1);
});

test("the table lists each delivered kind with its verdict tallies", () => {
  const ledger = [
    outcome({ id: "a", kind: "thin_slice", followed: true, verdicts: { failureRate: "improved", turnsSinceVerifiedProgress: "unchanged", restatements: "unchanged", aborts: "worse" } }),
    outcome({ id: "b", kind: "reduce_load" }),
  ];
  const text = renderEffect({ ledger, lang: "en", width: 100 });
  assert.match(text, /INTERVENTION EFFECT/);
  assert.match(text, /cut it thinner/);
  assert.match(text, /verify before writing/);
  // The numeric row for thin_slice: one delivery, one improved metric, one worse.
  assert.match(text, /cut it thinner\s+1\s+1\s+2\s+1\s+1/);
});

test("an empty ledger says so instead of drawing an empty table", () => {
  const text = renderEffect({ ledger: [], lang: "en", width: 100 });
  assert.match(text, /nothing delivered yet this session/);
  const cs = renderEffect({ ledger: [], lang: "cs", width: 100 });
  assert.match(cs, /ÚČINEK ZÁSAHŮ/);
});

test("every line is clipped to the mocked width, however narrow", () => {
  const ledger = [
    outcome({ id: "a", kind: "name_next_win", verdicts: { failureRate: "improved", turnsSinceVerifiedProgress: "improved", restatements: "improved", aborts: "improved" } }),
    outcome({ id: "b", kind: "return_autonomy" }),
  ];
  for (const width of [20, 40, 60]) {
    const text = renderEffect({ ledger, lang: "en", width });
    for (const line of text.split("\n")) {
      assert.ok(visibleWidth(line) <= width, `width ${width} overflowed: "${line}"`);
    }
  }
});

test("the effect column headings exist in both locales", () => {
  for (const locale of LOCALES) {
    const columns = stringsFor(locale).effectColumns;
    for (const [key, value] of Object.entries(columns)) {
      assert.ok(value.trim().length > 0, `${locale}.effectColumns.${key} is empty`);
    }
    assert.ok(stringsFor(locale).effectTitle.trim().length > 0);
    assert.ok(stringsFor(locale).effectEmpty.trim().length > 0);
  }
});