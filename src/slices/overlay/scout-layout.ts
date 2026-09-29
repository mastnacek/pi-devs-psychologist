/**
 * scout-layout — the geometry of the `scout` card (`/psych scout`, T31), with no state.
 *
 * A separate file from `layout.ts` and `ask-layout.ts` because the scout card is a third document:
 * a topic, a list of existing packages with their fit and install spec, and optionally the
 * ready-to-paste SPAI idea line. It shares the measure/render contract with the other two, so
 * `measureScoutCard` counts exactly the lines `ScoutView` draws and no rendered line exceeds width.
 */

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ScoutCardInput } from "../../shared/scout.js";
import type { Strings } from "../../shared/i18n.js";
import { FRAME_LINES, flatten, rule, type CardLayout, type LayoutLine, type Painter } from "./layout.js";

export type { ScoutCardInput } from "../../shared/scout.js";

const CITED_ICON = "\u21b3";

/** Wrap a block of prose into indented rows, each no wider than `bodyWidth`. */
function proseLines(text: string, bodyWidth: number): LayoutLine[] {
	const width = Math.max(8, bodyWidth - 2);
	return wrapTextWithAnsi(text, width).map((line) => ({ text: `  ${line}` }));
}

/** A dim `↳ <citation>` row, wrapped, indented under the candidates. */
function citationLines(cited: readonly string[], bodyWidth: number, paint: Painter): LayoutLine[] {
	const arrow = `  ${paint.fg("dim", CITED_ICON)} `;
	const available = Math.max(8, bodyWidth - visibleWidth(arrow));
	return cited.flatMap((line) =>
		wrapTextWithAnsi(line, available).map((piece, i) => ({
			text: i === 0 ? `${arrow}${paint.fg("dim", piece)}` : `    ${paint.fg("dim", piece)}`,
		})),
	);
}

/**
 * Lay the scout card out at `width`. `head` is the topic, the candidate list and the citations;
 * `tail` is the SPAI idea line, which never scrolls away.
 */
export function layoutScoutCard(input: ScoutCardInput, s: Strings, width: number, paint: Painter): CardLayout {
	const bodyWidth = Math.max(20, width - 4);
	const clamp = Math.max(10, bodyWidth - 2);
	const head: LayoutLine[] = [];

	if (input.topic !== undefined) {
		head.push({ text: paint.fg("dim", paint.bold(s.scoutTopic)) });
		head.push(...proseLines(input.topic, bodyWidth));
	}

	head.push({ text: paint.fg("dim", paint.bold(s.scoutCandidates)) });
	if (input.candidates.length === 0) {
		if (input.nothingFound) head.push({ text: `  ${paint.fg("dim", s.scoutNothingFound)}` });
	} else {
		for (const candidate of input.candidates) {
			head.push({
				text: `  ${paint.bold(candidate.name)} ${paint.fg("dim", "·")} ${paint.fg("accent", s.labels.scoutFits[candidate.fit])}`,
			});
			head.push(...proseLines(candidate.why, bodyWidth));
			head.push({ text: `  ${paint.fg("dim", truncateToWidth(candidate.installSpec, clamp))}` });
			head.push({ text: `  ${paint.fg("dim", truncateToWidth(candidate.url, clamp))}` });
		}
	}
	head.push(...citationLines(input.cited, bodyWidth, paint));

	const tail: LayoutLine[] = [{ text: paint.fg("border", rule(width)) }];
	if (input.ideaLine !== undefined) {
		tail.push({ text: paint.fg("dim", paint.bold(s.scoutIdea)) });
		for (const line of wrapTextWithAnsi(input.ideaLine, Math.max(10, bodyWidth - 2))) {
			tail.push({ text: `  ${paint.bold(line)}` });
		}
	}

	return { head: flatten(head), tail: flatten(tail) };
}

/** The exact line count of `layoutScoutCard`, without styling or a theme. */
export function measureScoutCard(
	input: ScoutCardInput,
	s: Strings,
	width: number,
): { head: number; tail: number; total: number } {
	const { head, tail } = layoutScoutCard(input, s, width, { fg: (_c, text) => text, bold: (text) => text });
	return { head: head.length, tail: tail.length, total: FRAME_LINES + head.length + tail.length };
}