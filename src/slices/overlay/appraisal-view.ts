/**
 * AppraisalView — the card: state, frame and keys.
 *
 * All geometry lives in `layout.ts`, so this file holds only what depends on interaction:
 * how far the verdict list is scrolled and the frame around it.
 *
 * Three rules survive the styling:
 *
 * - Every rendered line is truncated to the supplied width. The terminal can be arbitrarily
 *   narrow and an overflowing line corrupts the whole frame.
 * - Styling is applied per line at render time, because Pi resets styles per line; nothing
 *   is cached with ANSI embedded. Padding is computed on *visible* width — emoji are two
 *   cells, ANSI escapes are zero.
 * - The intervention block is never scrolled and never clipped. A card too tall for the
 *   terminal scrolls its verdicts instead.
 *
 * Read-only on purpose. The card reports; it does not ask the operator to choose, because a
 * choice is an action surface and that belongs to `pi-quick-win` (ADR 0001). Any of
 * escape / enter / ctrl+c closes it, so no key combination is a trap.
 */

import type { Component } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { DEFAULT_LOCALE, stringsFor, type Locale, type Strings } from "../../shared/i18n.js";
import { PLUGIN_VERSION } from "../../shared/version.js";
import {
	FRAME_LINES,
	headWindow,
	layoutCard,
	windowHead,
	type CardInput,
	type LayoutLine,
} from "./layout.js";

export interface AppraisalViewOptions {
	locale?: Locale;
	/**
	 * Rows the card may occupy, including the frame. The presenter computes it from the
	 * measured content, so a short card gets a short window and a long one scrolls rather
	 * than being clipped.
	 */
	maxHeight?: number;
}

export class AppraisalView implements Component {
	private scroll = 0;
	private readonly strings: Strings;
	private readonly maxHeight: number | undefined;

	constructor(
		private readonly input: CardInput,
		private readonly theme: Theme,
		private readonly done: () => void,
		options: AppraisalViewOptions = {},
	) {
		this.strings = stringsFor(options.locale ?? DEFAULT_LOCALE);
		this.maxHeight = options.maxHeight;
	}

	invalidate(): void {
		// Rendering is stateless apart from `scroll`, which is the state.
	}

	handleInput(data: string): void {
		// Only the keys the footer advertises: a shortcut the card does not show is a hidden
		// affordance. Every close key is listed, so nothing is a trap.
		if (matchesKey(data, "escape") || matchesKey(data, "return") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.scroll = Math.max(0, this.scroll - this.page());
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.scroll += this.page();
			return;
		}
		if (matchesKey(data, "up")) {
			this.scroll = Math.max(0, this.scroll - 1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.scroll += 1;
		}
	}

	private page(): number {
		const window = this.maxHeight ? headWindow(this.maxHeight, 1) : 1;
		return Math.max(1, window - 1);
	}

	render(width: number): string[] {
		const { head, tail } = layoutCard(this.input, this.strings, width, this.theme);
		// The layout is already flattened to one entry per row, so these counts agree with
		// what the frame will actually draw.
		const budget = this.maxHeight ?? FRAME_LINES + head.length + tail.length;
		const window = headWindow(budget, tail.length);
		const view = windowHead(head, window, this.scroll, this.theme);
		// Keep the offset inside the window: the card can be re-laid out at a different width
		// between renders, and a stale offset would hide content.
		this.scroll = Math.min(this.scroll, view.hiddenAbove + view.hiddenBelow);

		const body: LayoutLine[] = [...view.lines, ...tail];
		body.push({ text: this.footer(view.hiddenAbove > 0 || view.hiddenBelow > 0) });
		return this.frame(body, width);
	}

	/** Key hints with coloured glyphs; the scroll hint appears only when it would work. */
	private footer(scrollable: boolean): string {
		const th = this.theme;
		const key = (glyph: string, text: string) =>
			`${th.bold(th.fg("accent", glyph))} ${th.fg("dim", text)}`;
		const parts = [key("esc/⏎", this.strings.cardFooter.close)];
		if (scrollable) parts.unshift(key("PgUp/PgDn", this.strings.cardFooter.scroll));
		return parts.join(` ${th.fg("border", "·")} `);
	}

	/** Draw the border, clamping every interior line to the usable width. */
	private frame(body: readonly LayoutLine[], width: number): string[] {
		const th = this.theme;
		const inner = Math.max(1, width - 2);
		const lines: string[] = [this.header(inner)];

		for (const { text } of body) {
			for (const piece of text.split("\n")) {
				// One space of breathing room on each side: content must not hug the border.
				const padded = `${this.pad(` ${piece}`, inner - 1)} `;
				lines.push(`${th.fg("borderAccent", "│")}${padded}${th.fg("borderAccent", "│")}`);
			}
		}
		lines.push(
			`${th.fg("borderAccent", "╰")}${th.fg("borderAccent", "─".repeat(inner))}${th.fg("borderAccent", "╯")}`,
		);
		return lines.map((line) => truncateToWidth(line, width));
	}

	/** Top border: accent title with the build version and a dim rule. */
	private header(inner: number): string {
		const th = this.theme;
		// The version is not decoration: it names the build that rendered this card, so a
		// stale runtime is visible instead of debatable.
		const title = th.bold(th.fg("accent", ` 🧠 ${this.strings.cardTitle} v${PLUGIN_VERSION} `));
		const fill = Math.max(0, inner - visibleWidth(title));
		return `${th.fg("borderAccent", "╭")}${title}${th.fg("border", "─".repeat(fill))}${th.fg("borderAccent", "╮")}`;
	}

	private pad(text: string, inner: number): string {
		const clipped = truncateToWidth(text, inner);
		// Padding is computed on the *visible* width: wide characters, emoji and ANSI escapes
		// all make string length the wrong measure.
		return `${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))}`;
	}
}