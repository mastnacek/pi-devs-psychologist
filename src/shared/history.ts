/**
 * history — the STRUCTURAL record of a session, folded from its own entries.
 *
 * The live observation window (`signals.ts`) sees the last few minutes as events.
 * This sees the whole session as a *record*: what the operator declared it was
 * for, how often they cancelled, which model they walked away from, how much
 * context had to be thrown away, which approaches were abandoned, and how long
 * they had to wait.
 *
 * Those are exactly the facts the live window cannot see, and they are the ones
 * a psychologist would ask for first. Crucially they are all arithmetic over
 * entries the engine already wrote — nothing here is inferred, sampled or guessed.
 *
 * Three of these signals deserve their prominence, because each is a *human
 * decision* rather than a machine event, and human decisions are the ground truth
 * this plugin otherwise lacks:
 *
 * - `abortedTurns` — `stopReason: "aborted"` means the operator pressed stop.
 *   That is the strongest evidence of frustration the engine can give us, and it
 *   is a literal field rather than a sentiment score.
 * - `userCheckpoints` — `/label`. The operator marking an entry is the only
 *   *explicit* statement in a session about where the value was.
 * - `thinkingRaises` — the operator deciding this needs more thinking. Their own
 *   difficulty calibration, which no model should be guessing at.
 *
 * DATA BOUNDARY: this fold reads counts, names and timestamps. It deliberately
 * does NOT extract system-prompt sections, skill manifests, tool declarations or
 * message bodies. Those are the session's largest and most sensitive payload, and
 * none of them may reach a second model through this plugin — see PRD §4.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, ModelThinkingLevel, Usage } from "@earendil-works/pi-ai";
import { median } from "./signals.js";
import { describeHistory } from "./history-evidence.js";

/** Thinking levels from least to most effort, per `ModelThinkingLevel`. */
export const THINKING_ORDER: readonly ModelThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

export interface SessionHistory {
	/** First and last entry timestamps, ms. Undefined for an empty branch. */
	startedAt: number | undefined;
	lastAt: number | undefined;
	windowMs: number;
	/** The operator's declared purpose for this session (`/name`), if any. */
	declaredIntent: string | undefined;
	/** Distinct models seen on this branch, in order, as `provider/modelId`. */
	modelsUsed: string[];
	/** `model_change` entries: the operator rejected the model they were on. */
	modelSwitches: number;
	/** Thinking-level changes that increased effort — the operator's own call. */
	thinkingRaises: number;
	/** Thinking-level changes that decreased effort. */
	thinkingLowers: number;
	/** Turns the operator cancelled (`stopReason: "aborted"`). */
	abortedTurns: number;
	/** Turns that ended in a provider error. */
	errorTurns: number;
	/** Turns cut off by the output limit. */
	truncatedTurns: number;
	/** Compactions on this branch. */
	compactions: number;
	/** Compactions the engine decided on its own, rather than an extension. */
	engineCompactions: number;
	/** Largest context that forced a compaction, in tokens. */
	peakTokensBeforeCompaction: number;
	/** Approaches walked away from via `/tree` (each has a branch summary). */
	abandonedBranches: number;
	/** Context edits that removed an earlier entry from model context. */
	contextRemovals: number;
	/** Context edits that rewrote an earlier entry's content. */
	contextReplacements: number;
	/** Labels still set at the end of the branch — the operator's own marks. */
	userCheckpoints: string[];
	/** Wait from a user message to the next assistant message, ms. */
	medianHumanWaitMs: number;
	longestHumanWaitMs: number;
	/**
	 * Prompt-cache read share over assistant and tool-result usage, 0..1.
	 * Undefined when the session recorded no usage. Cache-warming usage entries
	 * are excluded on purpose: they are an engine optimisation, not turn cost.
	 */
	cacheHitRate: number | undefined;
	/** Factual one-liners. The only history text a model may read. */
	evidence: string[];
}

function usageOf(value: unknown): Usage | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const usage = value as Partial<Usage>;
	return typeof usage.totalTokens === "number" ? (usage as Usage) : undefined;
}

/** Merge one usage record into the cache-ratio accumulators. */
function addCacheUsage(
	usage: Usage | undefined,
	acc: { input: number; cacheRead: number; cacheWrite: number },
): void {
	if (!usage) return;
	acc.input += usage.input ?? 0;
	acc.cacheRead += usage.cacheRead ?? 0;
	acc.cacheWrite += usage.cacheWrite ?? 0;
}

