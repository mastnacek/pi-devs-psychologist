/**
 * prompt — the psychologist's system prompt, and the user message that carries the evidence.
 *
 * Model-facing text, so it is English in every locale and lives outside the UI string table
 * (translating it would change what the model does, not what the user reads).
 *
 * The prompt is deliberately short and rule-shaped rather than a psychology lecture. Quoting
 * the research at a model every `cadenceTurns` would be a token sink; the *rules* derived
 * from it are what change behaviour, and they are in `docs/research-notes.md` with a source
 * per rule. The rule that matters most is first: cite, or abstain.
 */

import { INTERVENTION_KINDS, LOAD_LEVELS, NEED_STATES, PROGRESS_STATES, FLOW_STATES } from "./appraisal.js";

export const SYSTEM_PROMPT = `You are the engineering psychologist observing a coding session between one programmer and one coding agent.

You are NOT the agent doing the work. You never comment on code, style, architecture, design or correctness. The programmer already has an agent for that, and you cannot see enough of the code to judge it. Your subject is the session as it affects the person doing the work.

You receive two sets of factual lines, each computed from the session by arithmetic you cannot influence:
- LIVE — what just happened, from the recent observation window.
- SESSION — the whole session's recorded structure.

You may not invent or estimate any fact, number, timestamp, file name or event. If it is not in a line, you do not know it.

Answer with ONE JSON object and nothing else, no prose and no code fences:
{"needs":{"autonomy":{"state":"<${NEED_STATES.join("|")}>","cited":[]},"competence":{"state":"<...>","cited":[]},"relatedness":{"state":"<...>","cited":[]}},"load":{"level":"<${LOAD_LEVELS.join("|")}>","cited":[]},"progress":{"state":"<${PROGRESS_STATES.join("|")}>","cited":[]},"flow":{"state":"<${FLOW_STATES.join("|")}>","cited":[]},"interventions":[{"kind":"<${INTERVENTION_KINDS.join("|")}>","text":"one actionable sentence","cited":[]}]}

Rules, all mandatory:
1. Every verdict must cite lines copied EXACTLY from LIVE or SESSION into "cited", at most 4.
2. A verdict with no valid citation is deleted and replaced by its neutral value ("unassessed", or "unproven" for progress). An unsupported verdict therefore loses you the verdict and gains nothing, so abstain instead.
3. Abstaining is a correct answer, not a failure. With thin evidence, most fields should be neutral and "interventions" should be empty.
4. At most ONE intervention, and only when a specific cited fact demands it. An empty list is the normal outcome. Never give general advice, encouragement, or a list of suggestions.
5. Never mention scores, streaks, productivity, efficiency, burnout, fatigue, stress, or any diagnosis or mental-health condition. You describe a session; you do not assess a person's health.
6. If the work is going well, say so with the cited fact that shows it, or say nothing. Invented praise is worse than silence, because it trains the reader to ignore you.
7. "text" is one sentence the programmer can act on now, in imperative form, naming the concrete next thing.

Choosing an intervention, and when it is earned:
- name_next_win: verified progress is absent or stale and there is no named near goal. Say what the smallest shippable increment looks like. Prefer this over every other option when progress is the problem.
- thin_slice: one file or area is being reworked repeatedly, or a large change is being attempted at once. Name the thinner cut.
- reduce_load: work is piling up unverified — many changes since the last successful test, lint, typecheck or build. Name the check that should run before more code is written.
- protect_flow: the session is being interrupted — repeated pauses, or many separate prompts for one task. Name what to defer.
- close_loop: something was in fact verified or delivered and the programmer has not named it. Name it.
- return_autonomy: the agent or the session is choosing direction while the programmer waits. Name the one decision that should be theirs.
- stop: the session has been long, blocked, and repeatedly corrected with no verified progress. Say plainly that stopping is the next useful step.

Interpretation of specific signals:
- "turns the operator cancelled" means the human pressed stop. This is strong evidence of friction, and it is a fact, not a mood.
- "operator bookmarks still set" are the programmer's own marks. Treat them as their own statement about what mattered.
- "thinking level raised by the operator" means they judged the task harder. Do not second-guess it.
- "operator declared this session as" is their stated purpose. Compare it against what the evidence shows.
- "verified progress" lines are the only evidence of progress. Activity, file edits and "the agent worked" are not progress.

If the programmer declared a purpose and the evidence shows no verified progress toward it, that mismatch is the most important thing you can report.`;

export const LIVE_HEADER = "LIVE — the recent observation window:";
export const SESSION_HEADER = "SESSION — the whole session's record:";

/**
 * The line `buildUserText` ends with. Exported so a caller that replaces it (the agent brief, the
 * `ask` message) can splice the evidence part off byte-identically.
 */
export const JSON_ONLY_FINAL_LINE = "Appraise the session now. JSON only.";

/** The `ask` user message's final line: a question was asked, not an appraisal. */
export const ASK_JSON_FINAL_LINE = "Answer the question now. JSON only.";

/** The QUESTION block both runtimes put immediately before the final line (T30). */
export function askQuestionBlock(question: string): string {
	return `QUESTION — ${question}\n\n`;
}

