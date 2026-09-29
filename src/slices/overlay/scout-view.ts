/**
 * ScoutView — the `/psych scout` card: the friction, the existing packages found for it, and the
 * ready-to-paste SPAI idea line when nothing fits.
 *
 * The frame and the width discipline are the appraisal and ask cards' (see `appraisal-view.ts`):
 * every line is truncated to the supplied width, styling is applied per line, and padding is
 * computed on *visible* width. Only the body differs: this card draws `layoutScoutCard`.
 *
 * Read-only and scrollable like the other cards. The SPAI line is shown whole and never truncated
 * away, because the whole point of it is that the operator copies it.
 */

import type { Component } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { DEFAULT_LOCALE, stringsFor, type Locale, type Strings } from "../../shared/i18n.js";
import { PLUGIN_VERSION } from "../../shared/version.js";
import { FRAME_LINES, headWindow, windowHead, type LayoutLine } from "./layout.js";
import { layoutScoutCard, type ScoutCardInput } from "./scout-layout.js";

export interface ScoutViewOptions {
	locale?: Locale;
	/** Rows the card may occupy, including the frame; measured by the presenter, never guessed. */
	maxHeight?: number;
	/** Repaint after the component changes its own state (pi-tui does not re-render on input). */
	requestRender?: () => void;
}

export class ScoutView implements Component {
	private scroll = 0;
	private readonly strings: Strings;
	private readonly maxHeight: number | undefined;
	private readonly requestRender: (() => void) | undefined;

	constructor(
		private readonly input: ScoutCardInput,
		private readonly theme: Theme,
		private readonly done: () => void,
		options: ScoutViewOptions = {},
	) {
		this.strings = stringsFor(options.locale ?? DEFAULT_LOCALE);
		this.maxHeight = options.maxHeight;
		this.requestRender = options.requestRender;
	}

	invalidate(): void {
		// Stateless apart from `scroll`, which is the state.
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "return") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.scrollTo(Math.max(0, this.scroll - this.page()));
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.scrollTo(this.scroll + this.page());
			return;
		}
		if (matchesKey(data, "up")) {
			this.scrollTo(Math.max(0, this.scroll - 1));
			return;
		}
		if (matchesKey(data, "down")) {
			this.scrollTo(this.scroll + 1);
		}
	}

	private scrollTo(next: number): void {
		if (next === this.scroll) return;
		this.scroll = next;
		this.requestRender?.();
	}

	private page(): number {
		const window = this.maxHeight ? headWindow(this.maxHeight, 1) : 1;
		return Math.max(1, window - 1);
	}

	render(width: number): string[] {
		const { head, tail } = layoutScoutCard(this.input, this.strings, width, this.theme);
		const budget = this.maxHeight ?? FRAME_LINES + head.length + tail.length;
		const window = headWindow(budget, tail.length);
		const view = windowHead(head, window, this.scroll, this.theme);
		this.scroll = Math.min(this.scroll, view.hiddenAbove + view.hiddenBelow);

		const body: LayoutLine[] = [...view.lines, ...tail];
		body.push({ text: this.footer(view.hiddenAbove > 0 || view.hiddenBelow > 0) });
		return this.frame(body, width);
	}

	private footer(scrollable: boolean): string {
		const th = this.theme;
		const key = (glyph: string, text: string) =>
			`${th.bold(th.fg("accent", glyph))} ${th.fg("dim", text)}`;
		const parts = [key("esc/⏎", this.strings.cardFooter.close)];
		if (scrollable) parts.unshift(key("PgUp/PgDn", this.strings.cardFooter.scroll));
		return parts.join(` ${th.fg("border", "·")} `);
	}

	private frame(body: readonly LayoutLine[], width: number): string[] {
		const th = this.theme;
		const inner = Math.max(1, width - 2);
		const lines: string[] = [this.header(inner)];

		for (const { text } of body) {
			for (const piece of text.split("\n")) {
				const padded = `${this.pad(` ${piece}`, inner - 1)} `;
				lines.push(`${th.fg("borderAccent", "│")}${padded}${th.fg("borderAccent", "│")}`);
			}
		}
		lines.push(
			`${th.fg("borderAccent", "╰")}${th.fg("borderAccent", "─".repeat(inner))}${th.fg("borderAccent", "╯")}`,
		);
		return lines.map((line) => truncateToWidth(line, width));
	}

	private header(inner: number): string {
		const th = this.theme;
		const title = th.bold(th.fg("accent", ` 🔭 ${this.strings.reportTitle} v${PLUGIN_VERSION} `));
		const fill = Math.max(0, inner - visibleWidth(title));
		return `${th.fg("borderAccent", "╭")}${title}${th.fg("border", "─".repeat(fill))}${th.fg("borderAccent", "╮")}`;
	}

	private pad(text: string, inner: number): string {
		const clipped = truncateToWidth(text, inner);
		return `${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))}`;
	}
}