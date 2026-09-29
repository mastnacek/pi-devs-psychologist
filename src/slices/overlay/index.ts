/**
 * Overlay slice — presents the appraisal card.
 *
 * The only place that may touch `ctx.ui.custom()`, and it is gated twice: `mode === "tui"`
 * (a terminal component cannot render anywhere else) and `hasUI` (dialogs exist in TUI *and*
 * RPC, so `hasUI` alone is not enough — `custom()` returns `undefined` in RPC and
 * `onTerminalInput()` is a no-op). `false` means "no interactive surface here" and the caller
 * falls back to a plain notification.
 *
 * Sizing is measured, not guessed. A fixed `maxHeight` is what clips the bottom of a card out
 * of the window: the engine cuts the overlay at the terminal height and rows below the fold
 * simply do not exist. The card's real height now comes from the same layout the view draws,
 * clamped to what the terminal can show, so a short card gets a small window and a long one
 * scrolls its verdicts instead of losing its intervention.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_LOCALE, stringsFor, type Locale } from "../../shared/i18n.js";
import { AppraisalView } from "./appraisal-view.js";
import { AskView } from "./ask-view.js";
import { measureAskCard, type AskCardInput } from "./ask-layout.js";
import { ScoutView } from "./scout-view.js";
import { measureScoutCard, type ScoutCardInput } from "./scout-layout.js";
import { ReviewView } from "./review-view.js";
import { measureReviewCard, type ReviewCardInput } from "./review-layout.js";
import { FRAME_LINES, measureCard, type CardInput } from "./layout.js";

/** Preferred card width in columns; never wider than the terminal. */
const CARD_WIDTH = 76;

/** Rows kept free above and below the card so it never touches the edges. */
const TERMINAL_MARGIN = 2;

/** Smallest card worth showing: header, one verdict and the intervention. */
export const MIN_CARD_HEIGHT = 9;

/**
 * Terminal size, with honest fallbacks. `process.stdout.rows` is correct on Windows, Linux
 * and macOS for a real TTY and undefined when output is piped; the fallbacks only matter for
 * that case, where the card uses a conservative window and scrolls.
 */
function terminalSize(): { columns: number; rows: number } {
	const columns = process.stdout?.columns;
	const rows = process.stdout?.rows;
	return {
		columns: typeof columns === "number" && columns > 0 ? columns : 100,
		rows: typeof rows === "number" && rows > 0 ? rows : 40,
	};
}

/**
 * Show the appraisal card. Returns whether it was displayed.
 *
 * `true` means the overlay ran, regardless of how the operator closed it — the card is
 * read-only, so there is no choice to report. A UI failure returns `false` rather than
 * throwing, because an overlay that cannot render must never cost the agent its turn; the
 * caller falls back to a notification.
 */
export async function presentAppraisal(
	ctx: ExtensionContext,
	input: CardInput,
	lang: Locale = DEFAULT_LOCALE,
): Promise<boolean> {
	if (ctx.mode !== "tui" || !ctx.hasUI) return false;

	const term = terminalSize();
	const width = Math.max(40, Math.min(CARD_WIDTH, term.columns));
	// The measurement uses the same width the overlay will be given, so the count is the
	// count — not an estimate the engine then contradicts.
	const natural = measureCard(input, stringsFor(lang), width).total;
	const maxHeight = Math.max(MIN_CARD_HEIGHT, Math.min(natural, term.rows - TERMINAL_MARGIN));

	try {
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) =>
				new AppraisalView(input, theme, () => done(), {
					locale: lang,
					maxHeight,
					requestRender: () => tui.requestRender(),
				}),
			{ overlay: true, overlayOptions: { anchor: "center", width, maxHeight } },
		);
		return true;
	} catch {
		return false;
	}
}

export { AppraisalView } from "./appraisal-view.js";
export { AskView } from "./ask-view.js";
export { layoutAskCard, measureAskCard, type AskCardInput } from "./ask-layout.js";
export { ScoutView } from "./scout-view.js";
export { layoutScoutCard, measureScoutCard, type ScoutCardInput } from "./scout-layout.js";
export { ReviewView } from "./review-view.js";
export { layoutReviewCard, measureReviewCard, type ReviewCardInput } from "./review-layout.js";
export { FRAME_LINES, measureCard, type CardInput } from "./layout.js";

/**
 * Show the `ask` card (`/psych ask`, T30). Returns whether it was displayed.
 *
 * Same contract as `presentAppraisal`: `false` where no interactive surface exists (RPC, non-TUI,
 * or a failed overlay), so the caller falls back to a notification rather than losing the answer.
 */
export async function presentAsk(
	ctx: ExtensionContext,
	input: AskCardInput,
	lang: Locale = DEFAULT_LOCALE,
): Promise<boolean> {
	if (ctx.mode !== "tui" || !ctx.hasUI) return false;

	const term = terminalSize();
	const width = Math.max(40, Math.min(CARD_WIDTH, term.columns));
	const natural = measureAskCard(input, stringsFor(lang), width).total;
	const maxHeight = Math.max(MIN_CARD_HEIGHT, Math.min(natural, term.rows - TERMINAL_MARGIN));

	try {
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) =>
				new AskView(input, theme, () => done(), {
					locale: lang,
					maxHeight,
					requestRender: () => tui.requestRender(),
				}),
			{ overlay: true, overlayOptions: { anchor: "center", width, maxHeight } },
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * Show the `scout` card (`/psych scout`, T31). Returns whether it was displayed.
 *
 * Same contract as the other two presenters: `false` where no interactive surface exists, so the
 * caller falls back to a notification rather than losing the candidates.
 */
export async function presentScout(
	ctx: ExtensionContext,
	input: ScoutCardInput,
	lang: Locale = DEFAULT_LOCALE,
): Promise<boolean> {
	if (ctx.mode !== "tui" || !ctx.hasUI) return false;

	const term = terminalSize();
	const width = Math.max(40, Math.min(CARD_WIDTH, term.columns));
	const natural = measureScoutCard(input, stringsFor(lang), width).total;
	const maxHeight = Math.max(MIN_CARD_HEIGHT, Math.min(natural, term.rows - TERMINAL_MARGIN));

	try {
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) =>
				new ScoutView(input, theme, () => done(), {
					locale: lang,
					maxHeight,
					requestRender: () => tui.requestRender(),
				}),
			{ overlay: true, overlayOptions: { anchor: "center", width, maxHeight } },
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * Show the `review` card (`/psych review`, T32a). Returns whether it was displayed.
 *
 * Same contract as the other presenters: `false` where no interactive surface exists, so the caller
 * falls back to a notification rather than losing the finding.
 */
export async function presentReview(
	ctx: ExtensionContext,
	input: ReviewCardInput,
	lang: Locale = DEFAULT_LOCALE,
): Promise<boolean> {
	if (ctx.mode !== "tui" || !ctx.hasUI) return false;

	const term = terminalSize();
	const width = Math.max(40, Math.min(CARD_WIDTH, term.columns));
	const natural = measureReviewCard(input, stringsFor(lang), width).total;
	const maxHeight = Math.max(MIN_CARD_HEIGHT, Math.min(natural, term.rows - TERMINAL_MARGIN));

	try {
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) =>
				new ReviewView(input, theme, () => done(), {
					locale: lang,
					maxHeight,
					requestRender: () => tui.requestRender(),
				}),
			{ overlay: true, overlayOptions: { anchor: "center", width, maxHeight } },
		);
		return true;
	} catch {
		return false;
	}
}