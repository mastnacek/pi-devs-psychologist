/**
 * submit — `psych_submit`, the child's only way to answer (T22, D3).
 *
 * Structured output by tool, not by prose: the parent reads the tool ARGUMENTS out of the JSON
 * stream, so nothing the child writes as final text is parsed, and a malformed answer can be refused
 * *while the child is still running* instead of surfacing as a bad appraisal later. That is the whole
 * point of `isError` — the child model sees which field it got wrong and retries, which no amount of
 * prompt instruction reliably achieves.
 *
 * `Value.Check` is used here on purpose, and `appraisal-enforce.ts` says why the split runs the other
 * way round for final text: recovery matters more than rejection there, while tool ARGUMENTS are where
 * "a bad shape must be refused".
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type TSchema } from "typebox";
import { Check, Errors } from "typebox/value";
import { APPRAISAL_SCHEMA, ASK_SCHEMA, SCOUT_SCHEMA } from "../../shared/appraisal.js";
import type { ChildRole } from "../../shared/child-limits.js";
import { CHILD_SUBMIT_TOOL } from "../../shared/lexicon.js";

/** Invalid submissions answered with the plain field list before the refusal starts giving advice. */
const PLAIN_ATTEMPTS = 2;

/** What the submission tool remembers between calls, so a retry is not a fresh start. */
export interface SubmitState {
	/** True once a valid answer was accepted; a second call is refused from then on. */
	submitted: boolean;
	/** Invalid submissions so far, so the third one gets told to stop guessing. */
	failures: number;
}

/**
 * The schema the role submits. `psychologist` submits the appraisal contract itself (D1: both runtimes
 * return the same shape); `ask` its own answer contract (T30); `scout` its candidate/build contract
 * (T31). `pair` still borrows `ask`'s shape until T32 gives it its own.
 */
export function schemaForRole(role: ChildRole): TSchema {
	if (role === "psychologist") return APPRAISAL_SCHEMA;
	if (role === "scout") return SCOUT_SCHEMA;
	return ASK_SCHEMA;
}

/**
 * Register `psych_submit` for this role.
 *
 * Every failure path `throw`s, so the engine marks the result `isError: true` and the child sees a
 * message it can act on. Success returns `terminate: true`: the answer is in, and there is no reason
 * to spend another turn. Termination only takes effect when every tool in the batch agrees, which is
 * exactly the semantics wanted — a batch that also contains a real tool call should finish that call.
 */
export function registerSubmitTool(pi: ExtensionAPI, role: ChildRole, state: SubmitState): void {
	const schema = schemaForRole(role);
	pi.registerTool({
		name: CHILD_SUBMIT_TOOL,
		label: "Submit the answer",
		description:
			"Submit your final answer as structured arguments. Call it exactly once, as your last action. " +
			"Plain text you write is not read by anyone: if you do not call this tool, your work is lost.",
		parameters: schema,
		execute: async (_toolCallId, params) => {
			// Checked before validation: a second call is refused whether or not it is well-formed,
			// so "submit twice with a better answer" is not a strategy.
			if (state.submitted) {
				throw new Error(
					"already submitted — psych_submit accepted an answer once and a second call is refused. Stop now.",
				);
			}

			if (!Check(schema, params)) {
				state.failures += 1;
				const fields = Errors(schema, params)
					.slice(0, 3)
					.map((error) => `${error.instancePath || "/"}: ${error.message}`)
					.join("; ");
				if (state.failures > PLAIN_ATTEMPTS) {
					throw new Error(
						`psych_submit is still invalid after ${state.failures} attempts: ${fields}. ` +
							"Stop guessing at the schema and submit a minimal valid object now: include every " +
							"required field, use an empty `cited` list for anything the evidence does not " +
							"support, and the neutral value (unassessed / unproven) for any verdict you cannot cite.",
					);
				}
				throw new Error(`psych_submit is invalid: ${fields}. Fix these fields and call it again.`);
			}

			state.submitted = true;
			return {
				content: [{ type: "text" as const, text: "Submitted. Stop now." }],
				details: { submitted: true },
				terminate: true,
			};
		},
	});
}
