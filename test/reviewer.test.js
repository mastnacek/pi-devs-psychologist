/**
 * `reviewer` — the role's contract, enforcement, the slice and the delivery trigger (T32a). The card is
 * in `review-card.test.js`, the convention rules in `conventions.test.js`.
 *
 * The properties that carry the weight: the schema refuses an overreaching verdict; enforcement
 * drops a finding with no surviving citation and clears rule/file from an abstention; `enabled:
 * false` runs nothing; the trigger fires once per commit head and diffs the range since the last
 * review; and the slice holds
 * no file-mutation import and never sends a message to the working agent (ADR 0001 invariant 7).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Check } from "typebox/value";
import { REVIEW_SCHEMA } from "../src/shared/appraisal.js";
import { enforceReview, parseReview } from "../src/shared/appraisal-enforce.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { FRAME_LINES } from "../src/slices/overlay/layout.js";
import { reviewObserver, reviewCommandHandler } from "../src/slices/reviewer/index.js";
import { registerObserver } from "../src/slices/observer/index.js";
import { completePsych } from "../src/slices/commands/index.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

const LINE = "window: 3 prompt(s), 8 tool call(s), 21 min";
const PLAIN = { fg: (_c, t) => t, bold: (t) => t, bg: (_c, t) => t };

const GOOD = {
  verdict: "convention_mismatch",
  rule: "no barrel re-exports of slice internals",
  file: "src/slices/overlay/index.ts",
  text: "stop re-exporting the layout module from the slice barrel",
  cited: [LINE],
};

/** The injected slice seams: the model call, the card, the fallback and the git HEAD. */
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

function configWith(over = {}, reviewer = {}) {
  return {
    ...DEFAULT_CONFIG,
    model: "p/m",
    runtime: "agent",
    trigger: "cadence",
    cadenceTurns: 1,
    ...over,
    roles: { ...DEFAULT_CONFIG.roles, reviewer: { ...DEFAULT_CONFIG.roles.reviewer, ...reviewer } },
  };
}

/* --- the schema --- */

test("REVIEW_SCHEMA accepts a cited finding and an abstention, and rejects each overreach", () => {
  assert.ok(Check(REVIEW_SCHEMA, GOOD));
  assert.ok(
    Check(REVIEW_SCHEMA, {
      verdict: "insufficient_context",
      text: "no stated rule covers this",
      cited: [],
    }),
  );
  // A verdict outside the enum.
  assert.ok(!Check(REVIEW_SCHEMA, { verdict: "looks_off", text: "x" }));
  // More than four citations.
  assert.ok(!Check(REVIEW_SCHEMA, { ...GOOD, cited: [LINE, LINE, LINE, LINE, LINE] }));
  // A rule over 300 chars.
  assert.ok(!Check(REVIEW_SCHEMA, { ...GOOD, rule: "r".repeat(301) }));
  // A text over 300 chars.
  assert.ok(!Check(REVIEW_SCHEMA, { ...GOOD, text: "t".repeat(301) }));
});

/* --- enforcement --- */

test("an abstention keeps no rule and no file, even when the model supplied them", () => {
  const r = enforceReview(
    { verdict: "insufficient_context", rule: "stray rule", file: "stray.ts", text: "cannot tell from here", cited: [] },
    [LINE],
  );
  assert.equal(r.dropped, 0);
  assert.equal(r.finding.verdict, "insufficient_context");
  assert.equal(r.finding.rule, "", "the rule is cleared on an abstention");
  assert.equal(r.finding.file, "", "the file is cleared on an abstention");
  assert.equal(r.finding.text, "cannot tell from here");
});

test("no citation, no claim: a non-abstention finding with no surviving citation is dropped", () => {
  const none = enforceReview({ verdict: "convention_mismatch", rule: "r", file: "f.ts", text: "t", cited: [] }, [LINE]);
  assert.equal(none.finding, undefined);
  assert.equal(none.dropped, 1);

  const mismatch = enforceReview(
    { verdict: "unverified_claim", rule: "r", file: "f.ts", text: "t", cited: ["a line that was never supplied"] },
    [LINE],
  );
  assert.equal(mismatch.finding, undefined, "a citation matching nothing is not a citation");
  assert.equal(mismatch.dropped, 1);
  assert.ok(mismatch.unmatched.includes("a line that was never supplied"));
});

test("rule and file are required for every non-abstention finding", () => {
  assert.equal(enforceReview({ verdict: "intent_vs_artifact", rule: "r", file: "", text: "t", cited: [LINE] }, [LINE]).dropped, 1);
  assert.equal(enforceReview({ verdict: "intent_vs_artifact", rule: "", file: "f.ts", text: "t", cited: [LINE] }, [LINE]).dropped, 1);
  const ok = enforceReview({ verdict: "intent_vs_artifact", rule: "r", file: "f.ts", text: "t", cited: [LINE] }, [LINE]);
  assert.equal(ok.dropped, 0);
  assert.deepEqual(ok.finding.cited, [LINE]);
});

