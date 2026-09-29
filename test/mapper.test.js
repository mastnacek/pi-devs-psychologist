/**
 * Codebase mapper (T8) — the objective repo map as citable evidence.
 *
 * The pure arithmetic is pinned against hand-counted numbers; the walk is pinned against a real
 * fixture tree, because the properties that matter there (never follow a symlink, never leave cwd,
 * skip `.git`/`node_modules`, cap the file count) are only true if the code, not the reader, says so.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRepoMap, defaultIsSource, MAP_STALE_TURNS } from "../src/shared/repo-map.js";
import {
  collectRepoFiles,
  defaultMapperIo,
  ensureRepoMap,
  repoMapEvidenceLines,
  repoMapReport,
} from "../src/slices/mapper/index.js";
import { renderReport } from "../src/slices/report/index.js";
import { visibleWidth } from "@earendil-works/pi-tui";
import { maybeAppraise } from "../src/slices/appraiser/index.js";
import { allowedEvidence } from "../src/shared/prompt.js";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

/** Exactly `count` lines, each newline-terminated. */
function writeLines(path, count) {
  writeFileSync(path, "x\n".repeat(count));
}

const OLD_TEMP = [];
function temp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  OLD_TEMP.push(dir);
  return dir;
}
process.on("exit", () => {
  for (const dir of OLD_TEMP) rmSync(dir, { recursive: true, force: true });
});

