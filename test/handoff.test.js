/**
 * Handoff (idea 2) — the zero-token ledger written at shutdown and offered once at the next start.
 *
 * The ledger is arithmetic over the session's own record; the tests pin its exact shape, the two
 * silences (a session that never appraised, config off) and the "and not again" of the offer.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import { HANDOFF_ENTRY, HANDOFF_NOTIFIED_ENTRY } from "../src/shared/handoff.js";
import { registerHandoff } from "../src/slices/handoff/index.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

const T0 = 1_700_000_000_000;

function history(userCheckpoints = []) {
  return { userCheckpoints };
}

function wire(over = {}) {
  const pi = makePi();
  const state = makeState({ config: { ...DEFAULT_CONFIG, ...over } });
  registerHandoff(pi, state, { readHistory: () => history(["bookmark-a", "bookmark-b"]) });
  return { pi, state };
}

/** Two tool calls (one failure) and one delivered-but-unresolved intervention. */
function seedSession(state) {
  state.appraisalsThisSession = 1;
  state.observations = [
    { kind: "tool", at: T0, toolName: "bash", command: "npm test", ok: false, errorSignature: "test_failure" },
    { kind: "tool", at: T0 + 1, toolName: "edit", path: "a.ts", ok: true },
  ];
  state.outcomes = [
    { id: "1", kind: "thin_slice", deliveredAtTurn: 1, channel: "card", before: {}, text: "x" },
    { id: "2", kind: "stop", deliveredAtTurn: 2, channel: "card", before: {}, text: "y", verdicts: {} },
  ];
}

function entriesOf(pi, customType) {
  return pi.entries.filter((entry) => entry.type === "custom" && entry.customType === customType);
}

test("shutdown writes the exact ledger shape as a custom entry", async () => {
  const { pi, state } = wire();
  seedSession(state);
  await pi.emit("session_shutdown", {}, makeCtx());
  const [entry] = entriesOf(pi, HANDOFF_ENTRY);
  assert.ok(entry, "a handoff entry was written");
  assert.deepEqual(entry.data, {
    unverifiedMutations: 1,
    lastFailure: { tool: "bash", signature: "test_failure" },
    bookmarks: 2,
    openLoops: 1,
    toolCalls: 2,
    failures: 1,
  });
  assert.ok(pi.entries.every((e) => e.type === "custom"), "never a message entry");
});

test("a session that never appraised writes nothing", async () => {
  const { pi, state } = wire();
  seedSession(state);
  state.appraisalsThisSession = 0;
  await pi.emit("session_shutdown", {}, makeCtx());
  assert.deepEqual(pi.entries, []);
});

test("handoff off writes nothing and offers nothing", async () => {
  const { pi, state } = wire({ handoff: false });
  seedSession(state);
  await pi.emit("session_shutdown", {}, makeCtx());
  assert.deepEqual(pi.entries, []);
  const ctx = makeCtx({ sessionManager: { getEntries: () => [{ type: "custom", customType: HANDOFF_ENTRY, data: {} }] } });
  await pi.emit("session_start", {}, ctx);
  assert.deepEqual(ctx.notes, []);
});

test("the next session_start notifies once, and not again", async () => {
  const { pi, state } = wire();
  seedSession(state);
  await pi.emit("session_shutdown", {}, makeCtx());
  const ctx = makeCtx({ sessionManager: { getEntries: () => pi.entries } });
  await pi.emit("session_start", {}, ctx);
  assert.equal(ctx.notes.length, 1);
  assert.match(ctx.notes[0].message, /Last session: 1 unverified change\(s\), 1 open loop\(s\), 2 bookmark\(s\), 1 failing tool\(s\)\./);
  // The marker is written with the offer, so the second start stays silent.
  assert.equal(entriesOf(pi, HANDOFF_NOTIFIED_ENTRY).length, 1);
  await pi.emit("session_start", {}, ctx);
  assert.equal(ctx.notes.length, 1);
});

test("no handoff entry means no offer (a fresh first session)", async () => {
  const { pi } = wire();
  const ctx = makeCtx();
  await pi.emit("session_start", {}, ctx);
  assert.deepEqual(ctx.notes, []);
});

test("the notification line is localized", async () => {
  const { pi, state } = wire({ lang: "cs" });
  seedSession(state);
  await pi.emit("session_shutdown", {}, makeCtx());
  const ctx = makeCtx({ sessionManager: { getEntries: () => pi.entries } });
  await pi.emit("session_start", {}, ctx);
  assert.match(ctx.notes[0].message, /Poslední relace:/);
});