test("a citation with a leading list marker still matches, and an intentLine is verified too", () => {
  const r = enforceReview(
    { verdict: "intent_vs_artifact", rule: "r", file: "f.ts", text: "t", cited: [`- ${LINE}`], intentLine: LINE },
    [LINE],
  );
  assert.equal(r.dropped, 0);
  assert.deepEqual(r.finding.cited, [LINE], "the list marker is presentation, not content");
  assert.equal(r.finding.intentLine, LINE, "the intent line is kept in canonical form");

  const badIntent = enforceReview(
    { verdict: "intent_vs_artifact", rule: "r", file: "f.ts", text: "t", cited: [LINE], intentLine: "made up" },
    [LINE],
  );
  assert.equal(badIntent.finding.intentLine, undefined, "an unmatched intent line is dropped");
  assert.ok(badIntent.unmatched.includes("made up"));
});

test("junk is not JSON", () => {
  assert.equal(parseReview("no json here", [LINE]).ok, false);
});

/* --- the card --- */


test("enabled:false runs nothing, and the api runtime is refused", async () => {
  const off = makeState();
  off.config = configWith({}, { enabled: false });
  assert.equal((await reviewObserver(off, makeCtx(), makeDeps())).reason, "disabled");

  const api = makeState();
  api.config = configWith({ runtime: "api" }, { enabled: true });
  assert.equal((await reviewObserver(api, makeCtx(), makeDeps())).reason, "runtime");
});

test("a session outside git declines for free, and a spent budget refuses before any call", async () => {
  const noGit = makeState();
  noGit.config = configWith({}, { enabled: true });
  assert.equal((await reviewObserver(noGit, makeCtx(), makeDeps({ resolveHead: () => "" }))).reason, "no_git");

  const spent = makeState();
  spent.config = configWith({ maxAppraisalsPerSession: 1 }, { enabled: true });
  spent.appraisalsThisSession = 1;
  let called = 0;
  const outcome = await reviewObserver(spent, makeCtx(), makeDeps({ callModel: async () => { called += 1; throw new Error("must not run"); } }));
  assert.equal(outcome.reason, "budget");
  assert.equal(called, 0);
});

test("a second run while one is in flight is refused as busy", async () => {
  const state = makeState();
  state.config = configWith({}, { enabled: true });
  state.appraisalInFlight = true;
  assert.equal((await reviewObserver(state, makeCtx(), makeDeps())).reason, "in_flight");
});

test("the trigger fires once per head, not twice, and diffs the range since the last review", async () => {
  const state = makeState();
  state.config = configWith({}, { enabled: true });
  let head = "H2";
  const deps = makeDeps({ resolveHead: () => head });

  const first = await reviewObserver(state, makeCtx(), deps);
  assert.equal(first.ran, true);
  assert.equal(state.reviewedHead, "H2", "the head is recorded after the run");
  assert.equal(state.reviewLastHead, "H2");
  assert.equal(deps.requests[0].review.lastDeliveryHead, "", "the first review has no previous delivery");

  const second = await reviewObserver(state, makeCtx(), deps);
  assert.equal(second.reason, "already", "the same delivery is not reviewed twice");
  assert.equal(deps.requests.length, 1, "no second model call");

  // A new commit head reviews the range since the last review.
  head = "H3";
  const third = await reviewObserver(state, makeCtx(), deps);
  assert.equal(third.ran, true, "a new head is a new delivery");
  assert.equal(deps.requests.length, 2);
  assert.equal(deps.requests[1].review.lastDeliveryHead, "H2", "the range starts at the last review");
  assert.equal(deps.requests[1].review.head, "H3");
});

test("the once-per-delivery rule is ignored by an explicit /psych review, but never the budget", async () => {
  const state = makeState();
  state.config = configWith({}, { enabled: true });
  state.reviewedHead = "H2";
  const deps = makeDeps({ resolveHead: () => "H2" });
  const forced = await reviewObserver(state, makeCtx(), deps, { force: true });
  assert.equal(forced.ran, true, "the operator asked explicitly");
  assert.equal(deps.requests.length, 1);
});

test("the reviewer's own model overrides the shared one, empty means the shared model, and same-model is detected", async () => {
  const withOwn = makeState();
  withOwn.config = configWith({}, { enabled: true, model: "strong/model" });
  const ownDeps = makeDeps();
  await reviewObserver(withOwn, makeCtx(), ownDeps);
  assert.equal(ownDeps.requests[0].modelRefOverride, "strong/model", "the reviewer's own model is requested");

  const shared = makeState();
  shared.config = configWith({ model: "a/b" }, { enabled: true, model: "" });
  const sharedDeps = makeDeps();
  const ctx = makeCtx({ model: { provider: "a", id: "b" } });
  await reviewObserver(shared, ctx, sharedDeps);
  assert.equal(sharedDeps.requests[0].modelRefOverride, undefined, "empty model uses the shared one");
  assert.equal(sharedDeps.presented[0].sameModel, true, "and that is disclosed on the card");

  const other = makeState();
  other.config = configWith({ model: "a/b" }, { enabled: true, model: "c/d" });
  const otherDeps = makeDeps();
  await reviewObserver(other, makeCtx({ model: { provider: "a", id: "b" } }), otherDeps);
  assert.equal(otherDeps.presented[0].sameModel, false, "a different model is not disclosed");
});

