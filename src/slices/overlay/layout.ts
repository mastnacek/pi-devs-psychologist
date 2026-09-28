/**
 * Card layout — the geometry of the appraisal card, with no state and no chrome.
 *
 * Split out of the view for the same reason `pi-quick-win` does it: the presenter must know
 * how many lines the card needs *before* it can size the overlay, and a height that is
 * guessed wrong clips content out of the window. So the line count and the line content come
 * from one function, and the presenter measures the very lines the view will draw.
 *
 * Styling is injected as a tiny `Painter` because the number of lines must not depend on the
 * theme: ANSI escapes are zero-width, so the same layout is a line longer or shorter
 * depending on whether colour was applied. `measureCard()` passes an identity painter and
 * gets the exact count.
 *
 * Two zones, and which one may be clipped is the whole design:
 *   - `head` — the verdicts and their citations. Variable length. **Scrolls.**
 *   - `tail` — the one intervention and the key hints. **Never clipped.** An intervention
 *     window whose intervention is off-screen is not an intervention window.
 */

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Appraisal, NeedKey } from "../../shared/appraisal.js";
import { NEEDS } from "../../shared/appraisal.js";
import { STALE_DELIVERY_TURNS } from "../../shared/delivery.js";
import type { Strings } from "../../shared/i18n.js";

/** The two style operations the layout needs; `Theme` satisfies it. */
export interface Painter {
	fg(color: ThemeColor, text: string): string;
	bold(text: string): string;
}

/** One rendered body line. One entry is one terminal row. */
export interface LayoutLine {
	text: string;
}

export interface CardLayout {
	head: LayoutLine[];
	tail: LayoutLine[];
}

export interface CardInput {
	appraisal: Appraisal;
	/** Citations the model gave that matched no evidence line. Shown, not hidden. */
	unmatched: string[];
	/**
	 * Turns between when the run started and when it is shown (T26). Present only when the gap is
	 * worth naming; the card then says the appraisal describes a session that has moved on.
	 */
	staleTurns?: number;
}

/** Icons are language-neutral, so they stay in the layout rather than the string table. */
const ICONS = {
	progress: "📈",
	load: "🧠",
	flow: "🌊",
	intervention: "⚑",
	cited: "↳",
	warning: "⚠",
} as const;

const NEED_ICONS: Record<NeedKey, string> = {
	autonomy: "🕹",
	competence: "🎯",
	relatedness: "👥",
};

const NEED_COLORS: Record<NeedKey, ThemeColor> = {
	autonomy: "accent",
	competence: "success",
	relatedness: "borderAccent",
};

/** Top and bottom border. */
export const FRAME_LINES = 2;

/** The identity painter used for measuring. */
const IDENTITY: Painter = { fg: (_color, text) => text, bold: (text) => text };

/** Wrap one field: head first, continuation lines indented to the head's width. */
function wrap(head: string, value: string, width: number, headWidth: number): string {
	const indent = " ".repeat(headWidth);
	const available = Math.max(8, width - 2 - headWidth);
	return wrapTextWithAnsi(value, available)
		.map((line, i) =>
			i === 0
				? `${head}${" ".repeat(Math.max(0, headWidth - visibleWidth(head)))}${line}`
				: `${indent}${line}`,
		)
		.join("\n");
}

/** A dim `↳ <citation>` continuation line, indented under its verdict. */
function citationLines(cited: readonly string[], indent: number, width: number, paint: Painter): LayoutLine[] {
	const pad = " ".repeat(indent);
	const arrow = `${pad}${paint.fg("dim", ICONS.cited)} `;
	const available = Math.max(8, width - 2 - visibleWidth(arrow));
	return cited.flatMap((line) =>
		wrapTextWithAnsi(line, available).map((piece, i) => ({
			text: i === 0 ? `${arrow}${paint.fg("dim", piece)}` : `${pad}   ${paint.fg("dim", piece)}`,
		})),
	);
}

/** `🧠 Load          high` — label column padded on visible width. */
function verdictLine(
	icon: string,
	label: string,
	value: string,
	col: number,
	paint: Painter,
	color: ThemeColor,
): string {
	const head = `${paint.bold(paint.fg(color, `${icon} ${label}`))}`;
	const gap = Math.max(1, col - visibleWidth(`${icon} ${label}`));
	return `${head}${" ".repeat(gap)}${value}`;
}

/** Label column width across every verdict row, recomputed per locale. */
export function labelCol(s: Strings): number {
	const widths = [
		visibleWidth(`${ICONS.progress} ${s.fields.progress}`),
		visibleWidth(`${ICONS.load} ${s.fields.load}`),
		visibleWidth(`${ICONS.flow} ${s.fields.flow}`),
		...NEEDS.map((need) => visibleWidth(`${NEED_ICONS[need]} ${s.labels.needs[need]}`)),
	];
	return Math.max(...widths) + 2;
}

/**
 * Lay the card out at `width`.
 *
 * Neutral verdicts render too, with no citation. A card that showed only the non-neutral
 * rows would make "we have nothing to say about this" indistinguishable from "we did not
 * look", which is the distinction the whole plugin is built on.
 */
