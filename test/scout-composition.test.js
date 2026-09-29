/**
 * `scout` — card geometry, the automatic trigger and the composition-root wiring (T31).
 *
 * Two promises the presenter makes and could not otherwise keep: `measureScoutCard` sizes the
 * overlay from the very lines the view draws, and every rendered line fits the width. The trigger
 * tests prove the appraiser runs the scout INSTEAD of an appraisal, once per fingerprint, only when
 * the role is enabled on the agent runtime. The integration test drives the REAL extension through
 * `/psych scout` with a FAKE process surface — never a real child pi — and proves the child runs as
 * the scout role and nothing is steered into the working agent.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { stringsFor } from "../src/shared/i18n.js";
import { FRAME_LINES } from "../src/slices/overlay/layout.js";
import { ScoutView } from "../src/slices/overlay/scout-view.js";
import { layoutScoutCard, measureScoutCard } from "../src/slices/overlay/scout-layout.js";
import { maybeAppraise } from "../src/slices/appraiser/index.js";
import devsPsychologistExtension from "../index.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

const PLAIN = { fg: (_c, t) => t, bold: (t) => t, bg: (_c, t) => t };
const LINE = "recurring failure: bash · npm test ×3";

function cardInput(over = {}) {
  return {
    topic: "bash: npm test",
    candidates: [
      {
        name: "pi-quick-win",
        installSpec: "npm:pi-quick-win",
        url: "https://pi.dev/packages/pi-quick-win",
        why: "names the smallest next win",
        fit: "solves",
      },
    ],
    build: undefined,
    ideaLine: undefined,
    cited: [LINE],
    nothingFound: false,
    ...over,
  };
}

/* --- card geometry --- */

test("measureScoutCard counts exactly the lines the view draws, and no line exceeds the width", () => {
  const input = cardInput({ ideaLine: "? pi-slice — cut it thinner @proj :scout:" });
  for (const locale of ["en", "cs"]) {
    const s = stringsFor(locale);
    const { head, tail } = layoutScoutCard(input, s, 76, PLAIN);
    const measured = measureScoutCard(input, s, 76);
    assert.equal(measured.head, head.length);
    assert.equal(measured.tail, tail.length);
    assert.equal(measured.total, FRAME_LINES + head.length + tail.length);
  }
  for (const theme of [PLAIN, makePi().ansi]) {
    for (const width of [40, 120]) {
      const lines = new ScoutView(input, theme, () => {}, { maxHeight: 200 }).render(width);
      for (const line of lines) {
        assert.ok(
          visibleWidth(line) <= width,
          `a ${visibleWidth(line)}-cell line in a ${width}-cell card: ${JSON.stringify(line)}`,
        );
      }
    }
  }
});

test("the card names candidate fit, install spec and url, and the SPAI line when there is a build", () => {
  const s = stringsFor("en");
  const withBuild = cardInput({ ideaLine: "? pi-slice — cut it thinner @proj :scout:" });
  const { head, tail } = layoutScoutCard(withBuild, s, 100, PLAIN);
  const headText = head.map((l) => l.text).join("\n");
  const tailText = tail.map((l) => l.text).join("\n");
  assert.ok(headText.includes("pi-quick-win"));
  assert.ok(headText.includes("npm:pi-quick-win"));
  assert.ok(headText.includes("https://pi.dev/packages/pi-quick-win"));
  assert.ok(tailText.includes("? pi-slice — cut it thinner @proj :scout:"), "the SPAI line is shown whole");
});

test("a nothing-found card says so, and a found card does not", () => {
  const s = stringsFor("en");
  const empty = layoutScoutCard(cardInput({ candidates: [], cited: [], nothingFound: true }), s, 76, PLAIN);
  assert.ok(empty.head.some((l) => l.text.includes(s.scoutNothingFound)));
  const found = layoutScoutCard(cardInput(), s, 76, PLAIN);
  assert.ok(!found.head.some((l) => l.text.includes(s.scoutNothingFound)));
});

/* --- the automatic trigger --- */

function scoutState(over = {}, rolesEnabled = true, runtime = "agent") {
  const state = makeState();
  state.config = {
    ...DEFAULT_CONFIG,
    model: "p/m",
    runtime,
    trigger: "signals",
    cadenceTurns: 1,
    ...over,
    roles: { scout: { ...DEFAULT_CONFIG.roles.scout, enabled: rolesEnabled } },
  };
  return state;
}

/** Three identical bash failures: one fingerprint at count 3. */
function seedRecurrence(state) {
  for (let i = 0; i < 3; i += 1) {
    state.observe({ kind: "tool", at: i, toolName: "bash", command: "npm test", ok: false, errorSignature: "E1" });
  }
  state.turnsSinceAppraisal = 1;
}

function triggerDeps() {
  const calls = [];
  const scouts = [];
  return {
    calls,
    scouts,
    readHistory: () => ({ evidence: [] }),
    callModel: async (_registry, req) => {
      calls.push(req);
      return { ok: true, text: JSON.stringify({ candidates: [], cited: [] }), provider: "p", modelId: "m", label: "p/m", usage: undefined };
    },
    deliver: async () => ({ human: "none", agent: false, reason: "silent" }),
    runScout: async (_ctx, topic) => {
      scouts.push(topic);
    },
  };
}

test("a recurring fingerprint at count 3 runs the scout instead of an appraisal", async () => {
  const state = scoutState();
  seedRecurrence(state);
  const deps = triggerDeps();
  const outcome = await maybeAppraise(makePi(), state, makeCtx(), deps);
  assert.equal(deps.scouts.length, 1, "the scout ran");
  assert.equal(deps.calls.length, 0, "no appraisal model call in the same turn");
  assert.equal(outcome.ran, false);
  assert.equal(outcome.reason, "scout");
  assert.equal(state.appraisalsThisSession, 1, "the scout consumed one budget unit");
});

