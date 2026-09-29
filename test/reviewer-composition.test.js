/**
 * `reviewer` — the composition-root wiring of `/psych review` (T32a).
 *
 * Drives the REAL extension through the command with a FAKE process surface — never a real child pi
 * — and proves the child runs as the `pair` role with the reviewer's OWN model, and that nothing is
 * steered into the working agent. The cwd is a real (throwaway) git repository so the delivery anchor
 * resolves, and the reviewer's consent gate is proved by the absence of a spawn when it is off.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import devsPsychologistExtension from "../index.js";
import { makeCtx, makePi } from "./fakes.js";

const HOME = mkdtempSync(join(tmpdir(), "psych-rev-home-"));
process.on("exit", () => rmSync(HOME, { recursive: true, force: true }));
let loadCount = 0;

/** A scripted fake child that submits an abstention, then closes on the next macrotask. */
function scriptedReviewChild() {
  const child = new EventEmitter();
  child.pid = 4343;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({ type: "tool_execution_start", toolCallId: "c1", toolName: "psych_submit", args: { verdict: "insufficient_context", text: "no stated rule decides this" } }) + "\n",
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

function writeConfig(globalFile, reviewer = {}) {
  writeFileSync(
    globalFile,
    JSON.stringify({
      ...DEFAULT_CONFIG,
      model: "p/m",
      runtime: "agent",
      maxAppraisalsPerSession: 5,
      roles: { ...DEFAULT_CONFIG.roles, reviewer: { ...DEFAULT_CONFIG.roles.reviewer, enabled: true, ...reviewer } },
    }),
    "utf8",
  );
}

function gitRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "psych-rev-repo-"));
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"], { cwd });
  return cwd;
}

function ctxFor(cwd) {
  return makeCtx({
    cwd,
    model: { provider: "p", id: "m" },
    isProjectTrusted: () => true,
    sessionManager: { getEntries: () => [], getBranch: () => [], getSessionFile: () => join(cwd, "parent.jsonl"), getSessionDir: () => ".sessions" },
  });
}

test("the agent review runs the child as role 'pair' with the reviewer's own model, and steers nothing", async () => {
  const { io, record } = fakeIo([scriptedReviewChild()]);
  const { pi, globalFile } = load(io);
  const cwd = gitRepo();
  const sent = [];
  pi.sendUserMessage = (body) => sent.push(body);
  try {
    writeConfig(globalFile, { model: "strong/model" });
    const ctx = ctxFor(cwd);
    await pi.emit("session_start", { type: "session_start" }, ctx);
    await pi.commands.get("psych").handler("review", ctx);

    assert.equal(record.spawn.length, 1, "exactly one child ran");
    assert.equal(record.spawn[0].env.PI_DEVS_PSYCH_ROLE, "pair", "the child runs as the pair role");
    const modelFlag = record.spawn[0].args.indexOf("--model");
    assert.equal(record.spawn[0].args[modelFlag + 1], "strong/model", "the reviewer's own model is passed");
    const message = record.files.find((f) => f.path.endsWith("message.md"));
    assert.ok(message.data.endsWith("Review the delivery now. Submit with psych_submit."));
    assert.deepEqual(sent, [], "nothing was steered into the working agent");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the reviewer's consent gate being off means nothing runs", async () => {
  const { io, record } = fakeIo([scriptedReviewChild()]);
  const { pi, globalFile } = load(io);
  const cwd = gitRepo();
  try {
    writeFileSync(globalFile, JSON.stringify({ ...DEFAULT_CONFIG, model: "p/m", runtime: "agent" }), "utf8");
    const ctx = ctxFor(cwd);
    await pi.emit("session_start", { type: "session_start" }, ctx);
    await pi.commands.get("psych").handler("review", ctx);
    assert.equal(record.spawn.length, 0, "no child without consent");
    assert.match(ctx.notes.at(-1).message, /roles\.reviewer\.enabled/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
