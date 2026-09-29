/**
 * report — the `/psych status` text.
 *
 * Deliberately plain text with no theme: it has to be readable in a notification, in a
 * scrollback dump, and in a test, so it carries structure with markers rather than ANSI. The
 * card is where presentation lives; this is where the *records* live.
 *
 * Three things appear here and nowhere else, and each exists so the plugin stays honest about
 * itself: the evidence it actually used, the claims it refused (unmatched citations), and the
 * money it spent that the session's own meter does not know about.
 */

import { NEEDS } from "../../shared/appraisal.js";
import { isSilent } from "../../shared/appraisal-enforce.js";
import { effectiveAgentModel } from "../../shared/config.js";
import { stringsFor, type Locale } from "../../shared/i18n.js";
import { MAP_STALE_TURNS } from "../../shared/repo-map.js";
import { effectByKind, type OutcomeRecord } from "../../shared/outcome.js";
import type { DevsPsychologistState } from "../../shared/state.js";
import { PLUGIN_VERSION } from "../../shared/version.js";
import { truncateToWidth } from "@earendil-works/pi-tui";

export interface ReportInput {
	state: DevsPsychologistState;
	/** Live window evidence lines, in prompt order. */
	signals: readonly string[];
	/** Session record evidence lines. */
	history: readonly string[];
	lang: Locale;
	/** Terminal width, so every line is clipped rather than wrapped (T27). `0`/absent means no clip. */
	width?: number;
	/** The objective repo-map evidence lines (T8). Empty when the map is unavailable. */
	mapLines?: readonly string[];
	/** True when `mapRepo` is off or `cwd` is outside a git work tree: `/psych` says so. */
	mapUnavailable?: boolean;
	/** Turns since the map was computed; shown only when it has gone stale. */
	mapAgeTurns?: number;
}

/** `  · text` — one evidence line. */
function bullet(text: string): string {
	return `  · ${text}`;
}

/** `── Heading` — a section marker, indented two so it aligns with the bullets. */
function heading(title: string): string {
	return `── ${title}`;
}

function citations(cited: readonly string[]): string[] {
	return cited.map((line) => `      ↳ ${line}`);
}

