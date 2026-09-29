/**
 * agent-context — the run-time consent decision for the child's session context (T28, T29).
 *
 * `agent.context` was chosen once, in the terminal, and persisted (T21). This module answers the
 * narrower question the run itself must answer, at the moment it runs:
 *
 * - `digest` is always possible — the excerpt is built from the current branch;
 * - `fork` needs a session FILE, and the file is read here rather than at `session_start` because
 *   an ephemeral (`--no-session`) parent has none and a session can gain one later;
 * - `fork` also needs the operator's consent, so the FIRST fork of a session shows a confirm that
 *   states what will leave the machine (the latest prompt size and its price at the child's rate);
 * - without a terminal to ask (RPC) or without a file, `fork` silently degrades to `digest` and
 *   says so once — it never falls back to the narrower `evidence`, because the operator already
 *   consented to more than that.
 *
 * The consent is per session: the operator answers once, and a decline holds for the rest of the
 * session. A consent that changed its mind every turn would be a prompt, not a consent.
 *
 * Pure except for the confirm/notify it is handed through the context; the estimate is a separate
 * exported function so the arithmetic can be tested without a session.
 */

import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { buildDigest } from "./digest.js";
import { effectiveAgentModel, type AgentContextLevel } from "./agent-config.js";
import { normalizeLocale, stringsFor } from "./i18n.js";
import { parseModelRef, resolveModel } from "./model-call.js";

/** The operator's answer to the fork confirm for this session. `unknown` before the first fork. */
export type ForkConsent = "unknown" | "approved" | "declined";

/** The state fields this decision reads and writes. Structural, so nothing here imports the kernel. */
export interface AgentContextState {
	config: { lang: string; model: string; agent: { context: AgentContextLevel; model: string } };
	agentForkConsent: ForkConsent;
	agentForkNotified: boolean;
}

/** What the appraiser needs to shape the request: an effective level and its payload. */
export interface ResolvedAgentContext {
	/** The level actually used, after any fork → digest downgrade. */
	context: AgentContextLevel;
	/** The scrubbed excerpt, present for `digest` (and for a `fork` that degraded to it). */
	digest?: string;
	/** The parent session file, present only for a real `fork`. */
	parentSessionFile?: string;
}

export interface ContextEstimate {
	/** Input tokens of the latest assistant turn, `usage.input + usage.cacheRead`. */
	tokens: number;
	/** `tokens` priced at the model's input rate per million, or `undefined` when unknown. */
	priceUsd: number | undefined;
}

/**
 * The latest assistant turn's input size, and what it would cost at the child model's rate.
 *
 * The size is the input the child would inherit as its starting context — the closest honest
 * number — not a guess at the whole transcript. When the model or its rate is unknown the price is
 * omitted and the confirm shows tokens only; a made-up price is worse than no price.
 */
export function estimateContextSize(
	entries: readonly SessionEntry[],
	model?: { cost?: { input?: number } },
): ContextEstimate {
	let tokens = 0;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message as { role?: unknown; usage?: unknown };
		if (message.role !== "assistant") continue;
		const usage = message.usage as { input?: unknown; cacheRead?: unknown } | undefined;
		if (usage === undefined || usage === null) continue;
		const input = typeof usage.input === "number" ? usage.input : 0;
		const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
		// Overwritten each time, so the LAST assistant turn wins.
		tokens = input + cacheRead;
	}
	const rate = model?.cost?.input;
	const priceUsd = tokens > 0 && typeof rate === "number" && rate > 0 ? (tokens / 1_000_000) * rate : undefined;
	return { tokens, priceUsd };
}

/** The child's model, resolved against the registry, for the fork price estimate. */
function childModel(state: AgentContextState, ctx: ExtensionContext): { cost?: { input?: number } } | undefined {
	const ref = effectiveAgentModel(state.config);
	if (ref.length === 0 || !ctx.modelRegistry || !parseModelRef(ref)) return undefined;
	return resolveModel(ctx.modelRegistry, ref)?.model;
}

/** Emit the fork → digest fallback notice at most once per session. */
function noteForkFallback(state: AgentContextState, ctx: ExtensionContext, text: string): void {
	if (state.agentForkNotified) return;
	state.agentForkNotified = true;
	ctx.ui.notify(text, "warning");
}

/**
 * Decide the context the child actually gets, and record the consent it needs.
 *
 * `configured` is read from the config; the returned level is what the runner must use. The only
 * downgrade is `fork → digest`, and only for a reason the operator can see.
 */
export async function resolveAgentContext(
	state: AgentContextState,
	ctx: ExtensionContext,
): Promise<ResolvedAgentContext> {
	const configured = state.config.agent.context;
	if (configured === "evidence") return { context: "evidence" };

	const strings = stringsFor(normalizeLocale(state.config.lang));
	const branch = ctx.sessionManager.getBranch();
	const digest = buildDigest(branch);
	const withDigest: ResolvedAgentContext = digest ? { context: "digest", digest } : { context: "digest" };

	if (configured === "digest") return withDigest;

	// `fork`: needs a session file and a terminal to confirm.
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) {
		noteForkFallback(state, ctx, strings.contextForkNoSession);
		return withDigest;
	}
	if (ctx.mode !== "tui") {
		noteForkFallback(state, ctx, strings.contextForkNeedsTui);
		return withDigest;
	}
	if (state.agentForkConsent === "unknown") {
		const estimate = estimateContextSize(branch, childModel(state, ctx));
		const body =
			estimate.priceUsd === undefined
				? strings.contextForkConfirmTokens(String(estimate.tokens))
				: strings.contextForkConfirm(String(estimate.tokens), estimate.priceUsd.toFixed(4));
		state.agentForkConsent = (await ctx.ui.confirm(strings.contextForkConfirmTitle, body))
			? "approved"
			: "declined";
	}
	if (state.agentForkConsent === "approved") {
		return { context: "fork", parentSessionFile: sessionFile };
	}
	return withDigest;
}
