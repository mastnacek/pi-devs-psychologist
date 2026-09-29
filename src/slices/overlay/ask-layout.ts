/**
 * ask-layout — the geometry of the `ask` card (`/psych ask <question>`, T30), with no state.
 *
 * A separate file from `layout.ts` because the ask card is a different document: a question, a
 * prose answer, its citations and the researched suggestions, and no verdict grid. It shares the
 * suggestion section and the measure/render contract, so `measureAskCard` counts exactly the lines
 * `AskView` will draw and no rendered line can exceed its width.
 */

import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { AskCardInput } from "../../shared/ask.js";
import type { Strings } from "../../shared/i18n.js";
import { FRAME_LINES, flatten, rule, suggestionLines, type CardLayout, type LayoutLine, type Painter } from "./layout.js";

export type { AskCardInput } from "../../shared/ask.js";

const CITED_ICON = "\u21b3";
const WARNING_ICON = "\u26a0";

/** Wrap a block of prose into indented rows, each no wider than `bodyWidth`. */
function proseLines(text: string, bodyWidth: number): LayoutLine[] {
	const width = Math.max(8, bodyWidth - 2);
	return wrapTextWithAnsi(text, width).map((line) => ({ text: `  ${line}` }));
}

/** A dim `↳ <citation>` row, wrapped, indented under the answer. */
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
 * Lay the ask card out at `width`. `head` is the question, the answer, the unsupported marker and
 * the citations; `tail` is the research note and the suggestions, which never scroll away.
 */
export function layoutAskCard(input: AskCardInput, s: Strings, width: number, paint: Painter): CardLayout {
	const bodyWidth = Math.max(20, width - 4);
	const head: LayoutLine[] = [];

	head.push({ text: paint.fg("dim", paint.bold(s.askQuestion)) });
	head.push(...proseLines(input.question, bodyWidth));
	head.push({ text: paint.fg("dim", paint.bold(s.askAnswer)) });
	head.push(...proseLines(input.answer, bodyWidth));
	if (input.unsupported) {
		head.push({ text: paint.fg("warning", `${WARNING_ICON} ${s.askUnsupported}`) });
	}
	head.push(...citationLines(input.cited, bodyWidth, paint));

	const tail: LayoutLine[] = [{ text: paint.fg("border", rule(width)) }];
	if (input.noResearch) {
		tail.push({ text: `  ${paint.fg("dim", s.askNoResearch)}` });
	}
	tail.push(...suggestionLines(input.suggestions, s, bodyWidth, paint));

	return { head: flatten(head), tail: flatten(tail) };
}

/** The exact line count of `layoutAskCard`, without styling or a theme. */
export function measureAskCard(
	input: AskCardInput,
	s: Strings,
	width: number,
): { head: number; tail: number; total: number } {
	const { head, tail } = layoutAskCard(input, s, width, { fg: (_c, text) => text, bold: (text) => text });
	return { head: head.length, tail: tail.length, total: FRAME_LINES + head.length + tail.length };
}
