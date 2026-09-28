/**
 * The child launch — argv and environment (T24).
 *
 * These are the constraints the spike paid for, pinned so a later refactor cannot quietly drop one:
 * the message is its own `@file` token, `--fork` excludes `--no-session`, trust mirrors the parent,
 * and the child carries OUR marker but not the shared ones (D5). A snapshot here is cheaper than
 * re-earning the fact with a real child.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildChildLaunch } from "../src/shared/agent-argv.js";

const RUN_TMP = join("C:", "tmp", "pi-devs-psychologist", "run1");
const SESSION_FILE = join("C:", "sessions", "parent.jsonl");

function launch(over = {}) {
  return buildChildLaunch({
    cliPath: "C:/engine/dist/bundle/cli.js",
    execPath: "C:/node/node.exe",
    context: "evidence",
    runTmp: RUN_TMP,
    modelRef: "openrouter-soukr/x/y",
    thinking: "",
    trusted: true,
    extraArgs: [],
    role: "psychologist",
    runId: "run1",
    limits: { maxToolCalls: 25, allowWeb: true, allowMcp: true, allowNlm: true },
    baseEnv: { PATH: "/bin", PI_SUBAGENT: "true", PI_CHILD_SESSION: "1" },
    ...over,
  });
}

test("evidence context: fixed argv order, no session, trust mirrored, message last and alone", () => {
  const { command, args } = launch();
  assert.equal(command, "C:/node/node.exe", "node runs the engine, never a shell");
  assert.deepEqual(args, [
    "C:/engine/dist/bundle/cli.js",
    "--mode", "json",
    "-p",
    "--no-session",
    "--model", "openrouter-soukr/x/y",
    "--append-system-prompt", join(RUN_TMP, "brief.md"),
    "--approve",
    "@" + join(RUN_TMP, "message.md"),
  ]);
});

test("digest context also uses --no-session (only fork changes the session boundary)", () => {
  assert.deepEqual(launch({ context: "digest" }).args, launch({ context: "evidence" }).args);
});

test("fork context adds --fork and a session dir, and drops --no-session", () => {
  const { args, fallback } = launch({ context: "fork", parentSessionFile: SESSION_FILE });
  assert.equal(fallback, false);
  assert.deepEqual(args.slice(3, 8), [
    "-p",
    "--fork", SESSION_FILE,
    "--session-dir", join(RUN_TMP, "session"),
  ]);
  assert.ok(!args.includes("--no-session"), "--fork cannot be combined with --no-session");
});

test("fork without a parent session file falls back to --no-session and reports it", () => {
  const { args, fallback } = launch({ context: "fork" });
  assert.equal(fallback, true);
  assert.ok(args.includes("--no-session"));
  assert.ok(!args.includes("--fork"));
});

test("thinking is passed only when set, and extraArgs land before the message", () => {
  const base = launch();
  const withThinking = launch({ thinking: "high", extraArgs: ["--no-lens-extra"] });
  assert.ok(!base.args.includes("--thinking"));
  const thinkingAt = withThinking.args.indexOf("--thinking");
  assert.equal(withThinking.args[thinkingAt + 1], "high");
  const messageAt = withThinking.args.indexOf("@" + join(RUN_TMP, "message.md"));
  assert.equal(withThinking.args[messageAt - 1], "--no-lens-extra", "extraArgs precede the message");
  assert.equal(messageAt, withThinking.args.length - 1, "the message is the last, own token");
});

test("an untrusted parent yields --no-approve", () => {
  assert.ok(launch({ trusted: false }).args.includes("--no-approve"));
});

test("env sets our markers, serialises the limits, and removes the shared markers (D5)", () => {
  const { env } = launch();
  assert.equal(env.PI_DEVS_PSYCH_CHILD, "1");
  assert.equal(env.PI_DEVS_PSYCH_RUN, "run1");
  assert.equal(env.PI_DEVS_PSYCH_ROLE, "psychologist");
  assert.deepEqual(JSON.parse(env.PI_DEVS_PSYCH_LIMITS), {
    maxToolCalls: 25,
    allowWeb: true,
    allowMcp: true,
    allowNlm: true,
  });
  assert.equal("PI_SUBAGENT" in env, false, "the shared marker must not reach the child");
  assert.equal("PI_CHILD_SESSION" in env, false);
  assert.equal(env.PATH, "/bin", "the rest of the environment is copied unchanged");
});

test("the limits JSON is exactly what the child's parser reads back", () => {
  // A drift between write and read would silently disable a capability or a budget.
  const { env } = launch({ limits: { maxToolCalls: 0, allowWeb: false, allowMcp: false, allowNlm: false } });
  assert.deepEqual(JSON.parse(env.PI_DEVS_PSYCH_LIMITS), {
    maxToolCalls: 0,
    allowWeb: false,
    allowMcp: false,
    allowNlm: false,
  });
});
