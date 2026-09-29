/**
 * The digest context level (T28) — a bounded, scrubbed excerpt, pinned line by line.
 *
 * These tests defend the three things a digest must never do: carry a secret, carry a tool's
 * OUTPUT, or carry a thinking block. The rest is arithmetic (caps) and formatting (a tool line
 * says `ok`/`fail`), which is asserted against hand-built entries rather than a real session.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildDigest, scrubSecrets } from "../src/shared/digest.js";

let id = 0;
function entry(message) {
  id += 1;
  return { type: "message", id: `e${id}`, parentId: null, timestamp: "2024-01-01T00:00:00.000Z", message };
}

function user(text) {
  return entry({ role: "user", content: text, timestamp: id });
}

function assistant(content) {
  return entry({ role: "assistant", content, api: "x", provider: "p", model: "m", usage: {}, stopReason: "stop", timestamp: id });
}

function toolResult(toolCallId, text, isError) {
  return entry({ role: "toolResult", toolCallId, toolName: "bash", content: [{ type: "text", text }], isError, timestamp: id });
}

function toolCall(callId, name, args) {
  return { type: "toolCall", id: callId, name, arguments: args };
}

test("a tool line shows ok/fail from the matching result, and never the result content", () => {
  const digest = buildDigest([
    user("run the tests"),
    assistant([toolCall("c1", "bash", { command: "npm test" })]),
    toolResult("c1", "PLANTED_MARKER_RESULT_XYZ all tests passed", true),
    user("again"),
    assistant([toolCall("c2", "edit", { path: "src/a.ts" })]),
    toolResult("c2", "another PLANTED_MARKER_RESULT_XYZ", false),
  ]);
  assert.match(digest, /tool: bash\(npm test\) fail/);
  assert.match(digest, /tool: edit\(src\/a\.ts\) ok/);
  assert.doesNotMatch(digest, /PLANTED_MARKER_RESULT_XYZ/, "no tool output ever appears");
});

test("thinking blocks never appear; assistant text does", () => {
  const digest = buildDigest([
    user("what now"),
    assistant([
      { type: "thinking", thinking: "SECRET_THOUGHT_ABC" },
      { type: "text", text: "Here is the visible answer." },
    ]),
  ]);
  assert.doesNotMatch(digest, /SECRET_THOUGHT_ABC/, "thinking never leaves the machine");
  assert.match(digest, /assistant: Here is the visible answer\./);
});

test("a command is clamped to 60 chars and a path is shown whole", () => {
  const long = "x".repeat(200);
  const digest = buildDigest([
    assistant([toolCall("c1", "bash", { command: long })]),
    toolResult("c1", "ok output", false),
    assistant([toolCall("c2", "read", { path: "src/very/deep/path/file.ts" })]),
    toolResult("c2", "ok output", false),
  ]);
  assert.match(digest, new RegExp(`tool: bash\\(${"x".repeat(60)}\\) ok`));
  assert.match(digest, /tool: read\(src\/very\/deep\/path\/file\.ts\) ok/);
});

const SECRET_FORMS = [
  "sk-abcdefghijkl",
  "ghp_abcdefghijklmnop",
  "gho_abcdefghijklmnop",
  "github_pat_abcdefghijklmnop",
  "AKIA1234567890ABCDEF",
  "xoxb-1234567890abcdef",
  "Bearer abc.def.ghi",
  "API_KEY=supersecretvalue",
  "password: hunter2value",
];

test("every secret form in a prompt is redacted by the scrubber, applied last", () => {
  const prompt = [
    "keys:",
    ...SECRET_FORMS.slice(0, 6),
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEsecretmaterial",
    "-----END RSA PRIVATE KEY-----",
    SECRET_FORMS[6],
    SECRET_FORMS[7],
    SECRET_FORMS[8],
  ].join(" ");
  const digest = buildDigest([user(prompt)]);
  for (const secret of SECRET_FORMS.slice(0, 6)) {
    assert.doesNotMatch(digest, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `leaked ${secret}`);
  }
  assert.doesNotMatch(digest, /MIIEsecretmaterial/, "the private key body is gone");
  assert.doesNotMatch(digest, /supersecretvalue/, "the KEY=value is redacted");
  assert.doesNotMatch(digest, /hunter2value/, "the password value is redacted");
  assert.match(digest, /\[redacted\]/);
});

test("scrubSecrets redacts each form directly", () => {
  assert.equal(scrubSecrets("token sk-abcdefghijkl end"), "token [redacted] end");
  assert.equal(scrubSecrets("use ghp_abcdefghijklmnop now"), "use [redacted] now");
  assert.equal(scrubSecrets("use gho_abcdefghijklmnop now"), "use [redacted] now");
  assert.equal(scrubSecrets("pat github_pat_abcdefghijklmnop!"), "pat [redacted]!");
  assert.equal(scrubSecrets("aws AKIA1234567890ABCDEF here"), "aws [redacted] here");
  assert.equal(scrubSecrets("slack xoxb-1234567890abcdef"), "slack [redacted]");
  assert.equal(scrubSecrets("Authorization: Bearer abc.def.ghi"), "Authorization: Bearer [redacted]");
  assert.equal(scrubSecrets("MY_SECRET=topsecret"), "MY_SECRET=[redacted]");
  assert.equal(scrubSecrets("api_token: t0p"), "api_token: [redacted]");
  assert.equal(
    scrubSecrets("-----BEGIN RSA PRIVATE KEY-----\nbody\n-----END RSA PRIVATE KEY-----"),
    "[redacted]",
  );
  assert.equal(scrubSecrets("nothing to hide"), "nothing to hide");
});

test("the character cap drops the OLDEST items first", () => {
  const entries = [];
  for (const label of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
    entries.push(user(`PROMPT_${label} ${"z".repeat(40)}`));
  }
  const digest = buildDigest(entries, { maxChars: 120 });
  assert.ok(digest.length <= 120, `cap respected, got ${digest.length}`);
  assert.doesNotMatch(digest, /PROMPT_A/, "the oldest prompt was dropped");
  assert.match(digest, /PROMPT_H/, "the newest prompt survives");
});

test("only the last twelve operator prompts are kept", () => {
  const entries = [];
  for (let i = 1; i <= 15; i += 1) entries.push(user(`p${String(i).padStart(2, "0")} note`));
  const digest = buildDigest(entries);
  assert.doesNotMatch(digest, /p01 note/, "the first prompt is beyond the window");
  assert.match(digest, /p15 note/);
  const kept = digest.split("\n").filter((line) => line.startsWith("user:"));
  assert.equal(kept.length, 12, "exactly twelve prompts survive");
});

test("an empty branch yields undefined, not an empty string", () => {
  assert.equal(buildDigest([]), undefined);
  assert.equal(buildDigest([entry({ role: "system", content: "" })]), undefined);
});
