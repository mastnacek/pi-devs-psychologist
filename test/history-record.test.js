/**
 * T10 — the opt-in cross-session delivery record.
 *
 * The hard rule this suite exists to defend: the record stores delivery events and session COUNTS
 * and nothing else. So the assertions are the boundary itself — the exact key set of each line kind,
 * the absence of a prompt string that was in the session, and the absence of every prohibited word
 * from the report. If a future field would cross that line, one of these fails.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import {
	appendHistory,
	deliveryVerdict,
	historyFilePath,
	readHistory,
	summarizeHistory,
} from "../src/shared/history-store.js";
import { stringsFor } from "../src/shared/i18n.js";
import { historyReport, registerHistory, writeHistory } from "../src/slices/history/index.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

const T0 = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SESSION_KEYS = ["at", "failures", "toolCalls", "turns", "unverifiedMutations", "verifiedRuns"];
const DELIVERY_KEYS = ["at", "followed", "kind", "verdict"];

// PRD §5, verbatim: the words the report of a person-level record would be built from.
/** A session-manager stand-in carrying only the identity the write-once guard reads. */
const SESSION_A = "aaaaaaaa-1111";
const SESSION_B = "bbbbbbbb-2222";
function sessionManager(id) {
	return { getSessionId: () => id, getSessionFile: () => `/tmp/${id}.jsonl` };
}

const PROHIBITED = ["score", "streak", "productivity", "efficiency", "burnout", "fatigue", "stress", "diagnosis", "trend", "improve-you", "keep-going"];

/** A temp project directory that becomes `cwd`. */
function project() {
	const dir = mkdtempSync(join(tmpdir(), "psych-history-"));
	return { dir, record: join(dir, ".pi", "psych-history", "history.jsonl"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** State with `history` turned on or off. */
function stateWith(over = {}, history = {}) {
	return makeState({
		config: {
			...DEFAULT_CONFIG,
			...over,
			history: { ...DEFAULT_CONFIG.history, ...history },
		},
	});
}

/** A session record: two tool calls (one failure), one delivered intervention, one open loop. */
function seed(state) {
	state.appraisalsThisSession = 1;
	state.turnCount = 3;
	state.observations = [
		{ kind: "prompt", at: T0, text: "SECRET_PROMPT_STRING_THAT_MUST_NOT_BE_STORED" },
		{ kind: "tool", at: T0 + 1, toolName: "edit", path: "src/a.ts", ok: true },
		{ kind: "tool", at: T0 + 2, toolName: "bash", command: "npm test", ok: false, errorSignature: "test_failure" },
	];
	state.outcomes = [
		{
			id: "1",
			kind: "thin_slice",
			deliveredAtTurn: 1,
			channel: "card",
			before: {},
			text: "do the small thing",
			followed: true,
			verdicts: { failureRate: "improved", turnsSinceVerifiedProgress: "unchanged", restatements: "unchanged", aborts: "unchanged" },
		},
		{ id: "2", kind: "stop", deliveredAtTurn: 2, channel: "card", before: {}, text: "rest" },
	];
}

function linesOf(path) {
	return readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
}

// --- the off path -------------------------------------------------------------------------

test("off: nothing is written, and the command says so", () => {
	const p = project();
	try {
		const state = stateWith({}, { enabled: false });
		seed(state);
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_A) });
		assert.equal(existsSync(p.record), false, "nothing on disk");
		assert.equal(existsSync(join(p.dir, ".pi")), false, "not even the directory");

		const ctx = makeCtx({ cwd: p.dir });
		assert.equal(historyReport(state, ctx), stringsFor("en").historyOff);
		assert.deepEqual(ctx.notes, [], "no modal, no table: one line");
	} finally {
		p.cleanup();
	}
});

// --- the on path --------------------------------------------------------------------------