test("the scout runs at most once per fingerprint per session", async () => {
  const state = scoutState();
  seedRecurrence(state);
  const deps = triggerDeps();
  await maybeAppraise(makePi(), state, makeCtx(), deps);
  state.turnsSinceAppraisal = 1;
  await maybeAppraise(makePi(), state, makeCtx(), deps);
  assert.equal(deps.scouts.length, 1, "the same fingerprint is not scouted twice");
});

test("without the role enabled the same friction runs the appraisal, not the scout", async () => {
  const state = scoutState({}, false);
  seedRecurrence(state);
  const deps = triggerDeps();
  await maybeAppraise(makePi(), state, makeCtx(), deps);
  assert.equal(deps.scouts.length, 0);
  assert.equal(deps.calls.length, 1, "the appraisal ran instead");
});

test("on the api runtime the scout never triggers, however much friction recurs", async () => {
  const state = scoutState({}, true, "api");
  seedRecurrence(state);
  const deps = triggerDeps();
  await maybeAppraise(makePi(), state, makeCtx(), deps);
  assert.equal(deps.scouts.length, 0);
  assert.equal(deps.calls.length, 1);
});

test("a spent budget refuses before the scout runs", async () => {
  const state = scoutState({ maxAppraisalsPerSession: 1 });
  seedRecurrence(state);
  state.appraisalsThisSession = 1;
  const deps = triggerDeps();
  const outcome = await maybeAppraise(makePi(), state, makeCtx(), deps);
  assert.equal(deps.scouts.length, 0);
  assert.equal(outcome.reason, "budget");
});

test("the session cost cap refuses before the scout runs", async () => {
  const state = scoutState();
  seedRecurrence(state);
  state.agentSessionCostUsd = 5;
  const deps = triggerDeps();
  const outcome = await maybeAppraise(makePi(), state, makeCtx(), deps);
  assert.equal(deps.scouts.length, 0);
  assert.equal(outcome.reason, "cost");
});

/* --- composition-root integration --- */

const HOME = mkdtempSync(join(tmpdir(), "psych-scout-home-"));
process.on("exit", () => rmSync(HOME, { recursive: true, force: true }));
let loadCount = 0;

function scriptedScoutChild() {
  const child = new EventEmitter();
  child.pid = 5151;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          type: "tool_execution_start",
          toolCallId: "c1",
          toolName: "psych_submit",
          args: { candidates: [], cited: [] },
        }) + "\n",
      ),
    );
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "tool_execution_end", toolCallId: "c1", toolName: "psych_submit", isError: false }) + "\n"),
    );
    child.emit("close", 0);
  });
  return child;
}

function fakeIo(children) {
  const queue = [...children];
  const record = { spawn: [], files: [] };
  return {
    record,
    io: {
      spawn: (command, args, opts) => {
        record.spawn.push({ command, args, env: opts?.env });
        const child = queue.shift();
        if (!child) throw new Error("no child queued");
        return child;
      },
      mkdir: () => {},
      writeFile: (path, data) => record.files.push({ path, data }),
      rm: () => {},
      killTree: () => {},
      now: () => Date.now(),
      setTimeout: () => 1,
      clearTimeout: () => {},
    },
  };
}

function load(agentIo) {
  const pi = makePi();
  loadCount += 1;
  const globalFile = join(HOME, `pi-devs-psychologist-${loadCount}.json`);
  devsPsychologistExtension(pi, { globalFile, ...(agentIo ? { agentIo } : {}) });
  return { pi, globalFile };
}

function writeConfig(globalFile, over = {}) {
  writeFileSync(
    globalFile,
    JSON.stringify({
      ...DEFAULT_CONFIG,
      model: "p/m",
      maxAppraisalsPerSession: 5,
      runtime: "agent",
      roles: { scout: { ...DEFAULT_CONFIG.roles.scout, enabled: true } },
      ...over,
    }),
    "utf8",
  );
}

function ctxFor(cwd) {
  return makeCtx({
    cwd,
    isProjectTrusted: () => true,
    sessionManager: { getEntries: () => [], getBranch: () => [], getSessionFile: () => join(cwd, "parent.jsonl") },
  });
}

test("the agent scout runs the child as role 'scout' and puts the topic in the message", async () => {
  const { io, record } = fakeIo([scriptedScoutChild()]);
  const { pi, globalFile } = load(io);
  const cwd = mkdtempSync(join(tmpdir(), "psych-scout-cwd-"));
  const sent = [];
  pi.sendUserMessage = (body) => sent.push(body);
  try {
    writeConfig(globalFile);
    const ctx = ctxFor(cwd);
    await pi.emit("session_start", { type: "session_start" }, ctx);
    await pi.commands.get("psych").handler("scout bash: npm test", ctx);

    assert.equal(record.spawn.length, 1, "exactly one child ran");
    assert.equal(record.spawn[0].env.PI_DEVS_PSYCH_ROLE, "scout", "the child runs as the scout role");
    const message = record.files.find((f) => f.path.endsWith("message.md"));
    assert.ok(message, "the message file was written");
    assert.ok(message.data.includes("TOPIC — bash: npm test"), "the topic is in the child's message");
    assert.ok(message.data.endsWith("Scout now. Submit with psych_submit."));
    assert.deepEqual(sent, [], "nothing was steered into the working agent");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});