/** A fixture with hand-counted properties: 6 files, 4 source, 1 test, longest 350 lines. */
function fixture() {
  const root = temp("psych-map-");
  mkdirSync(join(root, "src", "shared"), { recursive: true });
  mkdirSync(join(root, "src", "slices", "one"), { recursive: true });
  mkdirSync(join(root, "src", "slices", "two"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(join(root, "node_modules"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  writeLines(join(root, "README.md"), 5);
  writeLines(join(root, "src", "shared", "a.ts"), 10);
  writeLines(join(root, "src", "slices", "one", "index.ts"), 350);
  writeLines(join(root, "src", "slices", "two", "index.ts"), 20);
  writeLines(join(root, "src", "b.ts"), 10);
  writeLines(join(root, "test", "a.test.js"), 12);
  writeLines(join(root, "node_modules", "x.ts"), 99);
  writeLines(join(root, ".git", "y.ts"), 99);
  return root;
}

function stateWithMap(over = {}) {
  const state = makeState();
  state.config = { ...DEFAULT_CONFIG, model: "p/m", ...over };
  return state;
}

// --- pure core --------------------------------------------------------------------------------

test("the pure core counts sources, tests, ratio, longest and over-300 from a plain list", () => {
  const files = [
    { path: "src/a.ts", lineCount: 10 },
    { path: "src/b.ts", lineCount: 301 },
    { path: "src/c.ts", lineCount: 301 },
    { path: "test/a.test.js", lineCount: 5 },
    { path: "README.md", lineCount: 2 },
  ];
  const { facts, evidence } = buildRepoMap(files);

  assert.equal(facts.fileCount, 5);
  assert.equal(facts.sourceFileCount, 3);
  assert.equal(facts.testFileCount, 1);
  assert.equal(facts.testToSourceRatio, 0.33, "1/3 rounds to two decimals");
  assert.equal(facts.filesOver300Lines, 2);
  // A tie resolves to the lexicographically first path.
  assert.deepEqual(facts.longestFile, { path: "src/b.ts", lines: 301 });
  assert.equal(facts.medianFileLines, 10);
  assert.match(evidence.join("\n"), /repo: 5 file\(s\) tracked by structure \(3 source, 1 test, ratio 0\.33\)/);
  assert.match(evidence.join("\n"), /repo: longest file src\/b\.ts at 301 lines/);
});

test("no sources means ratio 0, not a division by zero", () => {
  const { facts } = buildRepoMap([{ path: "README.md", lineCount: 3 }]);
  assert.equal(facts.sourceFileCount, 0);
  assert.equal(facts.testToSourceRatio, 0);
});

test("a test named *.test.ts is a test, not a source", () => {
  assert.equal(defaultIsSource("src/a.test.ts"), false);
  assert.equal(defaultIsSource("src/a.ts"), true);
});

// --- the walk ---------------------------------------------------------------------------------

test("the fixture walk yields exact counts, the longest file and the slice layout", () => {
  const root = fixture();
  const { files, skippedLarge } = collectRepoFiles(root);
  const { facts } = buildRepoMap(files, { skippedLarge });

  assert.equal(facts.fileCount, 6, ".git and node_modules are not counted");
  assert.equal(facts.sourceFileCount, 4);
  assert.equal(facts.testFileCount, 1);
  assert.equal(facts.testToSourceRatio, 0.25);
  assert.deepEqual(facts.longestFile, { path: "src/slices/one/index.ts", lines: 350 });
  assert.equal(facts.filesOver300Lines, 1);
  assert.equal(facts.medianFileLines, 11);
  assert.equal(skippedLarge, 0);
  // Paths are repo-relative and forward-slashed, whatever the platform separator is.
  assert.ok(files.every((file) => !file.path.includes("\\")));
  assert.ok(!files.some((file) => file.path.startsWith("node_modules/")));
  assert.ok(!files.some((file) => file.path.startsWith(".git/")));
  // Slice detection: `src` and `src/slices`, each with ≥ 2 subdirectories.
  assert.deepEqual(
    facts.sliceDirs.map((dir) => dir.path),
    ["src", "src/slices"],
  );
  assert.deepEqual(facts.topLevelDirs.map((dir) => dir.name), ["src", "test"]);
});

test("a file with no trailing newline still counts its last line", () => {
  const root = temp("psych-map-nonl-");
  writeFileSync(join(root, "a.ts"), "one\ntwo\nthree");
  const { files } = collectRepoFiles(root);
  assert.equal(files.find((file) => file.path === "a.ts").lineCount, 3);
});

test("a symlink to the temp dir is never followed, so nothing outside cwd is read", (t) => {
  const root = fixture();
  const outside = temp("psych-map-outside-");
  writeLines(join(outside, "secret.ts"), 7);
  try {
    symlinkSync(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  } catch {
    t.skip("symlink creation not permitted on this platform");
    return;
  }
  const { files } = collectRepoFiles(root);
  assert.ok(!files.some((file) => file.path.includes("secret")), "a file outside cwd leaked in");
  assert.ok(!files.some((file) => file.path.startsWith("linked/")), "the symlink was followed");
});

test("a file over 20000 lines is skippedLarge and never the longest file", () => {
  const root = temp("psych-map-big-");
  writeLines(join(root, "big.ts"), 20001);
  writeLines(join(root, "small.ts"), 4);
  const { files, skippedLarge } = collectRepoFiles(root);
  const { facts } = buildRepoMap(files, { skippedLarge });

  assert.equal(skippedLarge, 1);
  assert.deepEqual(facts.longestFile, { path: "small.ts", lines: 4 });
  assert.ok(!files.some((file) => file.path === "big.ts"));
});

test("the file cap stops the walk", () => {
  const root = temp("psych-map-cap-");
  for (let i = 0; i < 5; i += 1) writeLines(join(root, `f${i}.ts`), 3);
  const { files } = collectRepoFiles(root, defaultMapperIo(), { maxFiles: 3 });
  assert.equal(files.length, 3);
});

// --- eligibility, caching and staleness -------------------------------------------------------

test("mapRepo:false yields no map at all", () => {
  const state = stateWithMap({ mapRepo: false });
  assert.equal(ensureRepoMap(state, fixture(), { gitRoot: () => "/repo" }), undefined);
  assert.deepEqual(repoMapEvidenceLines(state, "/repo", { gitRoot: () => "/repo" }), []);
  assert.equal(repoMapReport(state, "/repo", { gitRoot: () => "/repo" }).unavailable, true);
});

test("cwd outside a git work tree is unavailable, not empty", () => {
  const state = stateWithMap();
  const report = repoMapReport(state, "/not/a/repo", { gitRoot: () => undefined });
  assert.equal(report.unavailable, true);
  assert.deepEqual(report.lines, []);
});

test("a missing git binary falls back to cwd and still maps", () => {
  const state = stateWithMap();
  const root = fixture();
  const report = repoMapReport(state, root, { gitRoot: () => null });
  assert.equal(report.unavailable, false);
  assert.ok(report.lines.some((line) => line.includes("over 300 lines")));
});

test("the map is computed once and reused across ten turns", () => {
  const state = stateWithMap();
  const root = fixture();
  let collects = 0;
  const deps = {
    gitRoot: () => root,
    collect: (...args) => {
      collects += 1;
      return collectRepoFiles(...args);
    },
  };
  for (let turn = 0; turn < 10; turn += 1) {
    state.turnCount = turn;
    assert.ok(repoMapEvidenceLines(state, root, deps).length > 0);
  }
  assert.equal(collects, 1, "the tree was walked exactly once");
});

test("a map older than MAP_STALE_TURNS turns is shown as stale", () => {
  const state = stateWithMap();
  const root = fixture();
  state.turnCount = 5;
  const computed = repoMapReport(state, root, { gitRoot: () => root });
  assert.equal(computed.ageTurns, 0);

  state.turnCount = 5 + MAP_STALE_TURNS + 5;
  const stale = repoMapReport(state, root, { gitRoot: () => root });
  assert.equal(stale.ageTurns, MAP_STALE_TURNS + 5);

  const text = renderReport({
    state,
    signals: [],
    history: [],
    lang: "en",
    mapLines: stale.lines,
    mapUnavailable: false,
    mapAgeTurns: stale.ageTurns,
  });
  assert.match(text, new RegExp(`map age: ${MAP_STALE_TURNS + 5} turn\\(s\\)`));
});

test("a fresh map has no age line", () => {
  const state = stateWithMap();
  const text = renderReport({
    state,
    signals: [],
    history: [],
    lang: "en",
    mapLines: ["repo: 1 file(s) tracked by structure (1 source, 0 test, ratio 0.00)"],
    mapUnavailable: false,
    mapAgeTurns: MAP_STALE_TURNS,
  });
  assert.doesNotMatch(text, /map age:/);
});

// --- evidence, prompt and enforcement ---------------------------------------------------------

test("the repo lines reach the prompt AND allowedEvidence, and a citation to them survives", async () => {
  const REPO_LINE = "repo: 6 file(s) tracked by structure (4 source, 1 test, ratio 0.25)";
  const pi = makePi();
  const state = stateWithMap({ trigger: "signals", cadenceTurns: 1 });
  state.turnsSinceAppraisal = 3;
  let captured;
  const deps = {
    readHistory: () => ({ evidence: ["session span: 1 min"] }),
    callModel: async (_registry, req) => {
      captured = req;
      return {
        ok: true,
        text: JSON.stringify({
          needs: {
            autonomy: { state: "at_risk", cited: [REPO_LINE] },
            competence: { state: "unmet", cited: [REPO_LINE] },
            relatedness: { state: "met", cited: [REPO_LINE] },
          },
          load: { level: "high", cited: [REPO_LINE] },
          progress: { state: "blocked", cited: [REPO_LINE] },
          flow: { state: "broken", cited: [REPO_LINE] },
          interventions: [],
        }),
        provider: "p",
        modelId: "m",
        label: "p/m",
        usage: undefined,
      };
    },
    deliver: async () => ({ human: "none", agent: false, reason: "silent" }),
    repoMap: () => [REPO_LINE],
  };
  const outcome = await maybeAppraise(pi, state, makeCtx(), deps, { force: true });

  assert.equal(outcome.ran, true);
  assert.ok(captured.evidence.sessionLines.includes(REPO_LINE), "the line reached the SESSION block");
  assert.match(captured.userText, new RegExp(`- ${REPO_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.ok(
    allowedEvidence(captured.evidence.liveLines, captured.evidence.sessionLines).includes(REPO_LINE),
    "the line is admissible evidence",
  );
  assert.deepEqual(outcome.unmatched, [], "citing the repo line is not an unmatched citation");
  assert.deepEqual(outcome.downgraded, []);
});

// --- report rendering -------------------------------------------------------------------------

test("the Repo map section renders and stays within a narrow width (en + cs)", () => {
  const state = stateWithMap();
  const long = "repo: top-level directories: src (120), test (40), docs (18), scripts (9), tools (4)";
  for (const lang of ["en", "cs"]) {
    const text = renderReport({
      state,
      signals: [],
      history: [],
      lang,
      mapLines: [long, "repo: median file 11 lines"],
      mapUnavailable: false,
      width: 40,
    });
    const heading = lang === "en" ? "Repo map" : "Mapa repa";
    assert.match(text, new RegExp(heading));
    for (const line of text.split("\n")) {
      assert.ok(visibleWidth(line) <= 40, `line over mocked width (${lang}): ${JSON.stringify(line)}`);
    }
  }
});

test("an unavailable map is stated in the report, not rendered as empty", () => {
  const state = stateWithMap();
  const en = renderReport({ state, signals: [], history: [], lang: "en", mapLines: [], mapUnavailable: true });
  assert.match(en, /repo map unavailable/);
  const cs = renderReport({ state, signals: [], history: [], lang: "cs", mapLines: [], mapUnavailable: true });
  assert.match(cs, /mapa repa nedostupná/);
});