test("on: one session line and one delivery line per delivered intervention", () => {
	const p = project();
	try {
		const state = stateWith({}, { enabled: true });
		seed(state);
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_A) });

		const lines = linesOf(p.record);
		assert.equal(lines.length, 3, "one session + two deliveries");
		assert.equal(lines.filter((line) => !("kind" in line)).length, 1);
		assert.equal(lines.filter((line) => "kind" in line).length, 2);

		const [session] = lines.filter((line) => !("kind" in line));
		assert.deepEqual(Object.keys(session).sort(), SESSION_KEYS, "the exact session key set");
		assert.equal(session.turns, 3);
		assert.equal(session.toolCalls, 2);
		assert.equal(session.failures, 1);
		assert.equal(session.verifiedRuns, 0);
		assert.equal(session.unverifiedMutations, 1);
		assert.equal(typeof session.at, "number");
	} finally {
		p.cleanup();
	}
});

test("the delivery key set is exact, and verdicts carry the four-way value", () => {
	const p = project();
	try {
		const state = stateWith({}, { enabled: true });
		seed(state);
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_A) });
		const deliveries = linesOf(p.record).filter((line) => "kind" in line);
		for (const line of deliveries) assert.deepEqual(Object.keys(line).sort(), DELIVERY_KEYS);
		assert.deepEqual(
			deliveries.map((line) => [line.kind, line.verdict, line.followed]),
			[
				["thin_slice", "improved", true],
				["stop", "unresolved", false],
			],
		);
	} finally {
		p.cleanup();
	}
});

test("a prompt string present in the session appears nowhere in the file", () => {
	const p = project();
	try {
		const state = stateWith({}, { enabled: true });
		seed(state);
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_A) });
		const text = readFileSync(p.record, "utf8");
		assert.doesNotMatch(text, /SECRET_PROMPT_STRING_THAT_MUST_NOT_BE_STORED/, "the data boundary holds end to end");
		// And no key the boundary forbids is smuggled in.
		for (const line of linesOf(p.record)) {
			for (const forbidden of ["text", "prompt", "path", "tool", "toolName", "model", "sessionId", "score", "rate"]) {
				assert.equal(forbidden in line, false, `${forbidden} must never be stored`);
			}
		}
	} finally {
		p.cleanup();
	}
});

test("a reload between two shutdowns still writes one session line", async () => {
	// The case the boolean flag got wrong. `session_shutdown` fires on reload AND on exit, and the
	// reload's `session_start` calls `resetWindow()` — which cleared the old boolean, so every
	// session was written twice in production while the direct double-call test passed. Driving the
	// reset here is the only way the test can fail on the old code.
	const p = project();
	try {
		const state = stateWith({}, { enabled: true });
		seed(state);
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_A) });
		state.resetWindow();
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_A) });
		const lines = linesOf(p.record);
		assert.equal(lines.filter((line) => !("kind" in line)).length, 1, "one session line, not two");
	} finally {
		p.cleanup();
	}
});

test("a genuinely new session is written again, and a new id is the difference", () => {
	const p = project();
	try {
		const state = stateWith({}, { enabled: true });
		seed(state);
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_A) });
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_B) });
		assert.equal(linesOf(p.record).filter((line) => !("kind" in line)).length, 2, "two sessions, two lines");
	} finally {
		p.cleanup();
	}
});

test("a second shutdown on the same session does not write the record twice", () => {
	const p = project();
	try {
		const state = stateWith({}, { enabled: true });
		seed(state);
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_A) });
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_A) });
		const lines = linesOf(p.record);
		assert.equal(lines.filter((line) => !("kind" in line)).length, 1, "one session line");
		assert.equal(lines.filter((line) => "kind" in line).length, 2, "one delivery line each, not doubled");
	} finally {
		p.cleanup();
	}
});

test("two sessions in one project append to one file", () => {
	const p = project();
	try {
		const first = stateWith({}, { enabled: true });
		seed(first);
		writeHistory(first, { cwd: p.dir });
		const second = stateWith({}, { enabled: true });
		seed(second);
		writeHistory(second, { cwd: p.dir });
		const sessions = linesOf(p.record).filter((line) => !("kind" in line));
		assert.equal(sessions.length, 2);
	} finally {
		p.cleanup();
	}
});

