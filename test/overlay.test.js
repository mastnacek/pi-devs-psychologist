/**
 * The appraisal card — geometry, and the width rule that a broken overlay violates.
 *
 * Two of these tests defend promises the presenter makes and could not otherwise keep:
 * `measureCard` is what sizes the overlay, so it must equal what the view actually draws; and
 * every rendered line must fit the width, because an overflowing line corrupts the whole frame.
 * The second is checked with a *painting* theme as well as a plain one, because the padding maths
 * runs on visible width and the ANSI escapes are invisible to it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FRAME_LINES, layoutCard, measureCard, windowHead } from "../src/slices/overlay/layout.js";
import { AppraisalView } from "../src/slices/overlay/appraisal-view.js";
import { neutralAppraisal, NEEDS } from "../src/shared/appraisal.js";
import { stringsFor } from "../src/shared/i18n.js";
import { makePi } from "./fakes.js";

/** Identity theme: text assertions need the characters, not the escapes. */
const PLAIN = { fg: (_c, t) => t, bold: (t) => t, bg: (_c, t) => t };

const LINE = "window: 3 prompt(s), 8 tool call(s), 21 min";
const LONG = "verified progress: none — no test, lint, typecheck or build succeeded in this window";

/** A full appraisal whose every verdict cites a real-looking line. */
function input(over = {}) {
  return {
    appraisal: {
      needs: {
        autonomy: { state: "at_risk", cited: [LINE] },
        competence: { state: "unmet", cited: [LINE] },
        relatedness: { state: "met", cited: [] },
      },
      load: { level: "high", cited: [LONG] },
      progress: { state: "blocked", cited: [LINE] },
      flow: { state: "broken", cited: [LINE] },
      interventions: [
        { kind: "name_next_win", text: "Name the smallest shippable increment.", cited: [LINE] },
      ],
      ...over,
    },
    unmatched: [],
  };
}

function view(cardInput, theme, options = {}) {
  const pi = makePi();
  void pi;
  return new AppraisalView(cardInput, theme, () => {}, options);
}

test("scrolling repaints, because pi-tui does not re-render on input", () => {
  // The skill requires requestRender() on every state change. Without it the card scrolls in
  // memory and never on screen, so PgDn looks like a dead key.
  const repaints = [];
  const s = stringsFor("en");
  const { head, tail } = layoutCard(input(), s, 60, { fg: (_c, t) => t, bold: (t) => t });
  const v = view(input(), PLAIN, {
    requestRender: () => repaints.push(1),
    // A window smaller than the head, so scrolling is actually possible.
    maxHeight: FRAME_LINES + tail.length + 2,
  });
  assert.ok(head.length > 2, "the head must be longer than the window for this to mean anything");

  v.handleInput("[6~"); // PgDn
  assert.equal(repaints.length, 1, "PgDn asked for a repaint");

  v.handleInput("[B"); // Down
  assert.equal(repaints.length, 2, "Down asked for a repaint");

  // A move that cannot change anything must NOT repaint: nothing happened, so nothing is stale.
  v.render(60);
  // Walk up until a press stops repainting: that press found the top. (Comparing against a
  // fixed baseline loops forever — the repaint count only ever grows.)
  let before;
  do {
    before = repaints.length;
    v.handleInput("[A");
  } while (repaints.length > before);
  const atTop = repaints.length;
  v.handleInput("[A"); // already at 0
  assert.equal(repaints.length, atTop, "a no-op move does not repaint");

  // Closing still works and takes no repaint.
  v.handleInput("");
  assert.equal(repaints.length, atTop, "closing is not a repaint");
});

