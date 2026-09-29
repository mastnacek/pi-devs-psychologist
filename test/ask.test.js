/**
 * `/psych ask <question>` — the schema, the brief and the run policy (T30).
 *
 * The properties that carry the weight: the final schema refuses a hallucination (too long an
 * answer, too many citations, a bad suggestion kind), the brief places the question without touching
 * the evidence prefix (D2), the run consumes budget and shares single-flight with appraisals, and
 * nothing the ask produces ever reaches the working agent's context. The card geometry and the
 * composition-root wiring live in `ask-composition.test.js`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import { ASK_SCHEMA } from "../src/shared/appraisal.js";
import { enforceAsk, parseAsk } from "../src/shared/appraisal-enforce.js";
import { ASK_FINAL_LINE, buildAgentBrief } from "../src/shared/agent-brief.js";
import { JSON_ONLY_FINAL_LINE, buildUserText } from "../src/shared/prompt.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { askObserver } from "../src/slices/ask/index.js";
import { completePsych, registerPsychCommand } from "../src/slices/commands/index.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

const LINE = "window: 3 prompt(s), 8 tool call(s), 21 min";

function configWith(over = {}, agentOver = {}) {
  return {
    ...DEFAULT_CONFIG,
    model: "p/m",
    runtime: "agent",
    trigger: "cadence",
    cadenceTurns: 1,
    ...over,
    agent: { ...DEFAULT_CONFIG.agent, ...agentOver },
  };
}

/* --- the schema --- */

test("ASK_SCHEMA accepts the documented answer and rejects each way of overreaching", () => {
  assert.ok(Check(ASK_SCHEMA, { answer: "try a smaller slice", cited: [LINE] }));
  assert.ok(
    Check(ASK_SCHEMA, {
      answer: "see the docs",
      cited: [],
      suggestions: [{ kind: "doc", text: "read extensions.md", source: "extensions.md" }],
    }),
  );
  // Too long an answer.
  assert.ok(!Check(ASK_SCHEMA, { answer: "x".repeat(801), cited: [] }));
  // More than four citations.
  assert.ok(!Check(ASK_SCHEMA, { answer: "a", cited: [LINE, LINE, LINE, LINE, LINE] }));
  // A suggestion kind outside the enum.
  assert.ok(
    !Check(ASK_SCHEMA, {
      answer: "a",
      cited: [],
      suggestions: [{ kind: "bogus", text: "t", source: "https://x" }],
    }),
  );
  // More than three suggestions.
  const one = { kind: "doc", text: "t", source: "https://x" };
  assert.ok(!Check(ASK_SCHEMA, { answer: "a", cited: [], suggestions: [one, one, one, one] }));
});

test("an answer with no matching citation is kept and marked unsupported, never hidden", () => {
  const enforced = enforceAsk({ answer: "I think so.", cited: ["made up line"] }, [LINE]);
  assert.equal(enforced.answer, "I think so.", "the text survives enforcement");
  assert.deepEqual(enforced.cited, []);
  assert.equal(enforced.unsupported, true, "and the doubt is a flag, not a deletion");

  const supported = enforceAsk({ answer: "yes", cited: [LINE] }, [LINE]);
  assert.deepEqual(supported.cited, [LINE]);
  assert.equal(supported.unsupported, false);
});

test("an empty answer is a parse failure; junk is not JSON", () => {
  assert.equal(parseAsk("no json here", [LINE]).ok, false);
  assert.equal(parseAsk(JSON.stringify({ answer: "  ", cited: [] }), [LINE]).ok, false);
  assert.equal(parseAsk(JSON.stringify({ answer: "yes", cited: [LINE] }), [LINE]).ok, true);
});

/* --- the brief --- */

function brief(over = {}) {
  return {
    role: "ask",
    piVersion: "0.87.1",
    docsDir: undefined,
    liveLines: ["turn 1: tool ok"],
    sessionLines: ["session declared purpose: ship T30"],
    limits: { maxToolCalls: 25, allowWeb: true, allowMcp: true, allowNlm: true },
    nlmNotebooks: [],
    question: "Why am I stuck?",
    ...over,
  };
}

test("the ask brief carries the question block, its own final line, and byte-identical evidence", () => {
  const input = brief();
  const { userMessage, systemAppend } = buildAgentBrief(input);
  const base = buildUserText(input.liveLines, input.sessionLines);
  const evidence = base.slice(0, base.length - JSON_ONLY_FINAL_LINE.length);
  assert.equal(userMessage.slice(0, evidence.length), evidence, "evidence prefix byte-identical");
  assert.ok(userMessage.includes("QUESTION — Why am I stuck?"), "the question block is present");
  assert.ok(userMessage.endsWith(ASK_FINAL_LINE), "the ask final line");
  assert.ok(!userMessage.includes(JSON_ONLY_FINAL_LINE), "the appraisal line is gone");
  assert.ok(userMessage.indexOf("QUESTION — ") > evidence.length - 1);
  assert.ok(userMessage.indexOf("QUESTION — ") < userMessage.indexOf(ASK_FINAL_LINE));
  // The role paragraph is the ask contract, not the psychologist prompt.
  assert.ok(systemAppend.includes("`ask` role"));
  assert.ok(systemAppend.includes("cannot tell from the evidence"));
  assert.ok(systemAppend.includes("at most 800 characters"));
  assert.ok(!systemAppend.includes("You are the engineering psychologist observing"));
});

