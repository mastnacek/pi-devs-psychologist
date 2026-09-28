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

/** The registry surface this plugin uses, taken from the context rather than re-declared. */
export type ModelRegistry = ExtensionContext["modelRegistry"];

export type ModelCallStage = "config" | "resolve" | "auth" | "request" | "response";

export interface ModelCallSuccess {
	ok: true;
	text: string;
	/** Provider and model actually used, so a call can be attributed in session accounting. */
	provider: string;
	modelId: string;
	label: string;
	usage: Usage | undefined;
}

export interface ModelCallFailure {
	ok: false;
	stage: ModelCallStage;
	/** Human-readable, safe to show and to store. Never contains credentials. */
	error: string;
}

export type ModelCallResult = ModelCallSuccess | ModelCallFailure;

export interface ModelCallRequest {
	/** `provider/modelId`, as configured. Empty means "not configured". */
	modelRef: string;
	systemPrompt: string;
	userText: string;
	maxTokens: number;
	temperature?: number;
	signal?: AbortSignal;
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

/** The call. Never throws; every failure is a typed result with a stage. */
export async function callModel(
	registry: ModelRegistry,
	req: ModelCallRequest,
): Promise<ModelCallResult> {
	const ref = typeof req.modelRef === "string" ? req.modelRef.trim() : "";
	if (ref.length === 0) {
		return { ok: false, stage: "config", error: "no psychologist model configured" };
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
		return { ok: false, stage: "request", error: `${resolved.label}: ${messageOf(error)}` };
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
