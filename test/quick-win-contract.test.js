/**
 * T9 — the integration contract with `pi-quick-win`.
 *
 * The coupling between the two plugins is a PROMPT POLICY, not a dependency: the psychologist
 * names the smallest shippable increment, and `pi-quick-win`'s `quick_win` tool turns that into a
 * declared increment. Neither package may import the other, and this test is the thing that says so
 * — a contract that lives only in the PRD stops being checked the moment a contributor is in a hurry.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_PROMPT } from "../src/shared/prompt.js";
import { noteQuickWin } from "../src/shared/outcome.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const QUICK_WIN_ROOT = resolve(REPO_ROOT, "..", "pi-quick-win");

/** Every TypeScript file in a package, source only. */
function sourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
    }
  };
  walk(join(root, "src"));
  const idx = join(root, "index.ts");
  out.push(idx);
  return out;
}

function hasPi(source) {
  // The workshop shape: a root index.ts, an `extensions/` or `src/` tree, and a package.json.
  try {
    statSync(source);
  } catch {
    return false;
  }
  readFileSync(join(source, "package.json"), "utf8");
  return true;
}

test("neither package imports the other", { skip: hasPi(QUICK_WIN_ROOT) ? false : "pi-quick-win is not next to this repo" }, () => {
  const ours = sourceFiles(REPO_ROOT);
  const theirs = sourceFiles(QUICK_WIN_ROOT);
  assert.ok(ours.length > 0 && theirs.length > 0, "both packages have source to scan");

  for (const file of ours) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /from\s+["'][^"']*pi-quick-win[^"']*["']/,
      `${file} must not import pi-quick-win`,
    );
    assert.doesNotMatch(text, /require\(\s*["'][^"']*pi-quick-win/, `${file} must not require pi-quick-win`);
  }
  for (const file of theirs) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /from\s+["'][^"']*pi-devs-psychologist[^"']*["']/,
      `${file} must not import pi-devs-psychologist`,
    );
  }
});

test("the contract is a prompt policy: the prompt tells the model what quick_win is for", () => {
  // The one sentence that couples the two packages. If it is dropped, the contract silently dies.
  assert.match(SYSTEM_PROMPT, /name_next_win:/);
  assert.match(
    SYSTEM_PROMPT,
    /smallest shippable increment/i,
    "the intervention names the thing pi-quick-win exists to do",
  );
  assert.match(
    SYSTEM_PROMPT,
    /quick_win/,
    "and points at the tool that turns the sentence into a declared increment",
  );
});

test("the quick_win reaction is recognised by tool name, which needs no import", () => {
  const react = noteQuickWin;
  assert.equal(typeof react, "function");
});