test("the psychologist brief is unchanged: no question block, the appraisal final line", () => {
  const { userMessage } = buildAgentBrief(brief({ role: "psychologist", question: undefined }));
  assert.ok(userMessage.endsWith("Appraise the session now. Submit with psych_submit."));
  assert.ok(!userMessage.includes("QUESTION — "));
});

/* --- the run --- */

function makeDeps(over = {}) {
  const presented = [];
  const notes = [];
  return {
    presented,
    notes,
    readHistory: () => ({ evidence: [] }),
    callModel: async () => ({
      ok: true,
      text: JSON.stringify({ answer: "Because the evidence is thin.", cited: [] }),
      provider: "p",
      modelId: "m",
      label: "p/m",
      usage: undefined,
    }),
    present: async (_ctx, input) => {
      presented.push(input);
      return true;
    },
    notify: (_ctx, text) => notes.push(text),
    ...over,
  };
}

test("a successful ask consumes one budget unit and shows the card", async () => {
  const state = makeState();
  state.config = configWith();
  const deps = makeDeps();
  assert.equal(state.appraisalsThisSession, 0);
  const outcome = await askObserver(state, makeCtx(), deps, "Why am I stuck?");

  assert.equal(outcome.ran, true);
  assert.equal(outcome.ok, true);
  assert.equal(state.appraisalsThisSession, 1, "the budget was consumed");
  assert.equal(deps.presented.length, 1);
  assert.equal(deps.presented[0].question, "Why am I stuck?");
  assert.equal(deps.presented[0].answer, "Because the evidence is thin.");
});

test("a second ask while one is in flight is refused as busy", async () => {
  const state = makeState();
  state.config = configWith();
  state.appraisalInFlight = true;
  const outcome = await askObserver(state, makeCtx(), makeDeps(), "hello?");
  assert.equal(outcome.ran, false);
  assert.equal(outcome.reason, "in_flight");
  const other = makeState();
  other.config = configWith();
  other.appraisalPromise = Promise.resolve({ ran: false, reason: "cadence" });
  assert.equal((await askObserver(other, makeCtx(), makeDeps(), "hi")).reason, "in_flight");
});

test("a spent budget refuses the ask before any model call", async () => {
  const state = makeState();
  state.config = configWith({ maxAppraisalsPerSession: 1 });
  state.appraisalsThisSession = 1;
  let called = 0;
  const outcome = await askObserver(
    state,
    makeCtx(),
    makeDeps({ callModel: async () => { called += 1; throw new Error("must not run"); } }),
    "hi",
  );
  assert.equal(outcome.reason, "budget");
  assert.equal(called, 0);
});

test("the api runtime answers without tools and the card says so; its research sources are dropped", async () => {
  const state = makeState();
  state.config = configWith({ runtime: "api" }, { nlmNotebooks: ["nb-1"] });
  const deps = makeDeps({
    callModel: async () => ({
      ok: true,
      text: JSON.stringify({
        answer: "From the evidence alone.",
        cited: [LINE],
        suggestions: [{ kind: "research", text: "a notebook", source: "nlm:nb-1" }],
      }),
      provider: "p",
      modelId: "m",
      label: "p/m",
      usage: undefined,
    }),
    sourcePolicy: () => ({ nlmNotebooks: ["nb-1"] }),
  });
  const outcome = await askObserver(state, makeCtx(), deps, "is there a plugin?");
  assert.equal(outcome.ok, true);
  assert.equal(deps.presented[0].noResearch, true, "the API card states there was no research");
  assert.deepEqual(deps.presented[0].suggestions, [], "a research source is refused on the API runtime");
});

test("the agent runtime card does not claim 'no research'", async () => {
  const state = makeState();
  state.config = configWith();
  const deps = makeDeps();
  await askObserver(state, makeCtx(), deps, "q");
  assert.equal(deps.presented[0].noResearch, false);
});

test("nothing reaches the working agent: the ask slice has no steer and never sends a message", async () => {
  const state = makeState();
  state.config = configWith({ steerAgent: true });
  const pi = makePi();
  const sent = [];
  pi.sendUserMessage = (body) => sent.push(body);
  await askObserver(state, makeCtx(), makeDeps(), "q");
  assert.deepEqual(sent, [], "a direct question is never written into the agent's context");
});

/* --- the command --- */

test("the `ask` completion is non-terminal, labelled and described from the table", () => {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG };
  const items = completePsych(state, "");
  const ask = items.find((item) => item.label === "ask");
  assert.ok(ask, "ask is offered");
  assert.equal(ask.value, "ask ", "non-terminal: trailing space so Tab offers the question");
  assert.equal(ask.description, stringsFor("en").cmdAsk);
  assert.equal(completePsych(state, "ask")[0].value, "ask ");
  assert.equal(completePsych(state, "ask "), null, "free text: no further items, no file noise");
  assert.equal(completePsych(state, "ask why am I stuck"), null);
});

test("an empty question is a usage notice, and the ask is never invoked", async () => {
  const state = makeState();
  let asked = 0;
  const pi = makePi();
  registerPsychCommand(pi, state, {
    now: async () => "done",
    stop: () => "nothing",
    report: () => {},
    effect: () => {},
    ask: async (_ctx, question) => {
      asked += 1;
      return question;
    },
    save: () => "x",
    reload: () => {},
  });
  const ctx = makeCtx();
  await pi.commands.get("psych").handler("ask", ctx);
  assert.equal(asked, 0, "no question, no run");
  assert.deepEqual(ctx.notes, [{ message: stringsFor("en").usage, level: "warning" }]);

  await pi.commands.get("psych").handler("ask why am I stuck", ctx);
  assert.equal(asked, 1, "a real question runs");
});
