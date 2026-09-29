/**
 * history/render — the `/psych history` table.
 *
 * Plain text with no theme, like the rest of the report: it has to be readable in a notification
 * and in a test. Every line is clipped to the terminal width (`truncateToWidth`), so a narrow
 * terminal truncates rather than corrupting the host process.
 *
 * The table is the whole point of the record: sessions recorded, the date range, and the per-kind
 * four-way split. It contains no score, no streak, no rate and no word that reads the operator
 * (PRD §5) — and a test asserts exactly that.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import { stringsFor, type Locale } from "../../shared/i18n.js";
import type { HistorySummary } from "../../shared/history-store.js";

export interface HistoryReportInput {
	summary: HistorySummary;
	/** The JSONL path, named so the operator knows what to delete to erase the record. */
	path: string;
	/** Lines that were not returned by the read (old, unreadable, or key-mismatched). */
	dropped: number;
	lang: Locale;
	/** Terminal width; `0` means no clipping. */
	width: number;
}

/** ISO calendar day, so the range is a fact with no locale guesswork. */
function day(at: number): string {
	return new Date(at).toISOString().slice(0, 10);
}

/** `yyyymmdd`-free padding helpers, ASCII only, so `width` measures what the terminal shows. */
function column(value: string, width: number, right = false): string {
	const clipped = value.length > width ? value.slice(0, width) : value;
	return right ? clipped.padStart(width) : clipped.padEnd(width);
}

function fit(line: string, width: number): string {
	if (width <= 0) return line;
	return truncateToWidth(line, width, "…");
}

/** Render the record. Pure: no UI, no clock, no filesystem. */
export function renderHistory(input: HistoryReportInput): string {
	const s = stringsFor(input.lang);
	const { summary } = input;
	const lines: string[] = [s.historyTitle];
	const total = summary.sessions + summary.deliveries;

	if (total === 0) {
		// "Nothing happened" and "everything was dropped" are different facts, and the record says
		// which: an empty table after a retention purge must not read as a quiet week.
		lines.push("", input.dropped > 0 ? s.historyAllDropped(input.dropped) : s.historyNoVerdicts);
		lines.push(s.historyRecordPath(input.path));
		return lines.map((line) => fit(line, input.width)).join("\n");
	}

	lines.push("", s.historySessions(summary.sessions));
	lines.push(
		summary.firstAt !== undefined && summary.lastAt !== undefined
			? s.historyRange(day(summary.firstAt), day(summary.lastAt))
			: s.historyRangeEmpty,
	);

	if (summary.deliveries === 0) {
		lines.push("", s.historyNoVerdicts);
	} else {
		const cols = s.historyColumns;
		const kindWidth = 24;
		const numWidth = 11;
		lines.push(
			"",
			(
				column(cols.kind, kindWidth) +
				column(cols.improved, numWidth, true) +
				column(cols.unchanged, numWidth, true) +
				column(cols.worse, numWidth, true) +
				column(cols.unresolved, numWidth, true)
			).trimEnd(),
		);
		for (const tally of summary.byKind) {
			lines.push(
				(
					column(tally.kind, kindWidth) +
					column(String(tally.improved), numWidth, true) +
					column(String(tally.unchanged), numWidth, true) +
					column(String(tally.worse), numWidth, true) +
					column(String(tally.unresolved), numWidth, true)
				).trimEnd(),
			);
		}
	}

	lines.push("", s.historyRecordPath(input.path));
	return lines.map((line) => fit(line, input.width)).join("\n");
}
