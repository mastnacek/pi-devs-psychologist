/**
 * Width safety, swept (2026-09-29 audit against references/tui-and-components.md).
 *
 * `TUI.doRender` crashes the host when a component emits a line wider than the terminal, and a
 * width is counted in visible columns, so `.length` is wrong for the emoji and CJK the observer
 * actually renders. Per-card tests at one width cannot catch a layout branch; this sweeps every
 * card, both locales, and every width a terminal can plausibly be.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stringsFor } from "../src/shared/i18n.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { makeState } from "./fakes.js";
import { renderReport } from "../src/slices/report/index.js";
import { AppraisalView } from "../src/slices/overlay/appraisal-view.js";
import { AskView } from "../src/slices/overlay/ask-view.js";
import { ReviewView } from "../src/slices/overlay/review-view.js";
import { ScoutView } from "../src/slices/overlay/scout-view.js";

const LONG = "a".repeat(240);
const WIDE = "中文テスト ✅ 🙂🎉";
const CITE = [LONG, WIDE, "short"];
const PLAIN = { fg: (_c, t) => t, bold: (t) => t, bg: (_c, t) => t };
const SUGGESTION = [{ kind: "package", text: LONG, source: `https://example.com/${LONG}`, cited: CITE }];

const APPRAISAL = {
  needs: {
    autonomy: { state: "at_risk", cited: CITE },
    competence: { state: "unmet", cited: CITE },
    relatedness: { state: "unassessed", cited: [] },
  },
  load: { level: "high", cited: CITE },
  progress: { state: "unproven", cited: CITE },
  flow: { state: "broken", cited: CITE },
  interventions: [{ kind: "thin_slice", text: LONG + WIDE, cited: CITE }],
  suggestions: SUGGESTION,
};

const CARDS = {
  appraisal: { appraisal: APPRAISAL, unmatched: [LONG] },
  ask: { question: LONG, answer: LONG + WIDE, cited: CITE, suggestions: SUGGESTION, unsupported: true, noResearch: true },
  review: { finding: { verdict: "convention_mismatch", rule: LONG, file: LONG, text: LONG, cited: CITE }, head: LONG, lastHead: LONG, unmatched: [LONG], sameModel: true },
  scout: { topic: LONG, candidates: [{ name: LONG, installSpec: LONG, url: LONG, why: LONG, fit: "solves" }, { name: WIDE, installSpec: "npm:x", url: "https://x", why: LONG, fit: "partial" }], build: { title: LONG, oneLine: LONG }, ideaLine: `? ${LONG} @proj :tag:`, cited: CITE, nothingFound: false },
};
const CTOR = { appraisal: AppraisalView, ask: AskView, review: ReviewView, scout: ScoutView };
const WIDTHS = [20, 24, 30, 40, 60, 80, 100, 120, 200];

test("no card emits a line wider than the width it was given, in either locale", () => {
  let checked = 0;
  for (const locale of ["en", "cs"]) {
    for (const [name, input] of Object.entries(CARDS)) {
      for (const width of WIDTHS) {
        const lines = new CTOR[name](input, PLAIN, () => {}, { locale, maxHeight: 500 }).render(width);
        for (const [i, line] of lines.entries()) {
          checked += 1;
          assert.ok(
            visibleWidth(line) <= width,
            `${locale}/${name} at ${width}: line ${i} is ${visibleWidth(line)} cells`,
          );
        }
      }
    }
  }
  assert.ok(checked > 1000, "the sweep really covered the cards");
});

test("the string table renders without throwing in either locale", () => {
  for (const locale of ["en", "cs"]) assert.ok(stringsFor(locale).cmdReplay.length > 0);
});

test("no report line exceeds the width, on any of its four paths", () => {
  // The report goes out as a notification, not a TUI component, so nothing clips it for us. The main
  // path did clip; the two early returns (disabled, no model) did not, and those are the two lines an
  // operator meets first — "⚠ No psychologist model configured…" measured 76 cells at width 40.
  const state = makeState();
  state.lastAppraisal = APPRAISAL;
  state.lastAppraisalNotes = { unmatched: [LONG], downgraded: [] };
  let checked = 0;
  for (const config of [
    { ...DEFAULT_CONFIG, lang: "en" },                    // no model -> early return
    { ...DEFAULT_CONFIG, lang: "cs" },                    // the same path, in Czech
    { ...DEFAULT_CONFIG, lang: "en", model: "p/m" },      // the main path
    { ...DEFAULT_CONFIG, lang: "en", enabled: false },    // disabled -> early return
  ]) {
    state.config = config;
    for (const width of [20, 30, 40, 60, 80, 120]) {
      const text = renderReport({ state, signals: [LONG], history: [LONG], lang: config.lang, width, mapLines: [LONG] });
      for (const line of text.split("\n")) {
        checked += 1;
        assert.ok(visibleWidth(line) <= width, `${config.lang} @${width}: ${visibleWidth(line)} cells`);
      }
    }
  }
  assert.ok(checked > 200, "the sweep really covered all four paths");
});
