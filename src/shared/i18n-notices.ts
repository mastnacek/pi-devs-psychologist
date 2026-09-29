/**
 * i18n-notices — the vocabulary for the zero-token notices the plugin leaves behind.
 *
 * Split out of the main table by concept (and to keep each file under the line budget): these are
 * the one-line summaries that are not part of a card, a report or a command, starting with the
 * handoff line offered at the start of the next session.
 */

export interface NoticeStrings {
	/**
	 * The one-line handoff summary offered at `session_start` of the next session: the counts left
	 * by the previous one. Never a score, never a mood, never a claim about the person. `topFile`
	 * names the most-mutated still-unverified path when there is one — a fact about the work.
	 */
	handoffNotify: (unverified: number, openLoops: number, bookmarks: number, failing: number, topFile?: string) => string;
	/**
	 * One line after held items are released (flow shield): how many cards/notices were held while a
	 * `protect_flow` intervention was unresolved. Counts only.
	 */
	flowShieldReleased: (count: number) => string;
}

export const NOTICE_EN: NoticeStrings = {
	handoffNotify: (unverified, openLoops, bookmarks, failing, topFile) =>
		`Last session: ${unverified} unverified change(s)${topFile ? ` (top: ${topFile})` : ""}, ${openLoops} open loop(s), ${bookmarks} bookmark(s), ${failing} failing tool(s).`,
	flowShieldReleased: (count) => `Flow protection ended before I interrupted: released ${count} held notice(s).`,
};

export const NOTICE_CS: NoticeStrings = {
	handoffNotify: (unverified, openLoops, bookmarks, failing, topFile) =>
		`Poslední relace: ${unverified} neověřených změn${topFile ? ` (nejvíc: ${topFile})` : ""}, ${openLoops} otevřených smyček, ${bookmarks} záložek, ${failing} selhávajících nástrojů.`,
	flowShieldReleased: (count) => `Ochrana toku skončila, než jsem stihl rušit: uvolněno ${count} čekajících oznámení.`,
};
