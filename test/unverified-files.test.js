/**
 * Idea 5 — the per-file unverified changes in the handoff ledger.
 *
 * `unverifiedFilesSinceVerified` is arithmetic over the same observation window
 * `mutationsSinceVerified` counts: successful mutations of a mutation tool since the last
 * successful verification run, most-mutated first. These tests pin the ordering, the two things
 * that must NOT count (a failed mutation, a mutation before the verified run) and the cap.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { UNVERIFIED_FILES_CAP, unverifiedFilesSinceVerified } from "../src/shared/handoff.js";

const T0 = 1_700_000_000_000;

/** A successful mutation of `path`. */
function edit(path, ok = true, at = T0) {
  return { kind: "tool", at, toolName: "edit", path, ok };
}

/** A successful verification run (`npm test`). */
function verified(at = T0) {
  return { kind: "tool", at, toolName: "bash", command: "npm test", ok: true };
}

test("paths are returned in order, most-mutated first", () => {
  const log = [edit("a.ts"), edit("a.ts"), edit("b.ts"), edit("c.ts")];
  assert.deepEqual(unverifiedFilesSinceVerified(log), ["a.ts", "b.ts", "c.ts"]);
});

test("a file mutated twice outranks one mutated once", () => {
  // `b.ts` is touched first, `a.ts` twice after it: frequency beats recency.
  const log = [edit("b.ts"), edit("a.ts"), edit("a.ts")];
  assert.deepEqual(unverifiedFilesSinceVerified(log), ["a.ts", "b.ts"]);
});

test("a FAILED mutation is never counted", () => {
  const log = [edit("a.ts"), edit("b.ts", false), edit("b.ts", false)];
  assert.deepEqual(unverifiedFilesSinceVerified(log), ["a.ts"]);
});

test("a mutation before the last successful verified run is not unverified", () => {
  const log = [edit("old.ts"), verified(), edit("new.ts")];
  assert.deepEqual(unverifiedFilesSinceVerified(log), ["new.ts"]);
});

test("nothing unverified yields an empty list", () => {
  assert.deepEqual(unverifiedFilesSinceVerified([]), []);
  assert.deepEqual(unverifiedFilesSinceVerified([edit("a.ts"), verified()]), []);
});

test("at most UNVERIFIED_FILES_CAP paths are named", () => {
  const log = ["a", "b", "c", "d", "e"].map((name) => edit(`${name}.ts`));
  const files = unverifiedFilesSinceVerified(log);
  assert.equal(files.length, UNVERIFIED_FILES_CAP);
  assert.deepEqual(files, ["a.ts", "b.ts", "c.ts"]);
});

test("a mutation tool with no path contributes no name", () => {
  const log = [{ kind: "tool", at: T0, toolName: "write", ok: true }];
  assert.deepEqual(unverifiedFilesSinceVerified(log), []);
});
