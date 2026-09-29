/**
 * review-layout — the geometry of the `review` card (`/psych review`, T32a), with no state.
 *
 * A fourth document, so a fourth layout: the delivery anchor, the one finding class with its file,
 * its stated rule and its citation, or a single line saying the reviewer declined. It shares the
 * measure/render contract with the other three cards, so `measureReviewCard` counts exactly the
 * lines `ReviewView` draws and no rendered line exceeds width.
 */

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ReviewCardInput } from "../../shared/review.js";
import type { Strings } from "../../shared/i18n.js";
import { FRAME_LINES, flatten, type CardLayout, type LayoutLine, type Painter } from "./layout.js";

export type { ReviewCardInput } from "../../shared/review.js";

const CITED_ICON = "\u21b3";

/** The first 8 hex characters of a commit hash, which is all the anchor row needs. */
function shortHead(head: string): string {
	return head.slice(0, 8);
}

/** Wrap a block of prose into indented rows, each no wider than `bodyWidth`. */
function proseLines(text: string, bodyWidth: number): LayoutLine[] {
	const width = Math.max(8, bodyWidth - 2);
	return wrapTextWithAnsi(text, width).map((line) => ({ text: `  ${line}` }));
}

/** A dim `↳ <citation>` row, wrapped, indented under the finding. */
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
 * Lay the review card out at `width`. An abstention is exactly one line — the reviewer declined and
 * why (ADR 0001 invariant 2) — and a dropped finding says so rather than looking like a clean bill.
 */
export function layoutReviewCard(input: ReviewCardInput, s: Strings, width: number, paint: Painter): CardLayout {
	const bodyWidth = Math.max(20, width - 4);
	const clamp = Math.max(10, bodyWidth - 4);
	const head: LayoutLine[] = [];

	const prev = input.lastHead.length > 0 ? shortHead(input.lastHead) : s.reviewFirst;
	head.push({
		text: `${paint.fg("dim", paint.bold(s.reviewAnchor))} ${paint.bold(shortHead(input.head))} ${paint.fg("dim", "←")} ${paint.fg("dim", prev)}`,
	});
	if (input.sameModel) head.push({ text: paint.fg("warning", s.reviewSameModel) });

	const finding = input.finding;
	if (!finding) {
		head.push({ text: paint.fg("warning", s.reviewDropped) });
	} else if (finding.verdict === "insufficient_context") {
		head.push(...proseLines(`${s.reviewDeclined} ${finding.text}`.trim(), bodyWidth));
	} else {
		head.push({ text: paint.bold(paint.fg("accent", s.labels.reviewVerdicts[finding.verdict])) });
		head.push({ text: `  ${paint.fg("dim", s.reviewFile)} ${paint.bold(truncateToWidth(finding.file, clamp))}` });
		head.push({ text: `  ${paint.fg("dim", `${s.reviewRule}:`)} ${truncateToWidth(finding.rule, clamp)}` });
		head.push(...citationLines(finding.cited, bodyWidth, paint));
		head.push(...proseLines(finding.text, bodyWidth));
	}

	const tail: LayoutLine[] = [];
	if (input.unmatched.length > 0) {
		tail.push({ text: paint.fg("warning", s.reviewUnmatched(input.unmatched.length)) });
	}

	return { head: flatten(head), tail: flatten(tail) };
}

/** The exact line count of `layoutReviewCard`, without styling or a theme. */
export function measureReviewCard(
	input: ReviewCardInput,
	s: Strings,
	width: number,
): { head: number; tail: number; total: number } {
	const { head, tail } = layoutReviewCard(input, s, width, { fg: (_c, text) => text, bold: (text) => text });
	return { head: head.length, tail: tail.length, total: FRAME_LINES + head.length + tail.length };
}
