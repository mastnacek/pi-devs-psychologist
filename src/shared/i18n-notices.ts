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
	 * by the previous one. Never a score, never a mood, never a claim about the person.
	 */
	handoffNotify: (unverified: number, openLoops: number, bookmarks: number, failing: number) => string;
}

export const NOTICE_EN: NoticeStrings = {
	handoffNotify: (unverified, openLoops, bookmarks, failing) =>
		`Last session: ${unverified} unverified change(s), ${openLoops} open loop(s), ${bookmarks} bookmark(s), ${failing} failing tool(s).`,
};

export const NOTICE_CS: NoticeStrings = {
	handoffNotify: (unverified, openLoops, bookmarks, failing) =>
		`Poslední relace: ${unverified} neověřených změn, ${openLoops} otevřených smyček, ${bookmarks} záložek, ${failing} selhávajících nástrojů.`,
};