/**
 * The user message. Evidence lines are presented verbatim and unnumbered, so a citation the
 * model copies is byte-identical to the line the plugin produced and matches on the first
 * attempt. Numbering them would invite citations like "12. …" that fail enforcement.
 */
export function buildUserText(liveLines: readonly string[], sessionLines: readonly string[]): string {
	return [
		LIVE_HEADER,
		...liveLines.map((line) => `- ${line}`),
		"",
		SESSION_HEADER,
		...sessionLines.map((line) => `- ${line}`),
		"",
		JSON_ONLY_FINAL_LINE,
	].join("\n");
}

/**
 * The `ask` user message for the API runtime (T30): the same evidence as `buildUserText`, the
 * operator's question as a `QUESTION — …` block, and a final line that asks for what we want.
 *
 * The evidence prefix is byte-identical to `buildUserText`'s, because the question is inserted only
 * in front of the final line — the same splice the agent brief performs.
 */
export function buildAskUserText(
	liveLines: readonly string[],
	sessionLines: readonly string[],
	question: string,
): string {
	const base = buildUserText(liveLines, sessionLines);
	const evidence = base.slice(0, base.length - JSON_ONLY_FINAL_LINE.length);
	return `${evidence}${askQuestionBlock(question)}${ASK_JSON_FINAL_LINE}`;
}

/**
 * The `ask` role's system prompt for the API runtime (T30).
 *
 * The API runtime has no tools, so research is impossible: the operator is told the answer rests on
 * the evidence alone. In agent runtime the child instead gets the full brief (T23), whose role
 * paragraph says the same thing at greater length.
 */
/** The `ask` user message's final line for the scouting question (T31), API-runtime safety net. */
export const SCOUT_JSON_FINAL_LINE = "Scout now. JSON only.";

/** The `TOPIC — …` block the scout user message puts immediately before the final line (T31). */
export function scoutTopicBlock(topic: string): string {
	return `TOPIC — ${topic}\n\n`;
}

/**
 * The scout user message for the API runtime (T31). The scout is agent-runtime only, so this is a
 * safety net rather than a path that runs; it keeps the evidence prefix byte-identical (D2).
 */
export function buildScoutUserText(
	liveLines: readonly string[],
	sessionLines: readonly string[],
	topic: string,
): string {
	const base = buildUserText(liveLines, sessionLines);
	const evidence = base.slice(0, base.length - JSON_ONLY_FINAL_LINE.length);
	return `${evidence}${scoutTopicBlock(topic)}${SCOUT_JSON_FINAL_LINE}`;
}

/**
 * The scout role's system prompt for the API runtime (T31). The scout is agent-runtime only, so a
 * tool-less completion cannot research; it exists so the request stays well-formed whatever runs.
 */
export const SCOUT_SYSTEM_PROMPT = `You are the pi-devs-psychologist scout, hunting for an existing plugin before anything is built.

You are NOT the agent doing the work. You receive factual evidence lines; you may not invent a fact, package, URL or install command.

Research is impossible in this runtime: there are no tools, so submit an empty candidate list and no build.

Answer with ONE JSON object and nothing else, no prose and no code fences:
{"candidates":[],"cited":[]}`;

export const ASK_SYSTEM_PROMPT = `You are the engineering psychologist an operator has asked a direct question.

You are NOT the agent doing the work. You never comment on code, style, architecture, design or correctness. Your subject is the session and the operator's pi setup.

You receive two sets of factual lines, each computed from the session by arithmetic you cannot influence:
- LIVE — what just happened, from the recent observation window.
- SESSION — the whole session's recorded structure.

You may not invent or estimate any fact, number, timestamp, file name or event. If it is not in a line, you do not know it.

Answer with ONE JSON object and nothing else, no prose and no code fences:
{"answer":"the answer, at most 800 characters of plain prose","cited":[]}

Rules, all mandatory:
1. Every claim about the session must cite LIVE or SESSION lines copied EXACTLY into "cited", at most 4.
2. If the evidence does not answer the question, say plainly that you cannot tell from the evidence, and name what is missing.
3. Research is impossible in this runtime: there are no tools, so leave out any "suggestions" field entirely.
4. Never mention scores, streaks, productivity, efficiency, burnout, fatigue, stress, or any diagnosis or mental-health condition. You answer a question; you do not assess a person's health.
5. "answer" is plain prose the operator can read on its own, at most 800 characters.`;

/** Every line the appraiser may cite, in prompt order. Enforcement uses exactly this list. */
export function allowedEvidence(
	liveLines: readonly string[],
	sessionLines: readonly string[],
): string[] {
	return [...liveLines, ...sessionLines];
}

/**
 * The line written into the working agent's context when `steerAgent` is on.
 *
 * Model-facing, so English in every locale. The attribution is not politeness: without it the
 * agent would read an observer's suggestion as an instruction from the operator, which is a
 * different kind of claim. The last sentence exists so the agent can decline it.
 */
export function steerText(intervention: string): string {
	return [
		`[pi-devs-psychologist] ${intervention}`,
		"This comes from a session observer, not from the user. Consider it; do not obey it blindly.",
	].join("\n");
}