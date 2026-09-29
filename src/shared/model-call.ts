/**
 * model-call — the ONE place this plugin talks to a model.
 *
 * A second model is the whole point of the plugin, and it is also the only thing here
 * that costs money, can hang, and can fail in ways the operator cannot see. So the call
 * lives in exactly one function, returns a result rather than throwing, and names the
 * stage that failed. A failure that cannot be diagnosed without a debugger is a failure
 * that will be misdiagnosed as "the plugin is broken".
 *
 * Uses `ctx.modelRegistry.complete(...)`: the verified registry surface, which resolves
 * request-time auth itself. There is deliberately no fallback to the standalone
 * `completeSimple` — it is not exported from `@earendil-works/pi-ai`'s root (only the
 * method of the same name on the registry interface), and a fallback to a symbol that
 * does not exist is worse than no fallback: it turns a clear error into a confusing one.
 *
 * The `provider/modelId` split is on the FIRST slash only. OpenRouter model ids contain
 * slashes (`openrouter-soukr/deepseek/deepseek-v4.1-flash`), so splitting on the last or
 * on every slash would mangle exactly the accounts this plugin is meant to use.
 */

import type { AssistantMessage, Api, Context, Model, Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentContextLevel } from "./agent-config.js";

/** The registry surface this plugin uses, taken from the context rather than re-declared. */
export type ModelRegistry = ExtensionContext["modelRegistry"];

export type ModelCallStage = "config" | "resolve" | "auth" | "request" | "response";

/**
 * Stages only the agent runtime (T24) can reach. Named here, next to the API stages, because the
 * appraiser stores and reports ONE `ModelCallStage` regardless of which runtime produced it.
 *
 * `spawn` is the child process itself; `timeout`/`budget`/`aborted` are the three ways the parent
 * kills it; `exit` is the child ending without submitting; `no_submission` is a settled run whose
 * `psych_submit` never arrived.
 */
export type AgentCallStage = "spawn" | "timeout" | "budget" | "aborted" | "exit" | "no_submission";

/**
 * Run metadata only the agent runtime can fill, kept for T27's accounting. Optional everywhere so
 * the API result is unchanged (D1: one `ModelCallResult`, whichever runtime formed it).
 */
export interface AgentRunMeta {
	/** Wall-clock duration of the run, ms. */
	durationMs: number;
	/** Tool calls executed by the child, by tool name. */
	toolCounts: Record<string, number>;
	/** This run's reported cost, USD. */
	costUsd: number;
	/** True when `context: "fork"` had no parent session file and fell back to `--no-session`. */
	fallback: boolean;
	/** Path to the kept `events.jsonl`, only when `agent.keepTranscript` was on. */
	transcriptPath?: string;
}

export interface ModelCallSuccess {
	ok: true;
	text: string;
	/** Provider and model actually used, so a call can be attributed in session accounting. */
	provider: string;
	modelId: string;
	label: string;
	usage: Usage | undefined;
	/** Present only for the agent runtime (T24). */
	run?: AgentRunMeta;
}

export interface ModelCallFailure {
	ok: false;
	stage: ModelCallStage | AgentCallStage;
	/** Human-readable, safe to show and to store. Never contains credentials. */
	error: string;
	/** Present only for the agent runtime: the run happened (or was attempted) and has figures. */
	run?: AgentRunMeta;
}

export type ModelCallResult = ModelCallSuccess | ModelCallFailure;

export interface ModelCallRequest {
	/** `provider/modelId`, as configured. Empty means "not configured". */
	modelRef: string;
	/**
	 * Agent runtime only: a model reference that OVERRIDES `modelRef` for this run (T32a). The API
	 * path IGNORES it, so its request stays byte-identical (D2). The reviewer role uses it to run its
	 * own, stronger model without widening the shared `agent.model`.
	 */
	modelRefOverride?: string;
	systemPrompt: string;
	userText: string;
	maxTokens: number;
	temperature?: number;
	signal?: AbortSignal;
	/**
	 * The evidence lines behind `userText`, handed over only so the agent runtime (T24) can rebuild
	 * the child's message via `buildAgentBrief` without re-deriving them. The API path IGNORES this:
	 * `userText` is authoritative there, so the API request stays byte-identical (D2).
	 */
	evidence?: { liveLines: readonly string[]; sessionLines: readonly string[] };
	/**
	 * Agent runtime only: the effective consent level for this run (T28/T29). Absent means "use the
	 * configured `agent.context`"; present, it carries any fork → digest downgrade the run decided.
	 * The API path ignores every field below, so its request is unchanged (D2).
	 */
	agentContext?: AgentContextLevel;
	/** Agent runtime only: the scrubbed transcript excerpt for `digest`. Never sent by the API path. */
	digest?: string;
	/** Agent runtime only: `getSessionFile()` read at run time, required for a real `fork`. */
	parentSessionFile?: string;
	/**
	 * Agent runtime only: which role the child runs as (T30). Absent means `psychologist`, so the
	 * appraiser path is unchanged; `/psych ask` sets `"ask"` and fills `question`.
	 */
	agentRole?: import("./child-limits.js").ChildRole;
	/** Agent runtime only: the operator's question, placed in the child's message (T30). */
	question?: string;
	/** Agent runtime only: the friction the `scout` role is asked about (T31). */
	topic?: string;
	/** Agent runtime only: the delivery anchors, for the `reviewer`/`pair` role (T32a). */
	review?: import("./agent-brief.js").ReviewBrief;
}

