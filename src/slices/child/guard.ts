/**
 * guard — the read-only rule, enforced in code rather than asked for in prose (T22, D4).
 *
 * The child pi runs headless with the whole workshop loadout, and on this machine no peer plugin can
 * be assumed to police it (spike Q5: `pi-secret-guard` is filtered off globally). So this handler is
 * the *only* thing standing between an appraising agent and the operator's working tree. It is
 * therefore written as a deny list with a catch-all rather than an allow list: an allow list grows
 * stale every time a new tool is installed, a deny list plus `/(write|edit|…)/` does not.
 *
 * Pure on purpose — `(event, limits, budget)` in, a verdict out — so the whole rule is a table a test
 * can drive without a fake extension host.
 *
 * The budget counts ALLOWED calls only. A call the guard already refused never ran, so charging it
 * would let a denied `web_search` spend the reading budget the model needs for `read` and `submit`.
 *
 * `ponytail:` floor, not proof. A tool whose name hides a write behind an unrelated word (for example
 * a plugin shipping `herdr_scaffold_plugin`, which is not in the child loadout on this machine but
 * writes files by its nature), or a shell form nobody thought of, still gets through. The upgrade path
 * is one more entry in `CHILD_FORBIDDEN_TOOLS`; the plan's T22 already names this as a known limit.
 */

import type { ChildLimits } from "../../shared/child-limits.js";
import {
	CHILD_SUBMIT_TOOL,
	childBashBlockReason,
	isChildForbiddenTool,
} from "../../shared/lexicon.js";

/** What the guard needs to keep across calls. One instance per child session. */
export interface ChildBudget {
	/** Tool calls that were actually allowed to run, against `limits.maxToolCalls`. */
	allowedCalls: number;
}

/** The engine's `tool_call` result, narrowed to the only shape this guard ever returns. */
export interface ChildBlock {
	block: true;
	reason: string;
}

/** The four web tools (spike Q6); `web_enable` is included so it cannot re-open what is closed. */
const WEB_TOOLS: ReadonlySet<string> = new Set([
	"web_search",
	"fetch_content",
	"get_search_content",
	"web_enable",
]);

/** `mcp`, `mcpScript`, and every MCP server proxy such as `mcp__knowledge_base`. */
function isMcpTool(toolName: string): boolean {
	return toolName === "mcp" || toolName === "mcpScript" || toolName.startsWith("mcp__");
}

/** The tail every refusal ends with, so the model is never left without a next step. */
const NEXT_STEP = "Report what you have with psych_submit.";

/**
 * Decide whether the child may run one tool call.
 *
 * Order matters for the message, not for the verdict: a forbidden tool is named as forbidden even
 * when the budget is also gone, and a disabled capability is named as disabled rather than silently
 * looking like a budget problem. `psych_submit` is checked first and always passes — it is the one
 * call the guard must never be able to starve.
 */
export function guardToolCall(
	event: { toolName: string; input: Record<string, unknown> },
	limits: ChildLimits,
	budget: ChildBudget,
): ChildBlock | undefined {
	const name = event.toolName;
	if (name === CHILD_SUBMIT_TOOL) return undefined;

	if (isChildForbiddenTool(name)) {
		return {
			block: true,
			reason: `blocked: ${name} can change files or ship state, and this child is read-only. ${NEXT_STEP}`,
		};
	}

	if (name === "bash") {
		const command = typeof event.input?.command === "string" ? event.input.command : "";
		if (!limits.allowNlm && /^\s*nlm\b/i.test(command)) {
			return {
				block: true,
				reason: `blocked: NotebookLM is disabled for this run, so nlm must not be run. ${NEXT_STEP}`,
			};
		}
		const why = childBashBlockReason(command);
		if (why !== undefined) {
			return {
				block: true,
				reason: `blocked: ${why}, and this child is read-only. Read-only commands (read, grep, git diff, git log, git show, npm test) are available. ${NEXT_STEP}`,
			};
		}
	}

	if (!limits.allowWeb && WEB_TOOLS.has(name)) {
		return {
			block: true,
			reason: `blocked: web tools are disabled for this run. Answer from the evidence lines and citations you already have. ${NEXT_STEP}`,
		};
	}

	if (!limits.allowMcp && isMcpTool(name)) {
		return {
			block: true,
			reason: `blocked: MCP tools are disabled for this run. Use the local tools. ${NEXT_STEP}`,
		};
	}

	if (budget.allowedCalls >= limits.maxToolCalls) {
		return {
			block: true,
			reason: "tool budget exhausted — call psych_submit now with what you have",
		};
	}

	budget.allowedCalls += 1;
	return undefined;
}