test("the reviewer role reaches the child as role 'pair' and carries the delivery anchors", async () => {
  // A real convention file in a temp cwd: the parent reads the rules, so the citable lines exist.
  const cwd = mkdtempSync(join(tmpdir(), "psych-review-"));
  writeFileSync(join(cwd, "AGENTS.md"), "- Every new source file gets a test.\n- Never use raw control characters.\n", "utf8");
  const state = makeState();
  state.config = configWith({}, { enabled: true, model: "strong/model" });
  state.reviewLastHead = "H1";
  const deps = makeDeps({ resolveHead: () => "H2" });
  try {
  await reviewObserver(state, makeCtx({ cwd }), deps);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  const req = deps.requests[0];
  assert.equal(req.agentRole, "pair");
  assert.equal(req.modelRefOverride, "strong/model");
  assert.equal(req.review.lastDeliveryHead, "H1");
  assert.equal(req.review.head, "H2");
  assert.equal(req.review.maxDiffBytes, 200000);
  assert.deepEqual(req.review.conventionFiles, DEFAULT_CONFIG.roles.reviewer.conventionFiles);
  // The rules the parent read travel with the anchors, and they are the only citable lines.
  assert.ok(Array.isArray(req.review.conventionRules), "convention rules reach the child");
  assert.equal(typeof req.review.conventionRules[0], "string");
  for (const line of req.review.conventionRules) assert.match(line, /^\S+:\d+: .+/, "each rule is a located line");
});

test("a stop request lands on the running model call as an abort", async () => {
  const state = makeState();
  state.config = configWith({}, { enabled: true });
  const controller = new AbortController();
  controller.abort();
  const deps = makeDeps({
    callModel: async (_registry, req) => (req.signal?.aborted ? { ok: false, stage: "aborted", error: "the review was aborted" } : { ok: true, text: JSON.stringify(GOOD), provider: "p", modelId: "m", label: "p/m", usage: undefined }),
  });
  const outcome = await reviewObserver(state, makeCtx({ signal: controller.signal }), deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.stage, "aborted");
});

test("the /psych review command maps a skip to a status line and success to nothing", async () => {
  const off = makeState();
  off.config = configWith({}, { enabled: false });
  assert.equal(await reviewCommandHandler(off, makeDeps())(makeCtx()), stringsFor("en").reviewDisabled);

  const on = makeState();
  on.config = configWith({}, { enabled: true });
  assert.equal(await reviewCommandHandler(on, makeDeps())(makeCtx()), "", "the finding was shown as a card");
});

/* --- the delivery trigger wiring --- */

test("the observer reports a delivery boundary on a successful commit and on a /label bookmark", async () => {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG };
  const pi = makePi();
  const boundaries = [];
  registerObserver(pi, state, { onDeliveryBoundary: (_ctx, kind) => boundaries.push(kind) });
  const ctx = makeCtx();

  await pi.emit("tool_execution_start", { toolCallId: "c1", toolName: "bash", args: { command: "git commit -m x" } }, ctx);
  await pi.emit("tool_execution_end", { toolCallId: "c1", toolName: "bash", isError: false, result: {} }, ctx);
  assert.deepEqual(boundaries, ["commit"], "a successful commit is a delivery boundary");

  await pi.emit("input", { text: "/label checkpoint", source: "interactive" }, ctx);
  assert.deepEqual(boundaries, ["commit", "label"], "a /label bookmark is a boundary");

  // A failed commit and a non-delivery command are not boundaries.
  await pi.emit("tool_execution_start", { toolCallId: "c2", toolName: "bash", args: { command: "git commit" } }, ctx);
  await pi.emit("tool_execution_end", { toolCallId: "c2", toolName: "bash", isError: true, result: {} }, ctx);
  await pi.emit("tool_execution_start", { toolCallId: "c3", toolName: "bash", args: { command: "npm test" } }, ctx);
  await pi.emit("tool_execution_end", { toolCallId: "c3", toolName: "bash", isError: false, result: {} }, ctx);
  assert.deepEqual(boundaries, ["commit", "label"], "no extra boundaries");
});

/* --- the completion --- */

test("the `review` completion is a terminal leaf described from the table", () => {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG };
  const item = completePsych(state, "").find((i) => i.label === "review");
  assert.ok(item, "review is offered");
  assert.equal(item.value, "review", "terminal: no trailing space");
  assert.equal(item.description, stringsFor("en").cmdReview);
});

/* --- the slice holds no mutation and never speaks to the agent --- */

test("the reviewer slice has no file-mutation import and no message to the working agent", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "..", "src", "slices", "reviewer", "index.ts"), "utf8");
  assert.ok(!/node:fs/.test(source), "no filesystem access in the slice");
  assert.ok(!/registerTool/.test(source), "no tool registration in the slice");
  assert.ok(!/writeFile|appendFile|edit\(|write\(/.test(source), "nothing mutates a file");
  assert.ok(!/sendUserMessage|sendMessage/.test(source), "nothing is steered into the working agent");
});
