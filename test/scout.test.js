/**
 * `/psych scout` — the schema, enforcement, the SPAI line, the brief and the command (T31).
 *
 * The properties that carry the weight: the schema refuses an overreaching answer, enforcement drops
 * a candidate that names a non-existent install spec / a non-https url / an unknown fit rather than
 * showing it, the SPAI line has the exact SPAI shape and project name, the brief places the topic
 * without touching the evidence prefix (D2) and mentions the workshop only when one is configured,
 * and the command runs (or refuses) with the reason named.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import { SCOUT_SCHEMA } from "../src/shared/appraisal.js";
import { enforceScout, parseScout } from "../src/shared/scout-enforce.js";
import { scoutIdeaLine, topRecurringTopic, projectName } from "../src/shared/scout.js";
import { SCOUT_FINAL_LINE, buildAgentBrief } from "../src/shared/agent-brief.js";
import { JSON_ONLY_FINAL_LINE, buildUserText } from "../src/shared/prompt.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { scoutCommandHandler, scoutObserver } from "../src/slices/scout/index.js";
import { completePsych, registerPsychCommand } from "../src/slices/commands/index.js";
import { makeCtx, makePi, makeState, sessionFixture } from "./fakes.js";

const LINE = "recurring failure: bash · npm test ×3";

function configWith(over = {}, roles = {}) {
  return {
    ...DEFAULT_CONFIG,
    model: "p/m",
    runtime: "agent",
    trigger: "cadence",
    cadenceTurns: 1,
    ...over,
    roles: { scout: { ...DEFAULT_CONFIG.roles.scout, ...roles } },
  };
}

const GOOD = {
  name: "pi-quick-win",
  installSpec: "npm:pi-quick-win",
  url: "https://pi.dev/packages/pi-quick-win",
  why: "names the smallest next win, exactly the friction here",
  fit: "solves",
};

/* --- the schema --- */

test("SCOUT_SCHEMA accepts the documented answer and rejects each way of overreaching", () => {
  assert.ok(Check(SCOUT_SCHEMA, { candidates: [GOOD], cited: [LINE] }));
  assert.ok(Check(SCOUT_SCHEMA, { candidates: [], cited: [] }));
  assert.ok(
    Check(SCOUT_SCHEMA, {
      candidates: [],
      build: { title: "pi-foo", oneLine: "does the thing" },
      cited: [],
    }),
  );
  // A fit outside the enum.
  assert.ok(!Check(SCOUT_SCHEMA, { candidates: [{ ...GOOD, fit: "perfect" }], cited: [] }));
  // A `why` over 160 chars.
  assert.ok(!Check(SCOUT_SCHEMA, { candidates: [{ ...GOOD, why: "x".repeat(161) }], cited: [] }));
  // More than four citations.
  assert.ok(!Check(SCOUT_SCHEMA, { candidates: [], cited: [LINE, LINE, LINE, LINE, LINE] }));
  // More than three candidates.
  assert.ok(!Check(SCOUT_SCHEMA, { candidates: [GOOD, GOOD, GOOD, GOOD], cited: [] }));
  // A build title over 80 chars.
  assert.ok(!Check(SCOUT_SCHEMA, { candidates: [], build: { title: "x".repeat(81), oneLine: "y" }, cited: [] }));
});

/* --- enforcement --- */

test("a candidate with a bad install spec, a non-https url or an unknown fit is dropped and counted", () => {
  const raw = {
    candidates: [
      GOOD,
      { ...GOOD, name: "bad-spec", installSpec: "https://example.com/pkg" },
      { ...GOOD, name: "bad-url", url: "http://example.com" },
      { ...GOOD, name: "bad-fit", fit: "perfect" },
    ],
    cited: [LINE],
  };
  const enforced = enforceScout(raw, [LINE], "pi-devs-psychologist");
  assert.deepEqual(enforced.candidates.map((c) => c.name), ["pi-quick-win"], "only the clean one survives");
  assert.equal(enforced.dropped, 3, "each rejected candidate is counted");
  assert.deepEqual(enforced.cited, [LINE]);
  assert.equal(enforced.nothingFound, false);
});

test("a git install spec and an npm spec both pass; anything else does not", () => {
  assert.equal(enforceScout({ candidates: [{ ...GOOD, installSpec: "git:github.com/owner/repo" }], cited: [] }, [], "p").candidates.length, 1);
  assert.equal(enforceScout({ candidates: [{ ...GOOD, installSpec: "pnpm:foo" }], cited: [] }, [], "p").dropped, 1);
});

test("citations that match no evidence line are unmatched, and an empty answer is nothing found", () => {
  const enforced = enforceScout({ candidates: [], cited: ["made up"] }, [LINE], "p");
  assert.deepEqual(enforced.unmatched, ["made up"]);
  assert.deepEqual(enforced.cited, []);
  assert.equal(enforced.nothingFound, true, "no candidate and no build is the honest 'nothing found'");
});

