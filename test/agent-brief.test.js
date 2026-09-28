/**
 * agent-brief — the two strings a headless child pi is started with (T23).
 *
 * Two properties carry the weight. The user message's evidence part must be BYTE-identical to the
 * API runtime's `buildUserText`, or an appraisal would depend on the runtime that formed it (D2);
 * and the system append's capability bullets must appear if and only if the limits allow them, or
 * the brief would promise the child a tool the guard then blocks. The docs-map test walks the map
 * against the real installed engine so a path that moves upstream is caught, not printed as a dead
 * line.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildAgentBrief,
  PI_DOC_FILES,
  SUBMIT_FINAL_LINE,
  SUBMIT_OUTPUT_INSTRUCTION,
} from "../src/shared/agent-brief.js";
import { buildUserText, SYSTEM_PROMPT } from "../src/shared/prompt.js";
import { resolvePiDocsDir } from "../src/shared/pi-paths.js";

const JSON_ONLY_FINAL_LINE = "Appraise the session now. JSON only.";
const DOCS_DIR = join(homedir(), "engine", "docs");

function fixture(overrides = {}) {
  return {
    role: "psychologist",
    piVersion: "0.87.1",
    docsDir: DOCS_DIR,
    liveLines: ["turn 1: tool ok", "no verified progress since"],
    sessionLines: ["session declared purpose: ship T23"],
    limits: { maxToolCalls: 25, allowWeb: true, allowMcp: true, allowNlm: true },
    nlmNotebooks: ["nb-psych"],
    ...overrides,
  };
}

const SECTION_HEADINGS = [
  "## Where you are",
  "## Pi documentation",
  "## Pi packages",
  "## Tools you may use",
  "## Budget",
  "## Research rule",
];

test("every shared section is present, in the fixed order", () => {
  const { systemAppend } = buildAgentBrief(fixture());
  let cursor = -1;
  for (const heading of SECTION_HEADINGS) {
    const at = systemAppend.indexOf(heading);
    assert.ok(at > cursor, `${heading} present and after the previous section`);
    cursor = at;
  }
});

test("the psychologist role prompt is SYSTEM_PROMPT with only the output paragraph replaced", () => {
  const { systemAppend } = buildAgentBrief(fixture());
  assert.ok(SYSTEM_PROMPT.includes("Answer with ONE JSON object and nothing else, no prose and no code fences:"));
  assert.ok(systemAppend.includes(SUBMIT_OUTPUT_INSTRUCTION), "the submit instruction is present");
  assert.ok(!systemAppend.includes("Answer with ONE JSON object"), "the JSON output paragraph is gone");
  // The rest of the psychologist prompt survives verbatim.
  assert.ok(systemAppend.includes("You are the engineering psychologist observing a coding session"));
});

test("ask/scout/pair get a short placeholder role paragraph, not the psychologist prompt", () => {
  for (const role of ["ask", "scout", "pair"]) {
    const { systemAppend } = buildAgentBrief(fixture({ role }));
    assert.ok(systemAppend.includes(`\`${role}\` role`), `${role} names itself`);
    assert.ok(!systemAppend.includes("You are the engineering psychologist"), `${role} is not the psychologist`);
    assert.ok(systemAppend.includes("## Budget"), `${role} still gets the shared sections`);
  }
});

test("the tools section renders exactly the capabilities the limits allow", () => {
  const { systemAppend } = buildAgentBrief(fixture());
  assert.ok(systemAppend.includes("web_enable"), "web bullet");
  assert.ok(systemAppend.includes("`mcp({})`"), "mcp bullet");
  assert.ok(systemAppend.includes("nlm login --check"), "nlm bullet");
  assert.ok(systemAppend.includes("Your prompt lists available skills"), "skills bullet");
  assert.ok(systemAppend.includes("`git diff`"), "repo bullet");
});

test("allowWeb:false removes exactly the web bullet", () => {
  const { systemAppend } = buildAgentBrief(fixture({ limits: { maxToolCalls: 25, allowWeb: false, allowMcp: true, allowNlm: true } }));
  assert.ok(!systemAppend.includes("web_enable"), "web bullet gone");
  assert.ok(systemAppend.includes("`mcp({})`"), "mcp bullet stays");
  assert.ok(systemAppend.includes("nlm login --check"), "nlm bullet stays");
  assert.ok(systemAppend.includes("`git diff`"), "repo bullet stays");
});

test("allowMcp:false removes exactly the mcp bullet", () => {
  const { systemAppend } = buildAgentBrief(fixture({ limits: { maxToolCalls: 25, allowWeb: true, allowMcp: false, allowNlm: true } }));
  assert.ok(!systemAppend.includes("`mcp({})`"), "mcp bullet gone");
  assert.ok(systemAppend.includes("web_enable"), "web bullet stays");
  assert.ok(systemAppend.includes("nlm login --check"), "nlm bullet stays");
});

test("allowNlm:false removes exactly the nlm bullet", () => {
  const { systemAppend } = buildAgentBrief(fixture({ limits: { maxToolCalls: 25, allowWeb: true, allowMcp: true, allowNlm: false } }));
  assert.ok(!systemAppend.includes("nlm login --check"), "nlm bullet gone");
  assert.ok(systemAppend.includes("web_enable"), "web bullet stays");
  assert.ok(systemAppend.includes("`mcp({})`"), "mcp bullet stays");
});

test("the allowed notebooks are listed, and the budget and research rules are stated", () => {
  const { systemAppend } = buildAgentBrief(fixture({ nlmNotebooks: ["nb-psych", "nb-devex"] }));
  assert.ok(systemAppend.includes("nb-psych"), "first notebook listed");
  assert.ok(systemAppend.includes("nb-devex"), "second notebook listed");
  assert.ok(systemAppend.includes("`25` tool calls"), "budget interpolated");
  assert.ok(systemAppend.includes("may only fill `suggestions`"), "research rule present");
});

test("the docs map lists docs.json first and every topic, with the absolute dir once", () => {
  const { systemAppend } = buildAgentBrief(fixture());
  assert.ok(systemAppend.includes(`\`${DOCS_DIR}\``), "absolute docs dir shown");
  const occurrences = systemAppend.split(DOCS_DIR).length - 1;
  assert.equal(occurrences, 1, "the docs dir appears exactly once");
  for (const file of PI_DOC_FILES) {
    assert.ok(systemAppend.includes(`\`${file}\``), `docs map names ${file}`);
  }
  assert.ok(systemAppend.indexOf("`docs.json`") < systemAppend.indexOf("`extensions.md`"), "docs.json first");
  assert.ok(systemAppend.includes("Read only the file a question needs."));
});

test("an unresolved docs dir omits the map and says so", () => {
  const { systemAppend } = buildAgentBrief(fixture({ docsDir: undefined }));
  assert.ok(systemAppend.includes("## Pi documentation"), "section kept");
  assert.ok(systemAppend.includes("could not be found"), "told the docs are unavailable");
  assert.ok(!systemAppend.includes("`docs.json`"), "no dead paths listed");
});

test("no operator home path appears except the interpolated docs dir", () => {
  const { systemAppend } = buildAgentBrief(fixture());
  const userMessage = buildAgentBrief(fixture()).userMessage;
  assert.equal(systemAppend.split(homedir()).length - 1, 1, "home appears once (from docsDir)");
  assert.ok(!userMessage.includes(homedir()), "the user message carries no home path");
  assert.ok(!systemAppend.includes("D:\\01_programovani"), "no monorepo path");
});

test("the user message keeps buildUserText's evidence byte-identical and swaps the final line", () => {
  const input = fixture();
  const { userMessage } = buildAgentBrief(input);
  const base = buildUserText(input.liveLines, input.sessionLines);
  const evidence = base.slice(0, base.length - JSON_ONLY_FINAL_LINE.length);
  assert.equal(userMessage.slice(0, evidence.length), evidence, "evidence prefix byte-identical");
  assert.ok(userMessage.endsWith(SUBMIT_FINAL_LINE), "submit final line");
  assert.ok(!userMessage.includes(JSON_ONLY_FINAL_LINE), "JSON-only line gone");
});

test("a digest block is inserted before the final line, leaving the evidence untouched", () => {
  const input = fixture({ digest: "OP: fix the guard\nASST: done" });
  const { userMessage } = buildAgentBrief(input);
  const base = buildUserText(input.liveLines, input.sessionLines);
  const evidence = base.slice(0, base.length - JSON_ONLY_FINAL_LINE.length);
  assert.equal(userMessage.slice(0, evidence.length), evidence, "evidence prefix byte-identical");
  const digestAt = userMessage.indexOf("DIGEST — ");
  const finalAt = userMessage.indexOf(SUBMIT_FINAL_LINE);
  assert.ok(digestAt > evidence.length - 1, "digest after the evidence");
  assert.ok(digestAt < finalAt, "digest before the final line");
  assert.ok(userMessage.includes("DIGEST — OP: fix the guard"), "digest content present");
});

test("buildAgentBrief is pure: same input yields the same strings", () => {
  assert.deepEqual(buildAgentBrief(fixture()), buildAgentBrief(fixture()));
});

test("resolvePiDocsDir prefers argv1, verifies docs.json, and never guesses", () => {
  const root = join("C:", "node_modules", "@earendil-works", "pi-coding-agent");
  const cli = join(root, "dist", "bundle", "cli.js");
  const docs = join(root, "docs");
  const seen = [];
  const exists = (p) => {
    seen.push(p);
    return p === join(docs, "docs.json");
  };

  assert.equal(resolvePiDocsDir({ argv1: cli, exists }), docs);
  assert.ok(seen.includes(join(docs, "docs.json")), "docs.json was checked");

  // argv1 present but docs.json missing: no fallback to packageDir, no guessed path.
  assert.equal(resolvePiDocsDir({ argv1: cli, packageDir: "D:/pkg", exists: () => false }), undefined);

  // No argv1: fall back to PI_PACKAGE_DIR.
  const pkg = join("D:", "pkg");
  assert.equal(resolvePiDocsDir({ packageDir: pkg, exists: (p) => p === join(pkg, "docs", "docs.json") }), join(pkg, "docs"));

  // Neither source: undefined.
  assert.equal(resolvePiDocsDir({ exists: () => true }), undefined);
});

test("every docs file named in the map exists in the real installed engine", (t) => {
  const engineRoot = findEnginePackage();
  if (!engineRoot) {
    t.skip("engine package not found on this machine");
    return;
  }
  const docsDir = resolvePiDocsDir({ packageDir: engineRoot, exists: existsSync });
  if (!docsDir) {
    t.skip("engine docs dir not found");
    return;
  }
  for (const file of PI_DOC_FILES) {
    assert.ok(existsSync(join(docsDir, file)), `docs map names a real file: ${file}`);
  }
});

/** Walk up from this file to the monorepo's node_modules and locate the engine package root. */
function findEnginePackage() {
  let dir = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  for (;;) {
    const candidate = join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
    if (existsSync(candidate)) return dirname(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
