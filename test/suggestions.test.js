/**
 * Researched suggestions (T25) — enforced sources, operator-only delivery.
 *
 * The load-bearing rule: a suggestion is the one place research is allowed, so its `source` must
 * resolve to something that exists (a URL, a pi docs file, a consented notebook, an install spec).
 * Everything else is dropped and counted, the same way an uncited verdict is. The second rule is a
 * boundary: suggestions never reach the working agent, and only one reaches a notification.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { Check } from "typebox/value";
import {
  APPRAISAL_SCHEMA,
  SUGGESTION_KINDS,
  neutralAppraisal,
} from "../src/shared/appraisal.js";
import { enforceEvidence, parseAppraisal } from "../src/shared/appraisal-enforce.js";
import { FRAME_LINES, layoutCard, measureCard } from "../src/slices/overlay/layout.js";
import { AppraisalView } from "../src/slices/overlay/appraisal-view.js";
import { deliverIntervention } from "../src/slices/interventions/index.js";
import { registerSubmitTool } from "../src/slices/child/submit.js";
import { stringsFor } from "../src/shared/i18n.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

const PLAIN = { fg: (_c, t) => t, bold: (t) => t, bg: (_c, t) => t };

const LINE = "window: 3 prompt(s), 8 tool call(s), 21 min";
const EVIDENCE = [LINE, "verified progress: none — no test, lint, typecheck or build succeeded"];

const DOCS_DIR = resolve(process.cwd(), "test-engine-docs");
const POLICY = { docsDir: DOCS_DIR, nlmNotebooks: ["nb-a"] };

function rawSuggestion(over = {}) {
  return { kind: "package", text: "Try pi-lens for this.", source: "npm:pi-lens", ...over };
}

function withSuggestions(suggestions) {
  return { suggestions };
}

function kept(appraisal) {
  return appraisal.suggestions;
}

// --- Schema ---------------------------------------------------------------------------------

test("the schema accepts an appraisal with and without suggestions", () => {
  assert.equal(Check(APPRAISAL_SCHEMA, neutralAppraisal()), true, "the bare neutral value is valid");

  const withOne = neutralAppraisal();
  withOne.suggestions = [rawSuggestion({ cited: [] })];
  assert.equal(Check(APPRAISAL_SCHEMA, withOne), true);

  const without = neutralAppraisal();
  delete without.suggestions;
  assert.equal(Check(APPRAISAL_SCHEMA, without), true, "absent stays valid");
});

test("the schema caps suggestions at three and names the kinds", () => {
  const tooMany = neutralAppraisal();
  tooMany.suggestions = Array.from({ length: 4 }, () => rawSuggestion({ cited: [] }));
  assert.equal(Check(APPRAISAL_SCHEMA, tooMany), false, "a fourth suggestion is refused");

  const badKind = neutralAppraisal();
  badKind.suggestions = [rawSuggestion({ kind: "mood", cited: [] })];
  assert.equal(Check(APPRAISAL_SCHEMA, badKind), false, "a kind outside the enum is refused");

  // The enum reaches the JSON schema through StringEnum, not anyOf/const.
  const kinds = SUGGESTION_KINDS;
  const found = JSON.stringify(APPRAISAL_SCHEMA).includes(JSON.stringify(kinds));
  assert.equal(found, true);
});

// --- Enforcement: sources that survive ------------------------------------------------------

test("every allowed source form is accepted", () => {
  const accepted = [
    "https://pi.dev/packages/pi-lens",
    join(DOCS_DIR, "extensions.md"),
    "extensions.md",
    "docs/extensions.md",
    "nlm:nb-a",
    "npm:pi-lens",
    "git:github.com/mastnacek/pi-lens",
  ];
  const { appraisal, unmatched } = enforceEvidence(
    withSuggestions(accepted.map((source) => rawSuggestion({ source }))),
    EVIDENCE,
    POLICY,
  );
  assert.equal(kept(appraisal).length, 3, "only the first three are kept");
  assert.deepEqual(
    kept(appraisal).map((s) => s.source),
    accepted.slice(0, 3),
    "the accepted forms are the surviving ones",
  );
  assert.deepEqual(unmatched, [], "a real source is not a fabrication");
});

test("each rejected source form is dropped and counted", () => {
  const rejected = [
    "http://pi.dev/packages/pi-lens", // not https
    "just some text", // bare text
    "../secrets.md", // escape out of the docs dir
    join(resolve(process.cwd()), "elsewhere.md"), // absolute, but outside the docs dir
    "nlm:nb-unknown", // a notebook the operator never allowed
    "npm:", // malformed install spec
    "git:github.com/onlyowner", // malformed git spec
  ];
  for (const source of rejected) {
    const { appraisal, unmatched } = enforceEvidence(withSuggestions([rawSuggestion({ source })]), EVIDENCE, POLICY);
    assert.deepEqual(kept(appraisal), [], `accepted a bad source: ${source}`);
    assert.deepEqual(unmatched, [`suggestion: ${source}`], `not counted: ${source}`);
  }
});

test("without a docs dir, a path source is refused too", () => {
  const { appraisal } = enforceEvidence(withSuggestions([rawSuggestion({ source: "extensions.md" })]), EVIDENCE, {
    nlmNotebooks: [],
  });
  assert.deepEqual(kept(appraisal), [], "a path needs a resolved docs directory");
});

// --- Enforcement: text and citation hygiene -------------------------------------------------

test("text over 200 chars is truncated, and the suggestion survives", () => {
  const long = "x".repeat(250);
  const { appraisal } = enforceEvidence(withSuggestions([rawSuggestion({ text: long })]), EVIDENCE, POLICY);
  assert.equal(kept(appraisal)[0].text.length, 200);
});

test("unmatched cited lines are dropped, the suggestion survives with the rest", () => {
  const { appraisal, unmatched } = enforceEvidence(
    withSuggestions([rawSuggestion({ cited: [EVIDENCE[0], "i made this up"] })]),
    EVIDENCE,
    POLICY,
  );
  assert.deepEqual(kept(appraisal)[0].cited, [EVIDENCE[0]], "the real line is kept, canonicalised");
  assert.deepEqual(unmatched, ["i made this up"]);
});

test("parseAppraisal carries suggestions through end to end", () => {
  const text = JSON.stringify(withSuggestions([rawSuggestion({ cited: [] })]));
  const result = parseAppraisal(text, EVIDENCE, POLICY);
  assert.equal(result.ok, true);
  assert.equal(result.appraisal.suggestions.length, 1);
  assert.equal(result.appraisal.suggestions[0].kind, "package");
});

// --- Card -----------------------------------------------------------------------------------

function cardInput(suggestions) {
  const appraisal = neutralAppraisal();
  appraisal.progress = { state: "blocked", cited: [LINE] };
  appraisal.interventions = [{ kind: "thin_slice", text: "Cut it thinner.", cited: [LINE] }];
  appraisal.suggestions = suggestions;
  return { appraisal, unmatched: [] };
}

test("the card shows suggestions with their source, and measureCard matches", () => {
  const suggestions = [
    { kind: "package", text: "Try pi-lens for this rework loop.", source: "npm:pi-lens", cited: [] },
    { kind: "doc", text: "Read the extensions guide.", source: "docs/extensions.md", cited: [] },
  ];
  for (const locale of ["en", "cs"]) {
    const s = stringsFor(locale);
    for (const width of [40, 120]) {
      const input = cardInput(suggestions);
      const { head, tail } = layoutCard(input, s, width, PLAIN);
      const measured = measureCard(input, s, width);
      assert.equal(measured.head, head.length, `${locale}@${width} head`);
      assert.equal(measured.tail, tail.length, `${locale}@${width} tail`);
      assert.equal(measured.total, FRAME_LINES + head.length + tail.length);

      const rendered = new AppraisalView(input, PLAIN, () => {}, { locale, maxHeight: 60 }).render(width);
      for (const line of rendered) {
        assert.ok(visibleWidth(line) <= width, `${locale}@${width}: ${JSON.stringify(line)}`);
      }
      // The frame draws the measured body plus one footer row.
      assert.equal(rendered.length, measured.total + 1, `${locale}@${width} rendered height`);
      assert.match(rendered.join("\n"), /pi-lens/, "the source is shown");
    }
  }
});

test("a card without suggestions omits the section entirely", () => {
  const withSection = new AppraisalView(cardInput([rawSuggestion()]), PLAIN, () => {}, { maxHeight: 60 }).render(76);
  const without = new AppraisalView(cardInput([]), PLAIN, () => {}, { maxHeight: 60 }).render(76);
  assert.match(withSection.join("\n"), /Researched suggestions/);
  assert.doesNotMatch(without.join("\n"), /Researched suggestions/);
});

// --- Delivery: operator only ----------------------------------------------------------------

function stateWith(over = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, model: "a/b", ...over };
  return state;
}

function appraisalForDelivery() {
  const appraisal = neutralAppraisal();
  appraisal.progress = { state: "blocked", cited: [LINE] };
  appraisal.interventions = [{ kind: "name_next_win", text: "Name the smallest increment.", cited: [LINE] }];
  appraisal.suggestions = [
    { kind: "package", text: "Try pi-lens.", source: "npm:pi-lens", cited: [] },
    { kind: "doc", text: "Read json.md.", source: "docs/json.md", cited: [] },
  ];
  return appraisal;
}

test("the notification fallback carries at most one suggestion", async () => {
  const seen = { notify: [], steer: [] };
  const deps = {
    present: async () => false,
    notify: (_ctx, text) => seen.notify.push(text),
    steer: (_pi, _ctx, text) => seen.steer.push(text),
  };
  const outcome = await deliverIntervention(makePi(), stateWith(), makeCtx(), appraisalForDelivery(), deps);
  assert.equal(outcome.human, "notification");
  assert.equal(seen.notify.length, 1);
  assert.match(seen.notify[0], /pi-lens/, "one suggestion is included");
  assert.doesNotMatch(seen.notify[0], /json\.md/, "the rest wait for the card");
});

test("steering never sends a suggestion, source or text, even when steerAgent is on", async () => {
  const seen = { notify: [], steer: [] };
  const deps = {
    present: async () => true,
    notify: (_ctx, text) => seen.notify.push(text),
    steer: (_pi, _ctx, text) => seen.steer.push(text),
  };
  await deliverIntervention(makePi(), stateWith({ steerAgent: true }), makeCtx(), appraisalForDelivery(), deps);
  assert.equal(seen.steer.length, 1, "the intervention is steered");
  assert.match(seen.steer[0], /smallest increment/);
  assert.doesNotMatch(seen.steer.join("\n"), /pi-lens|json\.md/, "no suggestion text or source leaks to the agent");
});

test("a non-calling default steer sends no suggestion either", async () => {
  // The real steer helper is what production uses; assert on the body it would send.
  const { defaultInterventionDeps } = await import("../src/slices/interventions/index.js");
  const sent = [];
  const deps = defaultInterventionDeps(async () => true);
  deps.steer({ sendUserMessage: (body) => sent.push(body) }, makeCtx({ isIdle: () => true }), "Name the smallest increment.");
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0], /pi-lens/);
});

// --- psych_submit ---------------------------------------------------------------------------

test("psych_submit accepts a valid appraisal that carries suggestions", async () => {
  const pi = makePi();
  const state = { submitted: false, failures: 0 };
  registerSubmitTool(pi, "psychologist", state);
  const def = pi.tools.get("psych_submit");

  const params = {
    needs: {
      autonomy: { state: "met", cited: [] },
      competence: { state: "at_risk", cited: [] },
      relatedness: { state: "unassessed", cited: [] },
    },
    load: { level: "moderate", cited: [] },
    progress: { state: "advanced", cited: [] },
    flow: { state: "in_flow", cited: [] },
    interventions: [],
    suggestions: [rawSuggestion({ cited: [] })],
  };
  const result = await def.execute("call-1", params, undefined, undefined, makeCtx());
  assert.equal(result.content[0].text, "Submitted. Stop now.");
  assert.equal(result.terminate, true);
  assert.equal(state.submitted, true);
});

test("suggestions alone earn a card, and nothing is steered", async () => {
  // A researched suggestion costs a tool-using run; holding it back because no intervention
  // happened to appear would throw that spend away.
  const seen = { present: 0, steer: [] };
  const deps = {
    present: async () => {
      seen.present += 1;
      return true;
    },
    notify: () => {},
    steer: (_pi, _ctx, text) => seen.steer.push(text),
  };
  const appraisal = neutralAppraisal();
  appraisal.suggestions = [{ kind: "package", text: "Try pi-lens.", source: "npm:pi-lens", cited: [] }];
  const outcome = await deliverIntervention(makePi(), stateWith({ steerAgent: true }), makeCtx(), appraisal, deps);
  assert.equal(outcome.human, "card");
  assert.equal(seen.present, 1);
  assert.equal(seen.steer.length, 0, "no intervention, so nothing reaches the agent");
});

test("no intervention and no suggestions is still silence", async () => {
  const deps = { present: async () => true, notify: () => {}, steer: () => {} };
  const outcome = await deliverIntervention(makePi(), stateWith(), makeCtx(), neutralAppraisal(), deps);
  assert.equal(outcome.human, "none");
});