test("a build alone is kept and yields the SPAI line; junk is not JSON", () => {
  const enforced = enforceScout(
    { candidates: [], build: { title: "pi-slice", oneLine: "cuts a change thinner" }, cited: [] },
    [],
    "myproj",
  );
  assert.equal(enforced.ideaLine, "? pi-slice — cuts a change thinner @myproj :scout:");
  assert.equal(enforced.nothingFound, false, "a build is an answer");
  assert.equal(parseScout("no json here", [], "p").ok, false);
});

/* --- the SPAI line and project name --- */

test("the SPAI line carries the title, the one-liner, the project folder and a lowercase tag", () => {
  const line = scoutIdeaLine({ title: "pi-foo", oneLine: "does a thing" }, "my-project");
  assert.equal(line, "? pi-foo — does a thing @my-project :scout:");
  assert.ok(line.includes(":scout:"), "the tag is lowercase SPAI syntax");
});

test("projectName is the folder that holds the git root, or the cwd when there is none", () => {
  // A cwd that cannot contain a git root all the way up is unusual; here the repo itself is a git
  // checkout, so the name is the plugin folder.
  assert.equal(projectName(process.cwd()), "pi-devs-psychologist");
});

test("topRecurringTopic picks the highest count at or above the floor, else nothing", () => {
  const prints = [
    { toolName: "bash", signature: "npm test", count: 2 },
    { toolName: "edit", signature: "src/x.ts", count: 5 },
  ];
  assert.deepEqual(topRecurringTopic(prints, 3), { topic: "edit: src/x.ts", key: "edit src/x.ts" });
  assert.equal(topRecurringTopic(prints, 6), undefined, "nothing reaches the floor");
});

/* --- the brief --- */

function brief(over = {}) {
  return {
    role: "scout",
    piVersion: "0.87.1",
    docsDir: undefined,
    liveLines: ["turn 1: tool ok"],
    sessionLines: [LINE],
    limits: { maxToolCalls: 25, allowWeb: true, allowMcp: true, allowNlm: true },
    nlmNotebooks: [],
    topic: "bash: npm test",
    ...over,
  };
}

test("the scout brief carries the TOPIC block, its own final line, and byte-identical evidence", () => {
  const input = brief({ workshopDir: "D:\\workshop" });
  const { userMessage, systemAppend } = buildAgentBrief(input);
  const base = buildUserText(input.liveLines, input.sessionLines);
  const evidence = base.slice(0, base.length - JSON_ONLY_FINAL_LINE.length);
  assert.equal(userMessage.slice(0, evidence.length), evidence, "evidence prefix byte-identical");
  assert.ok(userMessage.includes("TOPIC — bash: npm test"), "the topic block is present");
  assert.ok(userMessage.endsWith(SCOUT_FINAL_LINE), "the scout final line");
  assert.ok(!userMessage.includes(JSON_ONLY_FINAL_LINE), "the appraisal line is gone");
  assert.ok(userMessage.indexOf("TOPIC — ") < userMessage.indexOf(SCOUT_FINAL_LINE));
  // The role paragraph is the scout contract.
  assert.ok(systemAppend.includes("`scout` role"));
  assert.ok(systemAppend.includes("pi list"));
  assert.ok(systemAppend.includes("https://pi.dev/packages?name=<terms>"));
});

test("the workshop sentence appears only when a workshop dir is configured", () => {
  const withDir = buildAgentBrief(brief({ workshopDir: "D:\\workshop" })).systemAppend;
  assert.ok(withDir.includes("D:\\workshop"), "the configured path is named");
  assert.ok(withDir.includes("NEVER edit"));
  const empty = buildAgentBrief(brief({ workshopDir: "" })).systemAppend;
  assert.ok(!empty.includes("NEVER edit"), "empty omits the whole sentence");
  const missing = buildAgentBrief(brief({ workshopDir: undefined })).systemAppend;
  assert.ok(!missing.includes("NEVER edit"), "absent is the same as empty");
});

test("the psychologist brief is unchanged: no topic block, the appraisal final line", () => {
  const { userMessage } = buildAgentBrief(brief({ role: "psychologist", topic: undefined }));
  assert.ok(userMessage.endsWith("Appraise the session now. Submit with psych_submit."));
  assert.ok(!userMessage.includes("TOPIC — "));
});

/* --- the run --- */