test("a card whose every verdict is uncited does not claim a normal outcome", () => {
  // The screenshot that prompted this: every field read "not assessed", the load and flow "not
  // assessed", and the card said "Nothing to act on. That is a normal outcome." — a clean bill of
  // health the model never gave. No citation anywhere means no verdict was reached.
  const unjudged = neutralAppraisal();
  const rendered = view({ appraisal: unjudged, unmatched: [] }, PLAIN).render(76).join("\n");
  assert.match(rendered, /cited nothing, so no verdict was reached/);
  assert.doesNotMatch(rendered, /normal outcome/, "the calm line must not be reused here");

  // But a card that DID reach verdicts keeps the calm line.
  const judged = { ...neutralAppraisal(), progress: { state: "unproven", cited: [LINE] } };
  const other = view({ appraisal: judged, unmatched: [] }, PLAIN).render(76).join("\n");
  assert.match(other, /normal outcome/);
  assert.doesNotMatch(other, /cited nothing/);
});

test("measureCard counts exactly the lines the view will draw", () => {
  // The presenter sizes the overlay from this. If it disagrees, content is clipped.
  for (const locale of ["en", "cs"]) {
    for (const width of [40, 56, 76, 120]) {
      const s = stringsFor(locale);
      const { head, tail } = layoutCard(input(), s, width, { fg: (_c, t) => t, bold: (t) => t });
      const measured = measureCard(input(), s, width);
      assert.equal(measured.head, head.length, `${locale}@${width} head`);
      assert.equal(measured.tail, tail.length, `${locale}@${width} tail`);
      assert.equal(measured.total, FRAME_LINES + head.length + tail.length);
    }
  }
});

test("every rendered line fits the width, even when the theme paints", () => {
  for (const theme of [makePi().plain, makePi().ansi]) {
    for (const width of [40, 52, 76, 100]) {
      const lines = view(input(), theme, { maxHeight: 12 }).render(width);
      for (const line of lines) {
        assert.ok(
          visibleWidth(line) <= width,
          `a ${visibleWidth(line)}-cell line in a ${width}-cell card: ${JSON.stringify(line)}`,
        );
      }
    }
  }
});

test("the intervention is never clipped, even when the verdicts must scroll", () => {
  // The one thing the card exists to deliver must survive a short terminal.
  const lines = view(input(), makePi().plain, { maxHeight: 10 }).render(60);
  const text = lines.join("\n");
  assert.match(text, /Name the smallest shippable increment/, "the intervention survived a 10-row window");
  assert.match(text, /name the next win/, "and so did its kind");
  // The head is what got scrolled, and the card says so.
  assert.match(text, /PgUp\/PgDn/, "the scroll hint appears when there is something hidden");
});

test("a short card does not advertise scrolling it cannot do", () => {
  const lines = view(input(), makePi().plain, { maxHeight: 60 }).render(76);
  assert.ok(!lines.join("\n").includes("PgUp/PgDn"), "no scroll hint when everything fits");
});

test("neutral verdicts still render, so 'nothing to say' differs from 'did not look'", () => {
  const blank = { appraisal: neutralAppraisal(), unmatched: [] };
  const text = view(blank, makePi().plain, { maxHeight: 60 }).render(76).join("\n");
  for (const locale of ["en"]) {
    const s = stringsFor(locale);
    assert.match(text, new RegExp(s.labels.needStates.unassessed), "an unassessed need is shown as unassessed");
  }
  assert.match(text, /not assessed/);
  // Fully neutral = nothing cited anywhere, so the card must say no verdict was reached rather
  // than the calm "nothing to act on" line (see the uncited-card test below).
  assert.match(text, /cited nothing, so no verdict was reached/, "and the absence of a verdict is stated, not implied");
});

test("unsupported claims are surfaced, not hidden", () => {
  const withUnmatched = { appraisal: input().appraisal, unmatched: ["i made this up", "and this"] };
  const text = view(withUnmatched, makePi().plain, { maxHeight: 60 }).render(76).join("\n");
  assert.match(text, /2 unsupported claim\(s\) dropped/);
  const clean = view(input(), makePi().plain, { maxHeight: 60 }).render(76).join("\n");
  assert.ok(!clean.includes("unsupported"), "and absent when there were none");
});

test("the card names the build that rendered it", () => {
  const text = view(input(), makePi().plain, { maxHeight: 60 }).render(76).join("\n");
  assert.match(text, /v\d+\.\d+\.\d+/, "a stale runtime must be visible, not debatable");
});

