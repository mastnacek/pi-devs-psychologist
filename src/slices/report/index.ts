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
import { stringsFor, type Locale } from "../../shared/i18n.js";
import type { DevsPsychologistState } from "../../shared/state.js";
import { PLUGIN_VERSION } from "../../shared/version.js";

export interface ReportInput {
	state: DevsPsychologistState;
	/** Live window evidence lines, in prompt order. */
	signals: readonly string[];
	/** Session record evidence lines. */
	history: readonly string[];
	lang: Locale;
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
	if (state.config.model.trim().length === 0) {
		lines.push("", `⚠ ${s.reportNoModel}`);
		return lines.join("\n");
	}

	// Budget first: it is the number that explains every silence.
	const cap = state.config.maxAppraisalsPerSession;
	lines.push(
		"",
		`model     ${state.config.model}`,
		`${s.reportBudget(state.appraisalsThisSession, cap === 0 ? "∞" : String(cap))}`,
		`cadence   ${state.turnsSinceAppraisal}/${state.config.cadenceTurns} turns since the last attempt`,
	);

	lines.push("", heading(s.reportSignals));
	if (input.signals.length === 0) lines.push(bullet(s.reportEmpty));
	for (const line of input.signals) lines.push(bullet(line));

	lines.push("", heading(s.reportSession));
	if (input.history.length === 0) lines.push(bullet(s.reportEmpty));
	for (const line of input.history) lines.push(bullet(line));

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

	return lines.join("\n");
}