test("two projects keep separate files", () => {
	const a = project();
	const b = project();
	try {
		const sa = stateWith({}, { enabled: true });
		seed(sa);
		writeHistory(sa, { cwd: a.dir });
		const sb = stateWith({}, { enabled: true });
		seed(sb);
		writeHistory(sb, { cwd: b.dir });
		assert.equal(linesOf(a.record).filter((line) => !("kind" in line)).length, 1);
		assert.equal(linesOf(b.record).filter((line) => !("kind" in line)).length, 1);
		assert.notEqual(a.record, b.record);
	} finally {
		a.cleanup();
		b.cleanup();
	}
});

test("registerHistory writes on session_shutdown", async () => {
	const p = project();
	try {
		const pi = makePi();
		const state = stateWith({}, { enabled: true });
		seed(state);
		registerHistory(pi, state);
		await pi.emit("session_shutdown", {}, makeCtx({ cwd: p.dir }));
		assert.ok(existsSync(p.record), "the shutdown event wrote the record");
	} finally {
		p.cleanup();
	}
});

// --- retention, corruption, reads ---------------------------------------------------------

test("retention drops an old line on read and the rewrite removes it", () => {
	const p = project();
	try {
		mkdirSync(join(p.dir, ".pi", "psych-history"), { recursive: true });
		const now = T0;
		const old = { at: now - 200 * DAY_MS, turns: 1, toolCalls: 0, failures: 0, verifiedRuns: 0, unverifiedMutations: 0 };
		const fresh = { at: now, turns: 2, toolCalls: 0, failures: 0, verifiedRuns: 0, unverifiedMutations: 0 };
		writeFileSync(p.record, [old, fresh].map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");

		const read = readHistory(p.record, { retentionDays: 90, now });
		assert.equal(read.lines.length, 1, "the old line is skipped");
		assert.equal(read.dropped, 1);

		// The rewrite at the next append removes it for good.
		appendHistory(p.record, [fresh], { retentionDays: 90, now });
		assert.equal(readFileSync(p.record, "utf8").includes(String(old.at)), false, "the expired line is gone");
	} finally {
		p.cleanup();
	}
});

test("a corrupted line is skipped, not fatal", () => {
	const p = project();
	try {
		mkdirSync(join(p.dir, ".pi", "psych-history"), { recursive: true });
		const good = { at: T0, turns: 1, toolCalls: 0, failures: 0, verifiedRuns: 0, unverifiedMutations: 0 };
		writeFileSync(p.record, ["{ not json", JSON.stringify(good), JSON.stringify({ at: T0, extra: 1 })].join("\n") + "\n", "utf8");
		const read = readHistory(p.record, { retentionDays: 90, now: T0 });
		assert.equal(read.lines.length, 1, "the good line survives");
		assert.equal(read.dropped, 2, "the garbage and the wrong-key line are both dropped");
	} finally {
		p.cleanup();
	}
});

test("a read never creates the file or the directory", () => {
	const p = project();
	try {
		const read = readHistory(p.record, { retentionDays: 90, now: T0 });
		assert.deepEqual(read, { lines: [], dropped: 0 });
		assert.equal(existsSync(join(p.dir, ".pi")), false, "the read created nothing");
	} finally {
		p.cleanup();
	}
});

// --- the report ---------------------------------------------------------------------------

test("the report names the file path and its verdict split", () => {
	const p = project();
	try {
		const state = stateWith({}, { enabled: true });
		seed(state);
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_A) });
		const ctx = makeCtx({ cwd: p.dir });
		assert.equal(historyReport(state, ctx), "", "the table is shown by the slice itself");
		const text = ctx.notes[0].message;
		assert.match(text, new RegExp(p.record.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the path is named");
		assert.match(text, /delete this file to erase the record/);
		assert.match(text, /sessions recorded: 1/);
		assert.match(text, /thin_slice/);
		// No line reaches past a narrow terminal.
		assert.ok(text.split("\n").every((line) => line.length <= 200));
	} finally {
		p.cleanup();
	}
});