function parseTime(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Earliest and latest parseable entry timestamps.
 *
 * Scanned rather than read from the first and last entries on purpose: a single
 * malformed timestamp anywhere in the tail would otherwise collapse the session
 * span to zero and quietly under-report the session's length.
 */
function span(entries: readonly SessionEntry[]): { first: number | undefined; last: number | undefined } {
	let first: number | undefined;
	let last: number | undefined;
	for (const item of entries) {
		const at = parseTime(item.timestamp);
		if (at === undefined) continue;
		if (first === undefined || at < first) first = at;
		if (last === undefined || at > last) last = at;
	}
	return { first, last };
}

/**
 * Fold a session branch into its structural history.
 *
 * `entries` must be in branch order (what `sessionManager.getBranch()` returns).
 * Unknown entry types are ignored rather than rejected, matching the engine's own
 * contract for forward compatibility.
 */
export function foldHistory(entries: readonly SessionEntry[]): SessionHistory {
	const cache = { input: 0, cacheRead: 0, cacheWrite: 0 };
	const waits: number[] = [];
	/** targetId -> label. A later `label` entry on the same target overwrites. */
	const labels = new Map<string, string | undefined>();
	const models: string[] = [];

	let declaredIntent: string | undefined;
	let modelSwitches = 0;
	let thinkingRaises = 0;
	let thinkingLowers = 0;
	let abortedTurns = 0;
	let errorTurns = 0;
	let truncatedTurns = 0;
	let compactions = 0;
	let engineCompactions = 0;
	let peakTokensBeforeCompaction = 0;
	let abandonedBranches = 0;
	let contextRemovals = 0;
	let contextReplacements = 0;
	let previousThinking: ModelThinkingLevel | undefined;
	/** Timestamp of a user message still waiting for the assistant's reply. */
	let pendingPromptAt: number | undefined;

	for (const entry of entries) {
		switch (entry.type) {
			case "message": {
				const message = entry.message;
				if (message.role === "user") {
					// Only the first user message of a burst starts the clock; a queued
					// follow-up must not restart it and hide a long wait.
					if (pendingPromptAt === undefined) pendingPromptAt = message.timestamp;
					break;
				}
				if (message.role === "assistant") {
					const assistant = message as AssistantMessage;
					if (pendingPromptAt !== undefined && typeof assistant.timestamp === "number") {
						waits.push(Math.max(0, assistant.timestamp - pendingPromptAt));
						pendingPromptAt = undefined;
					}
					if (assistant.stopReason === "aborted") abortedTurns += 1;
					else if (assistant.stopReason === "error") errorTurns += 1;
					else if (assistant.stopReason === "length") truncatedTurns += 1;
					addCacheUsage(assistant.usage, cache);
					break;
				}
				if (message.role === "toolResult") {
					addCacheUsage(usageOf(message.usage), cache);
				}
				break;
			}
			case "model_change": {
				modelSwitches += 1;
				models.push(`${entry.provider}/${entry.modelId}`);
				break;
			}
			case "thinking_level_change": {
				const level = entry.thinkingLevel as ModelThinkingLevel;
				const to = THINKING_ORDER.indexOf(level);
				const from = previousThinking === undefined ? undefined : THINKING_ORDER.indexOf(previousThinking);
				// An unrecognised level is recorded as neither a raise nor a lower:
				// guessing its direction would invent an operator decision.
				if (from !== undefined && to !== -1) {
					if (to > from) thinkingRaises += 1;
					else if (to < from) thinkingLowers += 1;
				}
				if (to !== -1) previousThinking = level;
				break;
			}
			case "compaction": {
				compactions += 1;
				if (entry.fromHook !== true) engineCompactions += 1;
				const before = Number(entry.tokensBefore);
				if (Number.isFinite(before) && before > peakTokensBeforeCompaction) {
					peakTokensBeforeCompaction = before;
				}
				addCacheUsage(entry.usage, cache);
				break;
			}
			case "branch_summary": {
				abandonedBranches += 1;
				addCacheUsage(entry.usage, cache);
				break;
			}
			case "context_edit": {
				if (entry.replacement === null) contextRemovals += 1;
				else contextReplacements += 1;
				break;
			}
			case "label": {
				labels.set(entry.targetId, entry.label);
				break;
			}
			case "session_info": {
				if (typeof entry.name === "string" && entry.name.length > 0) declaredIntent = entry.name;
				break;
			}
			default:
				// Unknown entry type: ignored on purpose.
				break;
		}
	}

	const { first, last } = span(entries);
	const cached = cache.cacheRead;
	const promptTotal = cache.input + cached + cache.cacheWrite;

	const history: SessionHistory = {
		startedAt: first,
		lastAt: last,
		windowMs: first !== undefined && last !== undefined ? Math.max(0, last - first) : 0,
		declaredIntent,
		modelsUsed: models,
		modelSwitches,
		thinkingRaises,
		thinkingLowers,
		abortedTurns,
		errorTurns,
		truncatedTurns,
		compactions,
		engineCompactions,
		peakTokensBeforeCompaction,
		abandonedBranches,
		contextRemovals,
		contextReplacements,
		// A cleared label is a label the operator took back; only live ones count.
		userCheckpoints: [...labels.values()].filter(
			(label): label is string => typeof label === "string" && label.length > 0,
		),
		medianHumanWaitMs: Math.round(median(waits)),
		longestHumanWaitMs: waits.length === 0 ? 0 : Math.max(...waits),
		cacheHitRate: promptTotal > 0 ? cached / promptTotal : undefined,
		evidence: [],
	};
	history.evidence = describeHistory(history);
	return history;
}

/** Convenience: fold whatever branch the context is currently on. */
export function readHistory(ctx: { sessionManager: { getBranch(): SessionEntry[] } }): SessionHistory {
	return foldHistory(ctx.sessionManager.getBranch());
}