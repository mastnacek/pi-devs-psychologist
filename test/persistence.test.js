/**
 * Persistence (T7 minimal + T16 restore) — the appraisal and the outcome ledger survive `/reload`.
 *
 * Both are stored as TUI-only `custom` entries and rebuilt from `getEntries()` on session start.
 * The load-bearing invariant tested here is that restoring contributes ZERO observations: an
 * appraisal re-observed as a session event would corrupt every prompt-counting signal, and a
 * `message`-type entry would be folded into the model's context instead of hidden from it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { maybeAppraise } from "../src/slices/appraiser/index.js";
import { renderReport } from "../src/slices/report/index.js";
import { neutralAppraisal } from "../src/shared/appraisal.js";
import { restoreOutcomes } from "../src/shared/outcome.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { restoreAppraisal } from "../src/shared/state.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

const WINDOW_LINE = "window: 0 prompt(s), 0 tool call(s), 0 min";
const SESSION_LINE = "session span: 3 min";

function storedAppraisal() {
  const appraisal = neutralAppraisal();
  appraisal.progress = { state: "blocked", cited: [WINDOW_LINE] };
  appraisal.interventions = [{ kind: "thin_slice", text: "Cut it in half.", cited: [WINDOW_LINE] }];
  return appraisal;
}

test("the last appraisal is restored from a custom entry after a reload", () => {
  const state = makeState();
  const entries = [
    { type: "message", message: { role: "user", content: "hi" } },
    { type: "custom", customType: "psych-appraisal", data: storedAppraisal() },
  ];
  restoreAppraisal(state, entries);
  assert.equal(state.lastAppraisal.progress.state, "blocked");
  assert.equal(state.lastAppraisal.interventions[0].kind, "thin_slice");
});

test("a restored appraisal contributes zero observations, so no signal is corrupted", () => {
  const state = makeState();
  const before = state.observations.length;
  restoreAppraisal(state, [{ type: "custom", customType: "psych-appraisal", data: storedAppraisal() }]);
  assert.equal(state.observations.length, before, "restoring a judgement is not a session event");
});

test("/psych shows the restored appraisal, so a reload does not blank the report", () => {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, model: "a/b" };
  restoreAppraisal(state, [{ type: "custom", customType: "psych-appraisal", data: storedAppraisal() }]);
  const text = renderReport({ state, signals: [], history: [], lang: "en" });
  assert.match(text, /cut it in half/i);
  assert.match(text, /Progress: blocked/);
});

test("a completed appraisal is appended as a custom entry, never as a message", async () => {
  const pi = makePi();
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, model: "p/m", trigger: "cadence", cadenceTurns: 1 };
  state.turnsSinceAppraisal = 1;
  const deps = {
    readHistory: () => ({ evidence: [SESSION_LINE], abortedTurns: 0 }),
    callModel: async () => ({
      ok: true,
      text: JSON.stringify({
        needs: {
          autonomy: { state: "at_risk", cited: [WINDOW_LINE] },
          competence: { state: "unmet", cited: [WINDOW_LINE] },
          relatedness: { state: "met", cited: [SESSION_LINE] },
        },
        load: { level: "high", cited: [WINDOW_LINE] },
        progress: { state: "blocked", cited: [WINDOW_LINE] },
        flow: { state: "broken", cited: [WINDOW_LINE] },
        interventions: [{ kind: "thin_slice", text: "Cut it in half.", cited: [WINDOW_LINE] }],
      }),
      provider: "p",
      modelId: "m",
      label: "p/m",
      usage: undefined,
    }),
    deliver: async () => ({ human: "card", agent: false }),
  };
  await maybeAppraise(pi, state, makeCtx(), deps);

  const appraisalEntry = pi.entries.find((entry) => entry.customType === "psych-appraisal");
  const outcomeEntry = pi.entries.find((entry) => entry.customType === "psych-outcome");
  assert.ok(appraisalEntry, "the appraisal is persisted");
  assert.ok(outcomeEntry, "the delivered intervention opens a ledger record");
  for (const entry of [appraisalEntry, outcomeEntry]) {
    assert.equal(entry.type, "custom", "a custom entry is hidden from model context");
    assert.notEqual(entry.type, "message");
  }
  assert.equal(outcomeEntry.data.kind, "thin_slice");
  assert.equal(outcomeEntry.data.channel, "card");
  assert.equal(typeof outcomeEntry.data.closedCardMs, "number", "the card's open duration was measured");
});

test("the ledger is rebuilt from custom entries after a simulated reload", () => {
  const initial = {
    id: "o1",
    kind: "thin_slice",
    deliveredAtTurn: 3,
    channel: "card",
    before: { failureRate: 0.5, turnsSinceVerifiedProgress: 4, restatements: 3, aborts: 2 },
    text: "Cut it in half.",
  };
  const followUp = {
    id: "o1",
    verdicts: { failureRate: "improved", turnsSinceVerifiedProgress: "unchanged", restatements: "unchanged", aborts: "unchanged" },
  };
  const ledger = restoreOutcomes([
    { type: "custom", customType: "psych-outcome", data: initial },
    { type: "custom", customType: "psych-outcome", data: followUp },
  ]);
  assert.equal(ledger.length, 1, "the follow-up merged into the record it belongs to");
  assert.equal(ledger[0].verdicts.failureRate, "improved");
});