/** Split `provider/modelId` on the first slash only. */
export function parseModelRef(ref: string): { provider: string; modelId: string } | undefined {
	const trimmed = typeof ref === "string" ? ref.trim() : "";
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) return undefined;
	return { provider: trimmed.slice(0, slash), modelId: trimmed.slice(slash + 1) };
}

/**
 * Resolve a configured reference to a registry model.
 *
 * `find()` is the direct API; the `getAll()` scan exists because a catalog entry can
 * spell the same provider/id pair differently, and failing to find a model the operator
 * can see in the picker would be baffling.
 */
export function resolveModel(
	registry: ModelRegistry,
	ref: string,
): { model: Model<Api>; label: string } | undefined {
	const parsed = parseModelRef(ref);
	if (!parsed) return undefined;
	const direct = registry.find(parsed.provider, parsed.modelId);
	if (direct) return { model: direct, label: `${direct.provider}/${direct.id}` };
	const all = typeof registry.getAll === "function" ? registry.getAll() : [];
	const matched = all.find(
		(model) => model.provider === parsed.provider && model.id === parsed.modelId,
	);
	return matched ? { model: matched, label: `${matched.provider}/${matched.id}` } : undefined;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Whether a request's signal is already aborted. A function so the caller's narrowing does not
 * make a later check look impossible to the type checker. */
function signalAborted(signal: AbortSignal | undefined): boolean {
	return signal?.aborted === true;
}

/** The call. Never throws; every failure is a typed result with a stage. */
export async function callModel(
	registry: ModelRegistry,
	req: ModelCallRequest,
): Promise<ModelCallResult> {
	const ref = typeof req.modelRef === "string" ? req.modelRef.trim() : "";
	if (ref.length === 0) {
		return { ok: false, stage: "config", error: "no psychologist model configured" };
	}
	// An abort that already landed (the operator pressed stop, or the session ended) is reported as
	// `aborted` rather than as a request failure: the stage is how `/psych stop` is accounted (T26).
	if (signalAborted(req.signal)) {
		return { ok: false, stage: "aborted", error: "the appraisal was aborted" };
	}

	const resolved = resolveModel(registry, ref);
	if (!resolved) {
		return { ok: false, stage: "resolve", error: `model '${ref}' is not in the registry` };
	}

	let auth: Awaited<ReturnType<ModelRegistry["getApiKeyAndHeaders"]>>;
	try {
		auth = await registry.getApiKeyAndHeaders(resolved.model);
	} catch (error) {
		return { ok: false, stage: "auth", error: messageOf(error) };
	}
	if (!auth || auth.ok !== true) {
		const detail = auth && auth.ok === false ? auth.error : "no credentials resolved";
		return { ok: false, stage: "auth", error: `${resolved.label}: ${detail}` };
	}

	const context: Context = {
		systemPrompt: req.systemPrompt,
		messages: [{ role: "user", content: req.userText, timestamp: Date.now() }],
	};
	// Auth is passed per request rather than configured globally, so this call cannot
	// disturb the session's own credentials and cannot be affected by them.
	const options = {
		apiKey: auth.apiKey,
		headers: auth.headers,
		env: auth.env,
		maxTokens: req.maxTokens,
		temperature: req.temperature,
		signal: req.signal,
	};

	let response: AssistantMessage;
	try {
		response = await registry.complete(resolved.model, context, options);
	} catch (error) {
		// Abort is a distinct stage, not a request error: the report must be able to say the operator
		// stopped it rather than that the provider failed (T26).
		const aborted =
			signalAborted(req.signal) || (error instanceof Error && error.name === "AbortError");
		return {
			ok: false,
			stage: aborted ? "aborted" : "request",
			error: aborted ? "the appraisal was aborted" : `${resolved.label}: ${messageOf(error)}`,
		};
	}

	if (response.stopReason === "error") {
		return {
			ok: false,
			stage: "response",
			error: `${resolved.label}: ${response.errorMessage || "the provider reported an error"}`,
		};
	}

	const text = response.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("")
		.trim();
	if (text.length === 0) {
		return {
			ok: false,
			stage: "response",
			error: `${resolved.label}: empty response (stopReason: ${response.stopReason})`,
		};
	}

	return {
		ok: true,
		text,
		provider: resolved.model.provider,
		modelId: resolved.model.id,
		label: resolved.label,
		usage: response.usage,
	};
}

/** A compact, JSON-safe copy of a call's usage. */
export interface UsageSummary {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
}

/**
 * Reduce a call's usage to the figures worth keeping.
 *
 * IMPORTANT GAP, measured rather than assumed: the engine cannot be told about this call's
 * usage. Extensions receive a `ReadonlySessionManager`, which is a `Pick<SessionManager,
 * ...>` of read-only methods — `appendUsage` is NOT among them. So the skill's rule
 * ("include their usage in the tool result so session accounting stays accurate") has no
 * equivalent for a background call: a tool can report usage because the engine is waiting
 * on its result, and a slice called from `turn_end` has no such seam.
 *
 * Consequence the operator must know: an appraisal on a paid account spends money that
 * the session's own cost meter does not show. The plugin therefore surfaces the last
 * appraisal's cost itself (state.lastAppraisalUsage, shown by `/psych`) instead of pretending
 * the engine counted it.
 */
export function summarizeUsage(usage: Usage | undefined): UsageSummary | undefined {
	if (!usage) return undefined;
	return {
		input: usage.input ?? 0,
		output: usage.output ?? 0,
		cacheRead: usage.cacheRead ?? 0,
		cacheWrite: usage.cacheWrite ?? 0,
		totalTokens: usage.totalTokens ?? 0,
		cost: usage.cost?.total ?? 0,
	};
}
