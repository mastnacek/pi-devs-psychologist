/**
 * `/psych ask` — card geometry and the composition-root wiring (T30).
 *
 * Two promises the presenter makes and could not otherwise keep: `measureAskCard` sizes the overlay
 * from the very lines the view draws, and every rendered line fits the width (an overflowing line
 * corrupts the whole frame). The integration test then drives the REAL extension through `/psych ask`
 * with a FAKE process surface — never a real child pi — and asserts the child runs as the `ask` role,
 * the question reaches its message, and nothing is steered into the working agent.
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
import { AskView } from "../src/slices/overlay/ask-view.js";
import { layoutAskCard, measureAskCard } from "../src/slices/overlay/ask-layout.js";
import devsPsychologistExtension from "../index.js";
import { makeCtx, makePi } from "./fakes.js";

const LINE = "window: 3 prompt(s), 8 tool call(s), 21 min";
const PLAIN = { fg: (_c, t) => t, bold: (t) => t, bg: (_c, t) => t };

function cardInput(over = {}) {
  return {
    question: "Why am I stuck on this refactor?",
    answer: "The window shows no verified run since the last edit, so nothing has proved the change works.",
    cited: [LINE],
    suggestions: [],
    unsupported: false,
    noResearch: false,
    ...over,
  };
}

test("the card marks an unsupported answer instead of hiding it", () => {
  const s = stringsFor("en");
  const text = layoutAskCard(cardInput({ unsupported: true, cited: [] }), s, 76, PLAIN)
    .head.map((line) => line.text)
    .join("\n");
  assert.ok(text.includes(s.askUnsupported), "the unsupported marker is shown");
  const clean = layoutAskCard(cardInput(), s, 76, PLAIN)
    .head.map((line) => line.text)
    .join("\n");
  assert.ok(!clean.includes(s.askUnsupported), "and is absent when the answer is cited");
});

test("the answer and question survive on the card whole", () => {
  const s = stringsFor("en");
  const text = layoutAskCard(cardInput(), s, 120, PLAIN)
    .head.map((line) => line.text)
    .join("\n");
  assert.ok(text.includes("Question"));
  assert.ok(text.includes("Why am I stuck on this refactor?"));
  assert.ok(text.includes("Answer"));
});

test("the card states there was no research only when the API runtime answered", () => {
  const s = stringsFor("en");
  const api = layoutAskCard(cardInput({ noResearch: true }), s, 76, PLAIN);
  assert.ok(api.tail.some((line) => line.text.includes(s.askNoResearch)));
  const agent = layoutAskCard(cardInput(), s, 76, PLAIN);
  assert.ok(!agent.tail.some((line) => line.text.includes(s.askNoResearch)));
});

test("measureAskCard counts exactly the lines the view draws, and no line exceeds the width", () => {
  const input = cardInput({
    unsupported: true,
    noResearch: true,
    suggestions: [{ kind: "doc", text: "read the extensions guide", source: "https://x/y" }],
  });
  for (const locale of ["en", "cs"]) {
    const s = stringsFor(locale);
    const { head, tail } = layoutAskCard(input, s, 76, PLAIN);
    const measured = measureAskCard(input, s, 76);
    assert.equal(measured.head, head.length);
    assert.equal(measured.tail, tail.length);
    assert.equal(measured.total, FRAME_LINES + head.length + tail.length);
  }
  for (const theme of [PLAIN, makePi().ansi]) {
    for (const width of [40, 120]) {
      const lines = new AskView(input, theme, () => {}, { maxHeight: 200 }).render(width);
      for (const line of lines) {
        assert.ok(
          visibleWidth(line) <= width,
          `a ${visibleWidth(line)}-cell line in a ${width}-cell card: ${JSON.stringify(line)}`,
        );
      }
    }
  }
});

test("a suggestion with its source renders on the card", () => {
  const s = stringsFor("en");
  const { tail } = layoutAskCard(
    cardInput({ suggestions: [{ kind: "doc", text: "read the guide", source: "https://x/y" }] }),
    s,
    76,
    PLAIN,
  );
  const text = tail.map((line) => line.text).join("\n");
  assert.ok(text.includes("read the guide"));
  assert.ok(text.includes("https://x/y"));
});

/* --- composition-root integration: the real wiring --- */

const HOME = mkdtempSync(join(tmpdir(), "psych-ask-home-"));
process.on("exit", () => rmSync(HOME, { recursive: true, force: true }));
let loadCount = 0;

/** A scripted fake child that submits an ask answer, then closes on the next macrotask. */
function scriptedAskChild() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({ type: "tool_execution_start", toolCallId: "c1", toolName: "psych_submit", args: { answer: "Cited answer.", cited: [] } }) + "\n",
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
    JSON.stringify({ ...DEFAULT_CONFIG, model: "p/m", maxAppraisalsPerSession: 5, ...over }),
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

test("the agent ask runs the child as role 'ask' and puts the question in the message", async () => {
  const { io, record } = fakeIo([scriptedAskChild()]);
  const { pi, globalFile } = load(io);
  const cwd = mkdtempSync(join(tmpdir(), "psych-ask-cwd-"));
  const sent = [];
  pi.sendUserMessage = (body) => sent.push(body);
  try {
    writeConfig(globalFile, { runtime: "agent" });
    const ctx = ctxFor(cwd);
    await pi.emit("session_start", { type: "session_start" }, ctx);
    await pi.commands.get("psych").handler("ask why am I stuck on this refactor", ctx);

    assert.equal(record.spawn.length, 1, "exactly one child ran");
    assert.equal(record.spawn[0].env.PI_DEVS_PSYCH_ROLE, "ask", "the child runs as the ask role");
    const message = record.files.find((f) => f.path.endsWith("message.md"));
    assert.ok(message, "the message file was written");
    assert.ok(message.data.includes("QUESTION — why am I stuck on this refactor"), "the question is in the child's message");
    assert.ok(message.data.endsWith("Answer the question now. Submit with psych_submit."));
    assert.deepEqual(sent, [], "nothing was steered into the working agent");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
