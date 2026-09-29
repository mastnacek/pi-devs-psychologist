/**
 * agent-call — the agent-runtime half of the model-call seam (T24), lifted out of the composition
 * root so the root stays a wiring file (and under its line budget).
 *
 * It has the same shape as `callModel` (D1): the appraiser and `/psych ask` never learn which runtime
 * ran, only that a `ModelCallResult` came back. What is specific to the child process lives here —
 * the session cost cap, the resolved model's label, the running child's kill handle kept in state so
 * `session_shutdown` can end it, and the live tool census the researching chip reads (T26).
 *
 * The role and the question come from the request (T30): an appraisal leaves them unset and runs as
 * the `psychologist`, `/psych ask` sets `"ask"` and fills `question`.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { effectiveAgentModel } from "./agent-config.js";
import { runAgent, defaultAgentRunIo, type AgentRunIo } from "./agent-runner.js";
import { parseModelRef, resolveModel, type ModelCallRequest, type ModelCallResult } from "./model-call.js";
import type { DevsPsychologistState } from "./state.js";
import { stringsFor } from "./i18n.js";
import { PI_VERSION } from "./version.js";

/** Everything the agent call needs that is not in state: facts resolved once by the root (T24). */
export interface AgentCallOptions {
	/** Absolute path to the engine CLI entry, spawned by `process.execPath`. */
	cliPath: string;
	/** The resolved engine docs directory, or `undefined` when it could not be found. */
	docsDir?: string;
	/** Test seam for the process surface; production leaves it unset and the real IO is used. */
	io?: AgentRunIo;
}

/** The shape shared by `callModel` and this wrapper, so the appraiser's seam accepts either (D1). */
export type AgentCall = (
	registry: ExtensionContext["modelRegistry"],
	req: ModelCallRequest,
) => Promise<ModelCallResult>;

export function createAgentCall(state: DevsPsychologistState, options: AgentCallOptions): AgentCall {
	return async (registry, req) => {
		const cfg = state.config.agent;
		const cap = cfg.maxCostUsdPerSession;
		if (cap > 0 && state.agentSessionCostUsd >= cap) {
			return {
				ok: false,
				stage: "budget",
				error: `session cost cap reached ($${state.agentSessionCostUsd.toFixed(2)} of $${cap.toFixed(2)})`,
			};
		}
		const modelRef =
			req.modelRefOverride && req.modelRefOverride.trim().length > 0
				? req.modelRefOverride.trim()
				: effectiveAgentModel(state.config);
		// A registry may be absent (headless fakes); the run does not need it, only the label does.
		const resolved = registry && parseModelRef(modelRef) ? resolveModel(registry, modelRef) : undefined;
		// Pre-flight: a ref the registry does not know means the CHILD dies at startup with a raw
		// `Model ... not found` exit-1 (observed in the field: a free-tier id disappeared from the
		// provider's catalog after the config was written). Refuse BEFORE spawning and name the fix;
		// the parent's registry is the same surface the child's --list-models reads.
		if (registry && parseModelRef(modelRef) && !resolved) {
			return {
				ok: false,
				// The same stage the API path reports for an unknown ref, so the report and the
				// failure ledger need no new stage to understand it.
				stage: "resolve",
				error: stringsFor(state.config.lang).agentModelUnknown(modelRef),
			};
		}
		// One agent run started this session; the report budgets the session against it (T27).
		state.agentRunsThisSession += 1;
		const result = await runAgent(
			{
				modelRef,
				evidence: req.evidence ?? { liveLines: [], sessionLines: [] },
				signal: req.signal,
				...(req.digest ? { digest: req.digest } : {}),
				...(req.question ? { question: req.question } : {}),
				...(req.topic ? { topic: req.topic } : {}),
				...(req.review ? { review: req.review } : {}),
			},
			{
				cliPath: options.cliPath,
				execPath: process.execPath,
				role: req.agentRole ?? "psychologist",
				context: req.agentContext ?? cfg.context,
				parentSessionFile: req.parentSessionFile,
				piVersion: PI_VERSION,
				docsDir: options.docsDir,
				thinking: cfg.thinking,
				trusted: state.agentTrusted,
				cwd: state.sessionCwd,
				timeoutMs: cfg.timeoutMs,
				maxCostUsd: cfg.maxCostUsd,
				maxToolCalls: cfg.maxToolCalls,
				allowWeb: cfg.allowWeb,
				allowMcp: cfg.allowMcp,
				allowNlm: cfg.allowNlm,
				nlmNotebooks: cfg.nlmNotebooks,
				extraArgs: cfg.extraArgs,
				keepTranscript: cfg.keepTranscript,
				// The scout role is told where the operator's own plugins live (T31).
				workshopDir: state.config.roles.scout.workshopDir,
				onChild: (handle) => {
					state.agentChildKill = handle ? handle.kill : undefined;
				},
				// Live progress for the researching chip (T26): the child's tool census, fed by the stream
				// reducer. The chip's own timer throttles the repaint, so this only updates the count.
				onProgress: (progress) => {
					state.appraisalToolCalls = progress.toolCalls;
				},
			},
			options.io ?? defaultAgentRunIo(),
		);
		// Attribute the run to the resolved model, so the report names the model that actually ran.
		if (result.ok === true && resolved) {
			const attributed: ModelCallResult = {
				...result,
				provider: resolved.model.provider,
				modelId: resolved.model.id,
				label: resolved.label,
			};
			if (result.run) state.agentSessionCostUsd += result.run.costUsd;
			return attributed;
		}
		if (result.run) state.agentSessionCostUsd += result.run.costUsd;
		return result;
	};
}