function makeDeps(over = {}) {
  const presented = [];
  const notes = [];
  return {
    presented,
    notes,
    readHistory: () => ({ evidence: [LINE] }),
    callModel: async () => ({
      ok: true,
      text: JSON.stringify({ candidates: [GOOD], cited: [LINE] }),
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

test("a successful scout consumes one budget unit and shows the card", async () => {
  const state = makeState();
  state.config = configWith({}, { enabled: true });
  const deps = makeDeps();
  assert.equal(state.appraisalsThisSession, 0);
  const outcome = await scoutObserver(state, makeCtx(), deps, "bash: npm test");

  assert.equal(outcome.ran, true);
  assert.equal(outcome.ok, true);
  assert.equal(state.appraisalsThisSession, 1, "the budget was consumed");
  assert.equal(deps.presented.length, 1);
  assert.equal(deps.presented[0].topic, "bash: npm test");
  assert.equal(deps.presented[0].candidates[0].name, "pi-quick-win");
});

test("the scout refuses on the api runtime and behind its consent gate", async () => {
  const api = makeState();
  api.config = configWith({ runtime: "api" }, { enabled: true });
  assert.equal((await scoutObserver(api, makeCtx(), makeDeps(), "t")).reason, "runtime");

  const off = makeState();
  off.config = configWith({}, { enabled: false });
  assert.equal((await scoutObserver(off, makeCtx(), makeDeps(), "t")).reason, "disabled");
});

test("a second scout while one is in flight is refused as busy", async () => {
  const state = makeState();
  state.config = configWith({}, { enabled: true });
  state.appraisalInFlight = true;
  const outcome = await scoutObserver(state, makeCtx(), makeDeps(), "t");
  assert.equal(outcome.reason, "in_flight");
});

test("a spent budget refuses the scout before any model call", async () => {
  const state = makeState();
  state.config = configWith({ maxAppraisalsPerSession: 1 }, { enabled: true });
  state.appraisalsThisSession = 1;
  let called = 0;
  const outcome = await scoutObserver(
    state,
    makeCtx(),
    makeDeps({ callModel: async () => { called += 1; throw new Error("must not run"); } }),
    "t",
  );
  assert.equal(outcome.reason, "budget");
  assert.equal(called, 0);
});

test("nothing reaches the working agent: the scout slice has no steer and never sends a message", async () => {
  const state = makeState();
  state.config = configWith({ steerAgent: true }, { enabled: true });
  const pi = makePi();
  const sent = [];
  pi.sendUserMessage = (body) => sent.push(body);
  await scoutObserver(state, makeCtx(), makeDeps(), "t");
  assert.deepEqual(sent, [], "the scout is never written into the agent's context");
});

test("an automatic scout stays silent when nothing is found, an operator run says so", async () => {
  const empty = { ok: true, text: JSON.stringify({ candidates: [], cited: [] }), provider: "p", modelId: "m", label: "p/m", usage: undefined };
  const auto = makeDeps({ callModel: async () => empty, present: async () => false });
  const stateA = makeState();
  stateA.config = configWith({}, { enabled: true });
  await scoutObserver(stateA, makeCtx(), auto, "t", { fromTrigger: true });
  assert.deepEqual(auto.notes, [], "silent when the operator did not ask");

  const manual = makeDeps({ callModel: async () => empty, present: async () => false });
  const stateB = makeState();
  stateB.config = configWith({}, { enabled: true });
  await scoutObserver(stateB, makeCtx(), manual, "t");
  assert.deepEqual(manual.notes, [stringsFor("en").scoutNothingFound], "shown when the operator asked");
});

/* --- the command --- */

test("the `scout` completion is non-terminal, labelled and described from the table", () => {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG };
  const items = completePsych(state, "");
  const scout = items.find((item) => item.label === "scout");
  assert.ok(scout, "scout is offered");
  assert.equal(scout.value, "scout ", "non-terminal: trailing space so Tab offers the topic");
  assert.equal(scout.description, stringsFor("en").cmdScout);
  assert.equal(completePsych(state, "scout")[0].value, "scout ");
  assert.equal(completePsych(state, "scout "), null, "free text: no further items, no file noise");
});

test("the scout command runs with the given topic and derives one when none is given", async () => {
  const seen = [];
  const state = makeState();
  const pi = makePi();
  registerPsychCommand(pi, state, {
    now: async () => "done",
    stop: () => "nothing",
    report: () => {},
    effect: () => {},
    ask: async () => "",
    scout: async (_ctx, topic) => {
      seen.push(topic);
      return "";
    },
    save: () => "x",
    reload: () => {},
  });
  const ctx = makeCtx();
  await pi.commands.get("psych").handler("scout bash: npm test", ctx);
  assert.deepEqual(seen, ["bash: npm test"], "an explicit topic is used verbatim");
});

test("the real scout handler derives the topic from the top fingerprint, or answers with usage", async () => {
  const deps = makeDeps();
  const handler = scoutCommandHandler(makeState(), deps);

  // No topic and no fingerprint: the answer is the usage line, not a silent no-op.
  const bare = makeState();
  bare.config = configWith({}, { enabled: true });
  const usageState = makeState();
  usageState.config = configWith({}, { enabled: true });
  const bareLine = await scoutCommandHandler(usageState, deps)(makeCtx(), "");
  assert.equal(bareLine, stringsFor("en").usage);

  // A recurring fingerprint supplies the topic when none is typed.
  const derived = makeState();
  derived.config = configWith({}, { enabled: true });
  derived.observations = sessionFixture();
  const line = await scoutCommandHandler(derived, makeDeps())(makeCtx(), "");
  assert.equal(line, "", "the derived topic ran the scout");
  void handler;
  void bare;
});