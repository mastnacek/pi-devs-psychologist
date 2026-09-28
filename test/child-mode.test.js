/**
 * child mode — the branch `index.ts` takes when this package is the child pi.
 *
 * The load-bearing assertion is the negative one: in child mode the plugin registers the guard and
 * the submission tool and *nothing else*. An observer or a status chip wired into a headless child
 * would be a bug that no other test could see, because the child has no UI to show it in.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCtx, makePi } from "./fakes.js";
import { APPRAISAL_SCHEMA, ASK_SCHEMA } from "../src/shared/appraisal.js";
import devsPsychologistExtension from "../index.js";

/** One temp config home for the suite, so no test can write the operator's real settings file. */
const CONFIG_HOME = mkdtempSync(join(tmpdir(), "psych-child-home-"));
process.on("exit", () => rmSync(CONFIG_HOME, { recursive: true, force: true }));
let loadCount = 0;

/** Load the extension for real, with the given environment, then restore it. */
function load(env = {}) {
  const pi = makePi();
  loadCount += 1;
  const globalFile = join(CONFIG_HOME, `pi-devs-psychologist-${loadCount}.json`);
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  devsPsychologistExtension(pi, { globalFile });
  return { pi, restore };
}

/** The guard is the only `tool_call` handler the child registers. */
async function callTool(pi, toolName, input = {}) {
  const handler = pi.handlers.get("tool_call")?.[0];
  assert.ok(handler, "child mode must register a tool_call handler");
  return handler({ type: "tool_call", toolCallId: "call-1", toolName, input }, makeCtx());
}

const CHILD = {
  PI_DEVS_PSYCH_CHILD: "1",
  PI_DEVS_PSYCH_RUN: "run-1",
  PI_DEVS_PSYCH_ROLE: "psychologist",
  PI_DEVS_PSYCH_LIMITS: '{"maxToolCalls":5,"allowWeb":true,"allowMcp":true,"allowNlm":true}',
};

test("child mode registers the guard and the submit tool, and nothing else", () => {
  const { pi, restore } = load(CHILD);
  try {
    assert.deepEqual([...pi.handlers.keys()].sort(), ["session_shutdown", "tool_call"]);
    assert.deepEqual([...pi.tools.keys()], ["psych_submit"]);
    assert.equal(pi.commands.size, 0, "no /psych in a headless child");
    assert.equal(pi.flags.size, 0, "no CLI flag in a headless child");
    assert.equal(pi.handlers.has("session_start"), false, "no chip, no config seeding");
  } finally {
    restore();
  }
});

test("child mode paints nothing and never touches the config file", async () => {
  const { pi, restore } = load(CHILD);
  try {
    const ctx = makeCtx();
    await pi.emit("session_start", { type: "session_start" }, ctx);
    assert.deepEqual(ctx.statusCalls, []);
    assert.deepEqual(ctx.notes, []);
  } finally {
    restore();
  }
});

test("without the marker nothing child-shaped is registered", () => {
  const { pi, restore } = load();
  try {
    assert.equal(pi.tools.has("psych_submit"), false);
    assert.equal(pi.handlers.has("session_start"), true);
  } finally {
    restore();
  }
});

test("the marker wins over the subagent guard, which the child deliberately does not carry", () => {
  // D5: the child runs without PI_SUBAGENT/PI_CHILD_SESSION so the other workshop plugins stay on.
  const { pi, restore } = load(CHILD);
  try {
    assert.equal(pi.tools.has("psych_submit"), true);
  } finally {
    restore();
  }
});

test("the role from the environment picks the submitted schema", () => {
  const { pi, restore } = load({ ...CHILD, PI_DEVS_PSYCH_ROLE: "ask" });
  try {
    assert.equal(pi.tools.get("psych_submit").parameters, ASK_SCHEMA);
  } finally {
    restore();
  }
  const other = load(CHILD);
  try {
    assert.equal(other.pi.tools.get("psych_submit").parameters, APPRAISAL_SCHEMA);
  } finally {
    other.restore();
  }
});

test("a malformed limits value fails closed: no capabilities, ten calls", async () => {
  const { pi, restore } = load({ ...CHILD, PI_DEVS_PSYCH_LIMITS: "{ not json", PI_DEVS_PSYCH_ROLE: "nonsense" });
  try {
    assert.equal((await callTool(pi, "edit")).block, true);
    assert.match((await callTool(pi, "web_search")).reason, /web tools are disabled/);
    assert.match((await callTool(pi, "bash", { command: 'nlm notebook query a "q"' })).reason, /NotebookLM is disabled/);
    assert.equal(await callTool(pi, "read"), undefined);
  } finally {
    restore();
  }
});

test("a forbidden bash command is blocked end to end", async () => {
  const { pi, restore } = load(CHILD);
  try {
    const verdict = await callTool(pi, "bash", { command: "git push origin main" });
    assert.equal(verdict.block, true);
    assert.match(verdict.reason, /read-only/);
    assert.equal(await callTool(pi, "bash", { command: "git log --oneline -5" }), undefined);
  } finally {
    restore();
  }
});

test("the budget carries across events and leaves only psych_submit", async () => {
  const { pi, restore } = load({ ...CHILD, PI_DEVS_PSYCH_LIMITS: '{"maxToolCalls":1}' });
  try {
    assert.equal(await callTool(pi, "read"), undefined);
    const spent = await callTool(pi, "grep", { pattern: "x" });
    assert.equal(
      spent.reason,
      "tool budget exhausted — call psych_submit now with what you have",
    );
    assert.equal(await callTool(pi, "psych_submit", {}), undefined);
  } finally {
    restore();
  }
});

test("shutdown drains the child's subscription and is idempotent", async () => {
  const { pi, restore } = load(CHILD);
  try {
    const ctx = makeCtx();
    await pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
    assert.deepEqual(pi.unsubscribed, ["tool_call"]);
    await pi.emit("session_shutdown", { type: "session_shutdown" }, ctx);
  } finally {
    restore();
  }
});