/** Render the full report. Pure: no UI, no model, no clock. */
export function renderReport(input: ReportInput): string {
	const { state } = input;
	const s = stringsFor(input.lang);
	const lines: string[] = [`${s.reportTitle} v${PLUGIN_VERSION}`];

	if (!state.config.enabled) {
		lines.push("", `⚠ ${s.reportDisabled}`);
		return lines.join("\n");
	}
	if (state.config.model.trim().length === 0 && effectiveAgentModel(state.config).trim().length === 0) {
		lines.push("", `⚠ ${s.reportNoModel}`);
		return lines.join("\n");
	}

	// Budget first: it is the number that explains every silence.
	const cap = state.config.maxAppraisalsPerSession;
	lines.push(
		"",
		`model     ${state.config.model}`,
		`${s.reportRuntime} ${state.config.runtime}`,
		`${s.reportContext} ${state.config.agent.context}`,
	);
	// The agent runtime resolves `agent.model`, else the shared `model`; the effective one is what
	// the report must show, because that is what would actually be called.
	if (state.config.runtime === "agent") {
		const effective = effectiveAgentModel(state.config);
		lines.push(`${s.reportAgentModel} ${effective.length > 0 ? effective : s.notSet}`);
	}
	lines.push(
		`${s.reportBudget(state.appraisalsThisSession, cap === 0 ? "∞" : String(cap))}`,
		`cadence   ${state.turnsSinceAppraisal}/${state.config.cadenceTurns} turns since the last attempt`,
	);
	// The trigger rule made visible: what last fired an appraisal, and how many turns it saved.
	// Both are facts the operator can act on — retune `triggerThresholds`, or see the clock at work.
	lines.push(`${s.reportTrigger} ${state.config.trigger}`);
	if (state.lastTriggerReasons.length > 0) {
		lines.push(`${s.reportTriggered} ${state.lastTriggerReasons.join(", ")}`);
	}
	lines.push(s.reportSkipped(state.appraisalsSkipped));

	lines.push("", heading(s.reportSignals));
	if (input.signals.length === 0) lines.push(bullet(s.reportEmpty));
	for (const line of input.signals) lines.push(bullet(line));

	lines.push("", heading(s.reportSession));
	if (input.history.length === 0) lines.push(bullet(s.reportEmpty));
	for (const line of input.history) lines.push(bullet(line));

	// The repo map (T8) is offered to the model as SESSION evidence, so it is shown here alongside
	// what the session record contributed. Unavailable is stated, never rendered as zeroes.
	lines.push("", heading(s.reportRepoMap));
	if (input.mapUnavailable ?? (input.mapLines ?? []).length === 0) lines.push(bullet(s.reportMapUnavailable));
	for (const line of input.mapLines ?? []) lines.push(bullet(line));
	if ((input.mapAgeTurns ?? 0) > MAP_STALE_TURNS) lines.push(bullet(s.reportMapAge(input.mapAgeTurns as number)));

	lines.push("", heading(s.reportAppraisal));
	const appraisal = state.lastAppraisal;
	if (!appraisal) {
		lines.push(bullet(s.reportNever), "", s.reportNone);
	} else {
		for (const need of NEEDS) {
			const verdict = appraisal.needs[need];
			lines.push(`  ${s.labels.needs[need]}: ${s.labels.needStates[verdict.state]}`);
			lines.push(...citations(verdict.cited));
		}
		lines.push(`  Load: ${s.labels.loadLevels[appraisal.load.level]}`);
		lines.push(...citations(appraisal.load.cited));
		lines.push(`  Progress: ${s.labels.progressStates[appraisal.progress.state]}`);
		lines.push(...citations(appraisal.progress.cited));
		lines.push(`  Flow: ${s.labels.flowStates[appraisal.flow.state]}`);
		lines.push(...citations(appraisal.flow.cited));

		const intervention = appraisal.interventions[0];
		if (intervention) {
			lines.push("", `  ⚑ ${s.labels.interventionKinds[intervention.kind]}: ${intervention.text}`);
			for (const cited of intervention.cited) lines.push(`      ${s.reportWhy}: ${cited}`);
		} else {
			lines.push("", `  ${s.cardNothingToAct}`);
		}
		if (isSilent(appraisal)) lines.push("", `  (${s.reportEmpty})`);
	}

	// The plugin's own doubts, and its own spend. Both would otherwise be invisible.
	const notes = state.lastAppraisalNotes;
	if (notes && (notes.unmatched.length > 0 || notes.downgraded.length > 0)) {
		lines.push("", heading(s.cardUnmatched(notes.unmatched.length)));
		for (const claim of notes.unmatched) lines.push(`  ✗ ${claim}`);
		if (notes.downgraded.length > 0) lines.push(`  ${s.reportEmpty}: ${notes.downgraded.join(", ")}`);
	}
	if (state.lastAppraisalFailure) {
		lines.push(
			"",
			heading(`⚠ ${s.reportErr}`),
			`  ${state.lastAppraisalFailure.stage}: ${state.lastAppraisalFailure.error}`,
		);
	}
	if (state.lastAppraisalUsage) {
		const usage = state.lastAppraisalUsage;
		lines.push("", heading(s.reportSpend), `  ${usage.totalTokens} tokens · $${usage.cost.toFixed(4)}`);
	}

	// T27: the last run's own accounting, plus the session's agent spend against its cap. Both are
	// facts the operator budgets against; without them the async run is invisible money.
	lines.push("", heading(s.reportLastRun));
	const run = state.lastRun;
	if (!run) {
		lines.push(bullet(s.reportNever));
	} else {
		lines.push(`  ${s.runLabels.runtime} ${run.runtime}`);
		lines.push(`  ${s.runLabels.model} ${run.model}`);
		lines.push(`  ${s.runLabels.context} ${run.context}`);
		lines.push(`  ${s.runLabels.duration} ${(run.durationMs / 1000).toFixed(1)}s`);
		lines.push(`  ${s.runLabels.tools} ${topTools(run.toolCounts)}`);
		lines.push(`  ${s.runLabels.tokens} ${s.runTokens(String(run.inputTokens), String(run.outputTokens))}`);
		lines.push(`  ${s.runLabels.cost} $${run.costUsd.toFixed(4)}`);
		lines.push(`  ${s.runLabels.outcome} ${run.stage}`);
	}
	const sessionCap = state.config.agent.maxCostUsdPerSession;
	const sessionCost = `$${state.agentSessionCostUsd.toFixed(4)}`;
	lines.push(
		`  ${s.runSession(state.agentRunsThisSession, sessionCost, sessionCap === 0 ? s.runUnlimited : `$${sessionCap.toFixed(2)}`)}`,
	);
	if (sessionCap > 0 && state.agentSessionCostUsd >= sessionCap) lines.push(`  ⚠ ${s.runCostCapReached}`);

	return clipRender(lines.join("\n"), input.width);
}