test("the report contains none of the PRD §5 prohibited words", () => {
	const p = project();
	try {
		const state = stateWith({}, { enabled: true });
		seed(state);
		writeHistory(state, { cwd: p.dir, sessionManager: sessionManager(SESSION_A) });
		const ctx = makeCtx({ cwd: p.dir });
		historyReport(state, ctx);
		const lower = ctx.notes[0].message.toLowerCase();
		for (const word of PROHIBITED) assert.equal(lower.includes(word), false, `report must not say "${word}"`);
	} finally {
		p.cleanup();
	}
});

test("every line dropped, and no verdicts, are reported, not rendered as an empty table", () => {
	const p = project();
	try {
		const now = T0;
		mkdirSync(join(p.dir, ".pi", "psych-history"), { recursive: true });
		const old = { at: now - 200 * DAY_MS, turns: 1, toolCalls: 0, failures: 0, verifiedRuns: 0, unverifiedMutations: 0 };
		writeFileSync(p.record, JSON.stringify(old) + "\n", "utf8");
		const state = stateWith({}, { enabled: true });
		state.config.history.retentionDays = 90;
		const ctx = makeCtx({ cwd: p.dir });
		historyReport(state, ctx);
		assert.match(ctx.notes[0].message, /every recorded line was dropped/);
	} finally {
		p.cleanup();
	}
});

test("the report is headless-safe: no UI returns the terminal line", () => {
	const p = project();
	try {
		const state = stateWith({}, { enabled: true });
		seed(state);
		const line = historyReport(state, makeCtx({ cwd: p.dir, hasUI: false }));
		assert.equal(line, stringsFor("en").notTui);
	} finally {
		p.cleanup();
	}
});

// --- pure helpers -------------------------------------------------------------------------

test("deliveryVerdict collapses a closed window by majority, and unresolved when it never closed", () => {
	assert.equal(deliveryVerdict({}), "unresolved");
	assert.equal(
		deliveryVerdict({ verdicts: { failureRate: "improved", turnsSinceVerifiedProgress: "improved", restatements: "unchanged", aborts: "worse" } }),
		"improved",
	);
	assert.equal(
		deliveryVerdict({ verdicts: { failureRate: "worse", turnsSinceVerifiedProgress: "worse", restatements: "improved", aborts: "unchanged" } }),
		"worse",
	);
	assert.equal(
		deliveryVerdict({ verdicts: { failureRate: "improved", turnsSinceVerifiedProgress: "worse", restatements: "unchanged", aborts: "unchanged" } }),
		"unchanged",
	);
});

test("historyFilePath uses the default under the project and honours the override", () => {
	assert.equal(historyFilePath("/proj", ""), join("/proj", ".pi", "psych-history", "history.jsonl"));
	assert.equal(historyFilePath("/proj", "  /custom/x.jsonl "), "/custom/x.jsonl");
});

test("summarizeHistory counts sessions, the date range and the per-kind split", () => {
	const summary = summarizeHistory([
		{ at: T0, turns: 1, toolCalls: 0, failures: 0, verifiedRuns: 0, unverifiedMutations: 0 },
		{ at: T0 + 10, kind: "thin_slice", verdict: "improved", followed: true },
		{ at: T0 + 20, kind: "thin_slice", verdict: "worse", followed: false },
		{ at: T0 + 30, kind: "stop", verdict: "unresolved", followed: false },
	]);
	assert.equal(summary.sessions, 1);
	assert.equal(summary.deliveries, 3);
	assert.equal(summary.firstAt, T0);
	assert.equal(summary.lastAt, T0 + 30);
	assert.deepEqual(summary.byKind, [
		{ kind: "stop", improved: 0, unchanged: 0, worse: 0, unresolved: 1 },
		{ kind: "thin_slice", improved: 1, unchanged: 0, worse: 1, unresolved: 0 },
	]);
});
