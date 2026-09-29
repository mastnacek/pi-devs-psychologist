/**
 * The reviewer card (T32a): what it draws, and that `measureReviewCard` counts exactly the lines
 * the view renders, so the overlay is never clipped. Split from `reviewer.test.js` by concept — the
 * schema, enforcement, trigger and slice contract live there; this file is the presentation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stringsFor } from "../src/shared/i18n.js";
import { FRAME_LINES } from "../src/slices/overlay/layout.js";
import { ReviewView } from "../src/slices/overlay/review-view.js";
import { layoutReviewCard, measureReviewCard } from "../src/slices/overlay/review-layout.js";
import { makePi } from "./fakes.js";

const LINE = "window: 3 prompt(s), 8 tool call(s), 21 min";
const PLAIN = { fg: (_c, t) => t, bold: (t) => t, bg: (_c, t) => t };

const GOOD = {
  verdict: "convention_mismatch",
  rule: "no barrel re-exports of slice internals",
  file: "src/slices/overlay/index.ts",
  text: "stop re-exporting the layout module from the slice barrel",
  cited: [LINE],
};

function cardInput(over = {}) {
  return {
    finding: { ...GOOD, cited: [LINE] },
    head: "abcdef1234567890",
    lastHead: "",
    unmatched: [],
    sameModel: false,
    ...over,
  };
}


test("measureReviewCard counts exactly the lines the view draws, and no line exceeds the width", () => {
  const cases = [
    cardInput(),
    cardInput({ finding: { verdict: "insufficient_context", rule: "", file: "", text: "no stated rule decides this", cited: [] } }),
    cardInput({ finding: undefined, unmatched: ["made up"] }),
    cardInput({ sameModel: true, lastHead: "1234567890abcdef", unmatched: ["x"] }),
  ];
  for (const input of cases) {
    for (const locale of ["en", "cs"]) {
      const s = stringsFor(locale);
      const { head, tail } = layoutReviewCard(input, s, 76, PLAIN);
      const measured = measureReviewCard(input, s, 76);
      assert.equal(measured.head, head.length);
      assert.equal(measured.tail, tail.length);
      assert.equal(measured.total, FRAME_LINES + head.length + tail.length);
    }
    for (const theme of [PLAIN, makePi().ansi]) {
      for (const width of [40, 120]) {
        const lines = new ReviewView(input, theme, () => {}, { maxHeight: 200 }).render(width);
        for (const line of lines) {
          assert.ok(
            visibleWidth(line) <= width,
            `a ${visibleWidth(line)}-cell line in a ${width}-cell card: ${JSON.stringify(line)}`,
          );
        }
      }
    }
  }
});

test("an insufficiency is one line, a finding shows its rule and citation, and the same model is disclosed", () => {
  const s = stringsFor("en");
  const declined = layoutReviewCard(
    cardInput({ finding: { verdict: "insufficient_context", rule: "", file: "", text: "cannot tell" } }),
    s,
    76,
    PLAIN,
  ).head.map((l) => l.text).join("\n");
  assert.ok(declined.includes(s.reviewDeclined));
  assert.ok(declined.includes("cannot tell"));

  const finding = layoutReviewCard(cardInput(), s, 76, PLAIN).head.map((l) => l.text).join("\n");
  assert.ok(finding.includes(s.labels.reviewVerdicts.convention_mismatch));
  assert.ok(finding.includes(GOOD.file));
  assert.ok(finding.includes(GOOD.rule));
  assert.ok(finding.includes(LINE), "the citation is shown");
  assert.ok(!finding.includes(s.reviewSameModel));

  const same = layoutReviewCard(cardInput({ sameModel: true }), s, 76, PLAIN).head.map((l) => l.text).join("\n");
  assert.ok(same.includes(s.reviewSameModel), "the same-model caveat is disclosed");
});

/* --- the slice --- */

function makeDeps(over = {}) {
  const presented = [];
  const notes = [];
  const requests = [];
  return {
    presented,
    notes,
    requests,
    readHistory: () => ({ evidence: [LINE] }),
    callModel: async (_registry, req) => {
      requests.push(req);
      return { ok: true, text: JSON.stringify(GOOD), provider: "p", modelId: "m", label: "p/m", usage: undefined };
    },
    present: async (_ctx, input) => {
      presented.push(input);
      return true;
    },
    notify: (_ctx, text) => notes.push(text),
    resolveHead: () => "H2",
    ...over,
  };
}
