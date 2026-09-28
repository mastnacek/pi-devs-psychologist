/**
 * agent-config — the `runtime: "agent"` settings and their coercion.
 *
 * Split out of `config.ts` by concept (and to keep each file under the line budget): this is the
 * switch, its consent level and its child-process limits, and every key here is normalised on its
 * own so one junk value cannot lose the rest. The cascade that merges this object across layers
 * still lives in `config.ts`.
 */

/** Which runtime forms the appraisal: today's single completion call, or a child pi agent (D1). */
export type RuntimeMode = "api" | "agent";

/** How much of the session the child agent may see. Three data boundaries, three consent levels (D6). */
export type AgentContextLevel = "evidence" | "digest" | "fork";

/** The engine's thinking levels, plus `""` for "unset" (the plan's `off…max`). */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Settings for `runtime: "agent"`. Flat and independently normalised, key by key. */
export interface AgentConfig {
	/** `provider/modelId[:thinking]`. Empty means "fall back to the shared `model`". */
	model: string;
	/** A thinking level passed as `--thinking` when set; `""` means the engine default. */
	thinking: string;
	/** The consent level (D6). Only `evidence` is the default; the other two leave the machine. */
	context: AgentContextLevel;
	/** Hard wall-clock cap in ms, after which the child tree is killed. */
	timeoutMs: number;
	/** Child-side cap on tool calls before only `psych_submit` remains. */
	maxToolCalls: number;
	/** Per-run cost cap in USD; `0` means unlimited. The parent kills when exceeded. */
	maxCostUsd: number;
	/** Across-run cost cap in USD; `0` means unlimited. */
	maxCostUsdPerSession: number;
	/** Whether the child may use the web tools. */
	allowWeb: boolean;
	/** Whether the child may use MCP tools. */
	allowMcp: boolean;
	/** Whether the child may query NotebookLM. */
	allowNlm: boolean;
	/** NotebookLM notebook ids the child may query. */
	nlmNotebooks: string[];
	/** Extra argv tokens, appended verbatim. An escape hatch, documented as such. */
	extraArgs: string[];
	/** Keep the child's JSONL transcript in the run's temp dir for debugging. */
	keepTranscript: boolean;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
	model: "",
	thinking: "",
	context: "evidence",
	timeoutMs: 180_000,
	maxToolCalls: 25,
	maxCostUsd: 0.25,
	maxCostUsdPerSession: 2,
	allowWeb: true,
	allowMcp: true,
	allowNlm: true,
	nlmNotebooks: [],
	extraArgs: [],
	keepTranscript: false,
};

/** True for a plain object (not null, not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** `api` unless the value is exactly `agent`; junk is a typo, not a policy. */
export function runtimeMode(value: unknown): RuntimeMode {
	return value === "agent" ? "agent" : "api";
}

/** One of the three consent levels, or `evidence` when the value is junk. */
export function contextLevel(value: unknown): AgentContextLevel {
	return value === "digest" ? "digest" : value === "fork" ? "fork" : "evidence";
}

/** A known thinking level, or `""` for "unset". */
function thinkingLevel(value: unknown): string {
	return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value) ? value : "";
}

/** A finite number at or above zero, or the fallback. `0` is meaningful for cost caps (unlimited). */
function nonNegativeNumber(value: unknown, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** An array of non-empty strings; anything else (including junk members) degrades to `[]`. */
function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim());
}

/** Coerce the `agent` object key by key, so one bad value cannot lose the rest. */
export function normalizeAgent(value: unknown): AgentConfig {
	const raw = isPlainObject(value) ? value : {};
	const d = DEFAULT_AGENT_CONFIG;
	return {
		model: typeof raw.model === "string" ? raw.model.trim() : "",
		thinking: thinkingLevel(raw.thinking),
		context: contextLevel(raw.context),
		timeoutMs: nonNegativeNumber(raw.timeoutMs, d.timeoutMs),
		maxToolCalls: nonNegativeNumber(raw.maxToolCalls, d.maxToolCalls),
		maxCostUsd: nonNegativeNumber(raw.maxCostUsd, d.maxCostUsd),
		maxCostUsdPerSession: nonNegativeNumber(raw.maxCostUsdPerSession, d.maxCostUsdPerSession),
		// Default on, opt-out: only `false` disables a capability, so a missing or nonsense key keeps
		// the safer-to-be-capable default the plan specifies.
		allowWeb: raw.allowWeb !== false,
		allowMcp: raw.allowMcp !== false,
		allowNlm: raw.allowNlm !== false,
		nlmNotebooks: stringArray(raw.nlmNotebooks),
		extraArgs: stringArray(raw.extraArgs),
		keepTranscript: raw.keepTranscript === true,
	};
}

/**
 * The model the `agent` runtime actually uses: `agent.model` when set, else the shared `model`.
 *
 * One spelling of "which model is in effect" for the chip, the report and the picker, so the three
 * cannot disagree about it. Structural input, so this module imports nothing from `config.ts`.
 */
export function effectiveAgentModel(config: { agent: Pick<AgentConfig, "model">; model: string }): string {
	const agentModel = config.agent.model.trim();
	return agentModel.length > 0 ? agentModel : config.model;
}