/** `bash ×3, edit ×2` — the top five tools by call count. A dash when the API runtime ran. */
function topTools(counts: Record<string, number>): string {
	const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
	return entries.length === 0 ? "—" : entries.map(([name, count]) => `${name} ×${count}`).join(", ");
}

/** Clip every line to `width` so a narrow terminal truncates rather than corrupts (T27). */
function clipRender(text: string, width: number | undefined): string {
	if (width === undefined || width <= 0) return text;
	return text
		.split("\n")
		.map((line) => truncateToWidth(line, width, "…"))
		.join("\n");
}

/** One table cell, padded to `width`, then the whole line clipped to the terminal. */
function fit(line: string, width: number): string {
	if (width <= 0) return line;
	return truncateToWidth(line, width, "…");
}

/** Padded cell helper: text left-aligned, numbers right-aligned, plain ASCII so `width` is measured. */
function column(value: string, width: number, right = false): string {
	const clipped = value.length > width ? value.slice(0, width) : value;
	return right ? clipped.padStart(width) : clipped.padEnd(width);
}

/**
 * The `/psych effect` table (T16): per delivered kind, the outcome numbers and whether the advice
 * was followed. Session-scoped only — a cross-session ledger is T10 and stays opt-in.
 *
 * Width-safe like the card: every line is clipped to `width` with `truncateToWidth`, so a narrow
 * terminal truncates rather than crashing the host process.
 */
export function renderEffect(input: { ledger: readonly OutcomeRecord[]; lang: Locale; width: number }): string {
	const s = stringsFor(input.lang);
	const lines: string[] = [`${s.effectTitle}`];
	const rows = effectByKind(input.ledger);
	if (rows.length === 0) {
		lines.push("", s.effectEmpty);
		return lines.map((line) => fit(line, input.width)).join("\n");
	}

	const cols = s.effectColumns;
	const kindWidth = 24;
	const numWidth = 10;
	const header =
		column(cols.kind, kindWidth) +
		column(cols.delivered, numWidth, true) +
		column(cols.improved, numWidth, true) +
		column(cols.unchanged, numWidth, true) +
		column(cols.worse, numWidth, true) +
		column(cols.followed, numWidth, true);
	lines.push("", header.trimEnd());

	for (const row of rows) {
		const line =
			column(s.labels.interventionKinds[row.kind], kindWidth) +
			column(String(row.delivered), numWidth, true) +
			column(String(row.improved), numWidth, true) +
			column(String(row.unchanged), numWidth, true) +
			column(String(row.worse), numWidth, true) +
			column(String(row.followed), numWidth, true);
		lines.push(line.trimEnd());
	}

	return lines.map((line) => fit(line, input.width)).join("\n");
}