test("both locales paint the same geometry, with different words", () => {
  const en = view(input(), makePi().plain, { locale: "en", maxHeight: 60 }).render(76);
  const cs = view(input(), makePi().plain, { locale: "cs", maxHeight: 60 }).render(76);
  assert.equal(en.length, cs.length, "the layout is locale-independent; only the labels differ");
  assert.notDeepEqual(en, cs);
  assert.match(cs.join("\n"), /VÝVOJÁŘSKÝ PSYCHOLOG/);
});

test("an unknown locale falls back to English instead of rendering nothing", () => {
  const lines = view(input(), makePi().plain, { locale: "klingon", maxHeight: 60 }).render(76);
  assert.match(lines.join("\n"), /DEVELOPER PSYCHOLOGIST/);
});

test("windowHead clamps a stale scroll offset instead of hiding content", () => {
  const head = Array.from({ length: 20 }, (_, i) => ({ text: `line ${i}` }));
  const paint = { fg: (_c, t) => t, bold: (t) => t };
  const view5 = windowHead(head, 5, 999, paint);
  assert.equal(view5.hiddenBelow, 0, "scrolling past the end lands on the end");
  assert.equal(view5.hiddenAbove, head.length - (5 - 1));
  const negative = windowHead(head, 5, -10, paint);
  assert.equal(negative.hiddenAbove, 0, "and scrolling above the start lands on the start");
});

test("windowHead spends one row on the hint only when something is hidden", () => {
  const paint = { fg: (_c, t) => t, bold: (t) => t };
  const short = windowHead([{ text: "a" }], 5, 0, paint);
  assert.equal(short.lines.length, 1);
  const long = windowHead([{ text: "a" }, { text: "b" }, { text: "c" }], 2, 0, paint);
  assert.equal(long.lines.length, 2, "one hint row plus one content row");
  assert.match(long.lines[0].text, /↓/);
});

test("keys that close are exactly the keys the footer advertises", () => {
  // A shortcut the card does not show is a hidden affordance, and an unlisted close key is a trap.
  const v = view(input(), makePi().plain, { maxHeight: 60 });
  const footer = v.render(76).at(-2);
  assert.match(footer, /esc/, "the footer names the close key");
  let closed = 0;
  const v2 = new AppraisalView(input(), makePi().plain, () => {
    closed += 1;
  }, { maxHeight: 60 });
  for (const key of ["\u001b", "\r", "\u0003"]) {
    v2.handleInput(key);
  }
  assert.equal(closed, 3, "escape, enter and ctrl+c all close");
  void footer;
});

test("a verdict row reads as a field name and a value, never a state word twice", () => {
  // What running the card for real caught that 179 tests did not: the row labels were being
  // taken from the STATE tables, so the card rendered `advancing blocked`, `high high` and
  // `in flow broken`. Every test asserted that the values appeared; none asserted that the row
  // reads. This one does, and it fails on a repeated word.
  const s = stringsFor("en");
  const text = view(input(), makePi().plain, { maxHeight: 80 }).render(76).join("\n");
  for (const field of [s.fields.progress, s.fields.load, s.fields.flow]) {
    assert.ok(text.includes(field), `the row for ${field} must name the field`);
  }
  // No row may put the same word in both columns.
  for (const line of text.split("\n")) {
    const words = line.trim().split(/\s+/);
    const label = words[1];
    const value = words[words.length - 1];
    if (label === undefined || value === undefined) continue;
    if (["Progress", "Load", "Flow"].includes(label)) {
      assert.notEqual(label.toLowerCase(), value.toLowerCase(), "row reads '" + line.trim() + "'");
    }
  }
});

test("every need in the contract appears on the card", () => {
  const text = view(input(), makePi().plain, { maxHeight: 60 }).render(76).join("\n");
  const s = stringsFor("en");
  for (const need of NEEDS) {
    assert.ok(text.includes(s.labels.needs[need]), `missing ${need}`);
  }
});