export function layoutCard(input: CardInput, s: Strings, width: number, paint: Painter): CardLayout {
	const col = labelCol(s);
	const head: LayoutLine[] = [];
	const bodyWidth = Math.max(20, width - 4);

	// Staleness first: the caveat belongs above the verdicts it qualifies. One line, so the measured
	// height stays exact — `measureCard` runs the same function.
	if (input.staleTurns !== undefined && input.staleTurns >= STALE_DELIVERY_TURNS) {
		head.push({ text: paint.fg("warning", s.cardStaleTurns(input.staleTurns)) });
	}

	head.push({ text: paint.fg("dim", paint.bold(s.cardVerdicts)) });

	const row = (icon: string, label: string, value: string, cited: readonly string[], color: ThemeColor) => {
		head.push({ text: verdictLine(icon, label, paint.bold(value), col, paint, color) });
		head.push(...citationLines(cited, col, bodyWidth, paint));
	};

	row(
		ICONS.progress,
		s.fields.progress,
		s.labels.progressStates[input.appraisal.progress.state],
		input.appraisal.progress.cited,
		"accent",
	);
	for (const need of NEEDS) {
		const verdict = input.appraisal.needs[need];
		row(NEED_ICONS[need], s.labels.needs[need], s.labels.needStates[verdict.state], verdict.cited, NEED_COLORS[need]);
	}
	row(
		ICONS.load,
		s.fields.load,
		s.labels.loadLevels[input.appraisal.load.level],
		input.appraisal.load.cited,
		"warning",
	);
	row(
		ICONS.flow,
		s.fields.flow,
		s.labels.flowStates[input.appraisal.flow.state],
		input.appraisal.flow.cited,
		"borderAccent",
	);

	if (input.unmatched.length > 0) {
		head.push({ text: "" });
		head.push({
			text: paint.fg("warning", `${ICONS.warning} ${s.cardUnmatched(input.unmatched.length)}`),
		});
	}

	const tail: LayoutLine[] = [{ text: paint.fg("border", rule(width)) }];
	const intervention = input.appraisal.interventions[0];
	if (intervention) {
		tail.push({
			text: `${paint.bold(paint.fg("success", ICONS.intervention))} ${paint.fg("dim", s.cardIntervention)} ${paint.fg("dim", "·")} ${paint.fg("success", s.labels.interventionKinds[intervention.kind])}`,
		});
		for (const line of wrapTextWithAnsi(intervention.text, Math.max(10, bodyWidth - 2))) {
			tail.push({ text: `  ${paint.bold(line)}` });
		}
		tail.push(...citationLines(intervention.cited, 2, bodyWidth, paint));
	} else {
		// No intervention is one thing; no citation anywhere is another. If nothing was cited, the
		// appraisal holds no verdict, and "that is a normal outcome" would be a claim the model
		// never made.
		const cited = [
			input.appraisal.progress,
			input.appraisal.load,
			input.appraisal.flow,
			...NEEDS.map((need) => input.appraisal.needs[need]),
		].some((verdict) => verdict.cited.length > 0);
		tail.push({ text: `  ${paint.fg("dim", cited ? s.cardNothingToAct : s.cardNoObservation)}` });
	}

	// Researched suggestions (T25): the operator's alone. One clamped line per suggestion and its
	// enforced source on its own dim line, so a narrow terminal truncates instead of wrapping into a
	// count the frame does not expect. Omitted entirely when there are none.
	const suggestions = input.appraisal.suggestions ?? [];
	if (suggestions.length > 0) {
		const clamp = Math.max(10, bodyWidth - 2);
		tail.push({ text: paint.fg("dim", paint.bold(s.cardSuggestions)) });
		for (const suggestion of suggestions) {
			tail.push({ text: `  ${paint.bold(truncateToWidth(`• ${suggestion.text}`, clamp))}` });
			tail.push({ text: `  ${paint.fg("dim", truncateToWidth(suggestion.source, clamp))}` });
		}
	}
	tail.push({ text: paint.fg("border", rule(width)) });

	return { head: flatten(head), tail: flatten(tail) };
}

/** Expand embedded newlines so one entry is one row, as the frame expects. */
export function flatten(lines: readonly LayoutLine[]): LayoutLine[] {
	return lines.flatMap((line) => line.text.split("\n").map((text) => ({ text })));
}

/** The exact line count of `layoutCard`, without styling or a theme. */
export function measureCard(
	input: CardInput,
	s: Strings,
	width: number,
): { head: number; tail: number; total: number } {
	const { head, tail } = layoutCard(input, s, width, IDENTITY);
	return { head: head.length, tail: tail.length, total: FRAME_LINES + head.length + tail.length };
}

/** A full-width dim rule; two columns narrower than the frame's body padding. */
export function rule(width: number): string {
	return "─".repeat(Math.max(0, width - 4));
}

/** How many head lines the card may show before the frame and the tail. */
export function headWindow(maxHeight: number, tailLines: number): number {
	return Math.max(1, maxHeight - FRAME_LINES - tailLines);
}

export interface HeadWindow {
	lines: LayoutLine[];
	hiddenAbove: number;
	hiddenBelow: number;
}

/**
 * Window the head into `window` rows, scrolled by `scroll`. When the head does not fit one
 * row is spent on the scroll hint: the intervention staying complete matters more than one
 * more line of prose.
 */
export function windowHead(
	head: readonly LayoutLine[],
	window: number,
	scroll: number,
	paint: Painter,
): HeadWindow {
	if (head.length <= window) return { lines: [...head], hiddenAbove: 0, hiddenBelow: 0 };
	const visible = Math.max(1, window - 1);
	const maxScroll = head.length - visible;
	const offset = Math.min(Math.max(0, scroll), maxScroll);
	const hiddenAbove = offset;
	const hiddenBelow = head.length - offset - visible;
	const sign = (n: number) => (n > 0 ? String(n) : "0");
	return {
		lines: [
			{ text: paint.fg("dim", `↑${sign(hiddenAbove)} ↓${sign(hiddenBelow)}`) },
			...head.slice(offset, offset + visible),
		],
		hiddenAbove,
		hiddenBelow,
	};
}