/**
 * The convention rules the reviewer cites (T32a). A live run dropped a correct finding because
 * the child quoted a rule's TEXT while the parent could only verify the rule's PATH, so the parent
 * now supplies the rules themselves as citable evidence.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_RULE_LINES,
  conventionEvidenceLines,
  readConventionRules,
  ruleLines,
} from "../src/shared/conventions.js";
import { buildAgentBrief } from "../src/shared/agent-brief.js";

const AGENTS = [
  "# Repo rules",
  "",
  "## Style",
  "- Never use raw control characters in source files; use escapes.",
  "- Every new source file gets a test.",
  "This paragraph is descriptive prose and states nothing anyone must or must not do.",
  "## API",
  "1. Public functions must return a result rather than throw.",
  "   indented continuation of the rule above, not a new rule",
  "- Avoid string concatenation for messages longer than 80 columns.",
  "```",
  "- this bullet is inside a code fence and is not a rule",
  "```",
].join("\n");

test("only obligation and prohibition lines become rules", () => {
  const rules = ruleLines("AGENTS.md", AGENTS);
  const texts = rules.map((r) => r.text);
  assert.ok(texts.some((t) => t.includes("Never use raw control characters")));
  assert.ok(texts.some((t) => t.includes("Every new source file gets a test")));
  assert.ok(texts.some((t) => t.includes("Public functions must return")));
  assert.ok(texts.some((t) => t.includes("Avoid string concatenation")));
  assert.ok(!texts.some((t) => t.includes("descriptive prose")), "prose is not a rule");
  assert.ok(!texts.some((t) => t.includes("this bullet is inside")), "code fences are skipped");
  assert.ok(!texts.some((t) => t.includes("indented continuation")), "a continuation is not a new rule");
  assert.ok(!texts.some((t) => t.startsWith("#")), "headings are not rules");
});

test("a rule names its file and line", () => {
  const rules = ruleLines("AGENTS.md", AGENTS);
  const first = rules[0];
  assert.match(first.source, /^AGENTS\.md:\d+$/);
  assert.equal(AGENTS.split("\n")[Number(first.source.split(":")[1]) - 1].includes(first.text.slice(0, 20)), true);
});

test("the rule count is bounded per file", () => {
  const many = Array.from({ length: 200 }, (_, i) => `- Rule ${i} must be honoured.`).join("\n");
  assert.equal(ruleLines("AGENTS.md", many).length, MAX_RULE_LINES);
});

test("a read covers only the configured files that exist, and an unreadable one is skipped", () => {
  const files = { "AGENTS.md": AGENTS };
  const io = {
    exists: (p) => p.endsWith("AGENTS.md") || p.endsWith("docs/spai"),
    read: (p) => {
      if (p.endsWith("docs/spai")) throw new Error("EISDIR");
      return files["AGENTS.md"];
    },
  };
  const rules = readConventionRules("D:/repo", ["AGENTS.md", "CLAUDE.md", "docs/spai"], io);
  assert.ok(rules.length > 0);
  assert.ok(rules.every((r) => r.source.startsWith("AGENTS.md:")), "only the existing, readable file");
});

test("no rules and no files yield no evidence", () => {
  assert.deepEqual(readConventionRules("D:/repo", [], { exists: () => true, read: () => AGENTS }), []);
  assert.deepEqual(conventionEvidenceLines([]), []);
});

test("the brief lists the rules and demands a verbatim copy", () => {
  const rules = readConventionRules("D:/repo", ["AGENTS.md"], {
    exists: () => true,
    read: () => AGENTS,
  });
  const lines = conventionEvidenceLines(rules);
  const brief = buildAgentBrief({
    role: "pair",
    piVersion: "0.87.1",
    docsDir: undefined,
    liveLines: ["window: 1 prompt(s)"],
    sessionLines: ["session line"],
    limits: { maxToolCalls: 5, allowWeb: false, allowMcp: false, allowNlm: false },
    nlmNotebooks: [],
    review: {
      lastDeliveryHead: "aaa1111",
      head: "bbb2222",
      maxDiffBytes: 200000,
      conventionFiles: ["AGENTS.md"],
      conventionRules: conventionEvidenceLines(rules),
    },
  });
  const { systemAppend } = brief;
  assert.match(systemAppend, /CONVENTIONS lines/);
  // The citable line is `AGENTS.md:<n>: <rule>` — located, so the child quotes the same string the
  // parent verifies. A rule quoted without its location is not in the enforcement set.
  assert.match(systemAppend, /- AGENTS\.md:\d+: Every new source file gets a test\./, "the located rule is what is quoted");
  const citable = lines.find((l) => l.includes("Every new source file gets a test"));
  assert.equal(systemAppend.includes(`- ${citable}`), true, "the brief carries the evidence line verbatim");
  assert.match(systemAppend, /A diff hunk is NOT citable/);
  assert.ok(
    systemAppend.includes(`git diff aaa1111..bbb2222`),
    "the anchored range survives",
  );
  assert.ok(brief.userMessage.endsWith("Review the delivery now. Submit with psych_submit."));
});

test("with no rules the brief tells the child to abstain", () => {
  const brief = buildAgentBrief({
    role: "pair",
    piVersion: "0.87.1",
    docsDir: undefined,
    liveLines: [],
    sessionLines: [],
    limits: { maxToolCalls: 5, allowWeb: false, allowMcp: false, allowNlm: false },
    nlmNotebooks: [],
    review: {
      lastDeliveryHead: "",
      head: "bbb2222",
      maxDiffBytes: 200000,
      conventionFiles: ["AGENTS.md"],
      conventionRules: [],
    },
  });
  assert.match(brief.systemAppend, /read no stated rules/);
  assert.match(brief.systemAppend, /insufficient_context/);
});

test("the evidence line a citation is matched against is exactly the brief's bullet", () => {
  const rules = readConventionRules("D:/repo", ["AGENTS.md"], { exists: () => true, read: () => AGENTS });
  const lines = conventionEvidenceLines(rules);
  const brief = buildAgentBrief({
    role: "pair",
    piVersion: "0.87.1",
    docsDir: undefined,
    liveLines: [],
    sessionLines: [],
    limits: { maxToolCalls: 5, allowWeb: false, allowMcp: false, allowNlm: false },
    nlmNotebooks: [],
    review: {
      lastDeliveryHead: "",
      head: "b",
      maxDiffBytes: 1,
      conventionFiles: [],
      conventionRules: lines,
    },
  });
  for (const line of lines) {
    assert.ok(brief.systemAppend.includes(`- ${line}`), `brief carries ${line}`);
  }
});
