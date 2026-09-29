/**
 * Flow shield (idea 6) — the plugin holds its own cards while it is telling the operator to protect
 * flow, releases them at the next pause, and drops them if the shield clears first.
 *
 * The chip is deliberately not part of the shield; it is one short line, not an interruption.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import {
	flushFlowShield,
	flowShieldActive,
	guardNotification,
	guardPresentation,
	refreshFlowShield,
} from "../src/shared/flow-shield.js";
import { resolveDueOutcomes, snapshotOutcome } from "../src/shared/outcome.js";
import { extractSignals } from "../src/shared/signals.js";
import { signalOptions } from "../src/shared/state.js";
import { registerAppraiser } from "../src/slices/appraiser/index.js";
import { recordDelivery } from "../src/slices/appraiser/ledger.js";
import { paintChip } from "../src/shared/status.js";
import { makeCtx, makePi, makeState } from "./fakes.js";

function stateWith(over = {}) {
	return makeState({ config: { ...DEFAULT_CONFIG, model: "a/b", ...over } });
}

function protectedOutcome(over = {}) {
	return {
		id: "p1",
		kind: "protect_flow",
		deliveredAtTurn: 0,
		channel: "card",
		before: { failureRate: 0, turnsSinceVerifiedProgress: 0, restatements: 0, aborts: 0 },
		text: "Protect the flow.",
		...over,
	};
}

test("refreshFlowShield: on only while a protect_flow intervention is unresolved", () => {
	const state = stateWith();
	assert.equal(flowShieldActive(state), false);
	state.outcomes = [protectedOutcome()];
	refreshFlowShield(state);
	assert.equal(flowShieldActive(state), true);
	// A resolved outcome lowers it.
	state.outcomes[0].verdicts = { failureRate: "unchanged" };
	refreshFlowShield(state);
	assert.equal(flowShieldActive(state), false);
	// Config off wins even with an unresolved protect_flow.
	state.outcomes = [protectedOutcome()];
	state.config = { ...state.config, flowShield: false };
	refreshFlowShield(state);
	assert.equal(flowShieldActive(state), false);
});

test("a delivered protect_flow intervention raises the shield through the ledger", () => {
	const pi = makePi();
	const state = stateWith();
	const signals = extractSignals(state.observations, signalOptions(state));
	recordDelivery(
		pi,
		state,
		signals,
		{ abortedTurns: 0 },
		{ kind: "protect_flow", text: "Protect the flow.", cited: [] },
		{ human: "card", agent: false },
		Date.now(),
	);
	assert.equal(flowShieldActive(state), true);
});

test("with the shield up the card is NOT presented; at the next agent_end it is", async () => {
	const pi = makePi();
	const state = stateWith();
	const deps = {
		readHistory: () => ({ abortedTurns: 0 }),
		deliver: async () => ({ human: "none", agent: false }),
		callModel: async () => ({ ok: false, stage: "config", error: "unused" }),
	};
	registerAppraiser(pi, state, deps);
	state.flowShield = true;

	let presented = false;
	const shown = await guardPresentation(state, async () => {
		presented = true;
		return true;
	});
	// Returning `true` means "held for later", so no notification fallback fires.
	assert.equal(shown, true);
	assert.equal(presented, false, "not presented while the shield is up");

	const ctx = makeCtx();
	await pi.emit("agent_end", {}, ctx);
	assert.equal(presented, true, "presented at the pause");
	// One release line, localized and counted.
	assert.equal(ctx.notes.length, 1);
	assert.match(ctx.notes[0].message, /released 1 held notice/);
});

test("a held notification flushes in order, and a cleared shield drops the queue", async () => {
	const state = stateWith();
	state.flowShield = true;
	const seen = [];
	guardNotification(state, () => seen.push("first"));
	guardNotification(state, () => seen.push("second"));
	assert.deepEqual(seen, []);
	await flushFlowShield(state, makeCtx());
	assert.deepEqual(seen, ["first", "second"]);

	// Cleared before the next pause: the queue is dropped, not replayed.
	state.flowShield = true;
	const dropped = [];
	guardNotification(state, () => dropped.push("x"));
	state.flowShield = false;
	await flushFlowShield(state, makeCtx());
	assert.deepEqual(dropped, []);
});

test("flowShield:false behaves as today: presentation happens immediately", async () => {
	const state = stateWith({ flowShield: false });
	let presented = false;
	const shown = await guardPresentation(state, async () => {
		presented = true;
		return true;
	});
	assert.equal(shown, true);
	assert.equal(presented, true);
});

test("the chip is unaffected by the shield", () => {
	const state = stateWith();
	state.flowShield = true;
	const ctx = makeCtx();
	paintChip(state, ctx);
	assert.equal(ctx.statusCalls.at(-1).text, "psych 0t · 0/12");
});

test("the flag clears on a resolved outcome and the queue is not replayed", () => {
	const state = stateWith();
	state.outcomes = [protectedOutcome()];
	refreshFlowShield(state);
	state.flowShieldQueue.push(async () => {});
	const snapshot = snapshotOutcome({ signals: extractSignals([], signalOptions(state)), history: { abortedTurns: 0 } });
	assert.equal(resolveDueOutcomes(state.outcomes, 10, 5, snapshot).length, 1);
	refreshFlowShield(state);
	assert.equal(flowShieldActive(state), false);
});
