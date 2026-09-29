/**
 * appraisal — the CONTRACT: what a well-formed answer from the psychologist looks like.
 *
 * What happens to an answer that does not honour it — notably the rule that every verdict
 * must cite a line the plugin actually supplied, and that an uncited verdict is downgraded
 * to neutral rather than kept — lives in `appraisal-enforce.ts`. The split is by concept:
 * this changes when the psychology changes, that changes when the failure modes do.
 *
 * Two design decisions worth stating, because they are what make fabrication impossible
 * rather than merely discouraged:
 *
 * - **The model classifies; it never enumerates facts.** There is no free-text `delivered`
 *   list, because a list of "what got done" is exactly where an invented achievement would
 *   appear. The model picks `advanced` / `blocked` / `unproven` and cites the evidence that
 *   made it say so. Every free-text field it does have is capped and cited.
 * - **Abstention is a first-class value** (`unassessed`, `unproven`), not an error. A window
 *   with nothing to report should produce a neutral appraisal — never a refusal, and
 *   certainly never a guess. (ADR 0001 invariant 2, applied here first.)
 *
 * Enums go through `StringEnum` from pi-ai rather than `Type.Union`/`Type.Literal`: the
 * latter emit `anyOf`/`const` schemas that Google's API rejects (skill §2).
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type TSchema } from "typebox";

/** The three self-determination needs the appraisal must address, in fixed order. */
export const NEEDS = ["autonomy", "competence", "relatedness"] as const;
export type NeedKey = (typeof NEEDS)[number];

/**
 * `unassessed` is the honest answer when nothing supports a need, and it is also where an
 * unsupported verdict is downgraded.
 */
export const NEED_STATES = ["met", "at_risk", "unmet", "unassessed"] as const;
export const LOAD_LEVELS = ["low", "moderate", "high", "unassessed"] as const;
export const PROGRESS_STATES = ["advanced", "blocked", "unproven"] as const;
export const FLOW_STATES = ["in_flow", "broken", "unassessed"] as const;

/**
 * The interventions a psychologist may name. Each is a documented technique from the
 * research notes, not a mood: `name_next_win` delegates to pi-quick-win's tool by prompt
 * policy (ADR 0001), `thin_slice` is vertical slicing / Mikado, `reduce_load` is the
 * unverified-backlog signal, `close_loop` is Zeigarnik, `return_autonomy` hands a decision
 * back to the operator, `stop` ends the session.
 */
export const INTERVENTION_KINDS = [
	"name_next_win",
	"thin_slice",
	"reduce_load",
	"protect_flow",
	"close_loop",
	"return_autonomy",
	"stop",
] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

/** Citations are short: a verdict resting on eight quotes is not resting on evidence. */
const Cited = Type.Array(Type.String(), { maxItems: 4 });

/**
 * What a researched suggestion can be. Each is a concrete thing the operator can pick up — the
 * psychologist never invents one, it points at something that already exists.
 */
export const SUGGESTION_KINDS = ["package", "skill", "doc", "research", "workflow"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/**
 * One researched suggestion, for the operator only. `source` is enforced to an existing artefact
 * in `appraisal-enforce.ts`; a suggestion without a real source is dropped there, not shown.
 */
export interface Suggestion {
	kind: SuggestionKind;
	text: string;
	source: string;
	cited: string[];
}

// `cited` is optional on the wire but always normalised to an array by enforcement.
const SuggestionSchema = Type.Object({
	kind: StringEnum(SUGGESTION_KINDS, { description: SUGGESTION_KINDS.join(" | ") }),
	text: Type.String({ maxLength: 200, description: "one sentence naming something usable" }),
	source: Type.String({
		description: "https URL, a path in the pi docs dir, nlm:<id>, npm:<name> or git:github.com/<owner>/<repo>",
	}),
	cited: Type.Optional(Type.Array(Type.String(), { maxItems: 2 })),
});

const NeedSchema = Type.Object({
	state: StringEnum(NEED_STATES, { description: "met | at_risk | unmet | unassessed" }),
	cited: Cited,
});

// Annotated rather than inferred: `StringEnum` returns a `TUnsafe`, and letting that type
// escape through an exported const makes the schema non-portable across TypeBox copies
// (TS2883). The schema's job here is to document the JSON shape for the prompt;
// `appraisal.test.js` asserts it still agrees with the hand-written types below, which is
// the drift guard that a derived type would have given for free.
export const APPRAISAL_SCHEMA: TSchema = Type.Object({
	needs: Type.Object({
		autonomy: NeedSchema,
		competence: NeedSchema,
		relatedness: NeedSchema,
	}),
	load: Type.Object({
		level: StringEnum(LOAD_LEVELS, { description: "low | moderate | high | unassessed" }),
		cited: Cited,
	}),
	progress: Type.Object({
		state: StringEnum(PROGRESS_STATES, { description: "advanced | blocked | unproven" }),
		cited: Cited,
	}),
	flow: Type.Object({
		state: StringEnum(FLOW_STATES, { description: "in_flow | broken | unassessed" }),
		cited: Cited,
	}),
	interventions: Type.Array(
		Type.Object({
			kind: StringEnum(INTERVENTION_KINDS),
			text: Type.String({ maxLength: 240, description: "one actionable sentence" }),
			cited: Cited,
		}),
		{ maxItems: 1, description: "at most one intervention; an empty list is a valid answer" },
	),
	// Optional on purpose: the API runtime has no tools and never fills it, and a bare appraisal
	// without it stays valid. Only the agent runtime, which can research, produces suggestions.
	suggestions: Type.Optional(
		Type.Array(SuggestionSchema, {
			maxItems: 3,
			description: "researched output for the operator; never sent to the working agent",
		}),
	),
});

/**
 * The `ask` role's answer (`/psych ask <question>`, T30), and the shape `scout` and `pair` borrow
 * until they get their own (T31/T32).
 *
 * The same citation rule as the appraisal: `cited` holds LIVE/SESSION lines copied exactly, and
 * enforcement keeps only those that match. `suggestions` is how research reaches the operator — a
 * plugin, a doc, a notebook — and it stays optional, so an answer that needed no research is valid.
 */
export const ASK_SCHEMA: TSchema = Type.Object({
	answer: Type.String({ maxLength: 800, description: "the answer, in prose" }),
	cited: Cited,
	suggestions: Type.Optional(
		Type.Array(SuggestionSchema, {
			maxItems: 3,
			description: "researched output for the operator; never sent to the working agent",
		}),
	),
});

/** The `ask` role's enforced answer. `suggestions` always an array; enforcement fills it or not. */
export interface AskAnswer {
	answer: string;
	cited: string[];
	suggestions: Suggestion[];
}

/**
 * How well an existing package fits the friction the evidence names (T31). `solves` is reserved for
 * a package that clearly covers it; `partial` covers part of it; `inspiration` is worth studying
 * but does not solve it. The distinction is the whole point of the scout: a plausible package
 * mislabelled `solves` sends the operator to install something that does not help.
 */
export const SCOUT_FITS = ["solves", "partial", "inspiration"] as const;
export type ScoutFit = (typeof SCOUT_FITS)[number];

/** One existing package the scout found, with its install spec and its real page. */
export interface ScoutCandidate {
	name: string;
	/** `npm:<name>` or `git:github.com/<owner>/<repo>` — enforced like a suggestion source (T25). */
	installSpec: string;
	/** The `https://` page for it; install specs are not links. */
	url: string;
	/** One sentence on why it fits, ≤ 160 chars. */
	why: string;
	fit: ScoutFit;
}

/** A plugin worth building, when nothing existing fits — the operator pastes it as an SPAI idea. */
export interface ScoutBuild {
	title: string;
	oneLine: string;
}

/** The `scout` role's submission (T31): existing candidates, or a build idea, or neither. */
export interface ScoutAnswer {
	candidates: ScoutCandidate[];
	build?: ScoutBuild;
	cited: string[];
}

/**
 * The `scout` role's contract (`/psych scout`, T31).
 *
 * A recurring-friction question has three honest answers: an existing package solves it, a package
 * partly helps, or nothing exists and a small plugin is worth building. `candidates` carries the
 * first two as one list, ordered by fit; `build` carries the third. Both empty is a valid answer —
 * "nothing found" — and must be shown, not silently swallowed, when the operator asked.
 */
export const SCOUT_SCHEMA: TSchema = Type.Object({
	candidates: Type.Array(
		Type.Object({
			name: Type.String({ description: "the package or project name" }),
			installSpec: Type.String({ description: "npm:<name> or git:github.com/<owner>/<repo>" }),
			url: Type.String({ description: "the https:// page for it" }),
			why: Type.String({ maxLength: 160, description: "one sentence on why it fits the friction" }),
			fit: StringEnum(SCOUT_FITS, { description: SCOUT_FITS.join(" | ") }),
		}),
		{ maxItems: 3, description: "at most 3; empty means nothing existing fits" },
	),
	build: Type.Optional(
		Type.Object({
			title: Type.String({ maxLength: 80, description: "a short plugin name" }),
			oneLine: Type.String({ maxLength: 200, description: "one sentence on what it does" }),
		}),
	),
	cited: Cited,
});

export interface NeedVerdict {
	state: (typeof NEED_STATES)[number];
	cited: string[];
}

/**
 * The `reviewer` role's finding class (`/psych review`, T32a). One finding class per review: the
 * reviewer proposes, it never enumerates, and `insufficient_context` is a first-class verdict — the
 * default answer when neither a stated rule nor a session intent line supports a claim (ADR 0001
 * invariant 2).
 */
export const REVIEW_VERDICTS = [
	"convention_mismatch",
	"intent_vs_artifact",
	"unverified_claim",
	"insufficient_context",
] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/**
 * The `reviewer` role's contract (`/psych review`, T32a).
 *
 * `rule` (the stated rule) and `file` are required for every non-abstention finding and must be
 * EMPTY for `insufficient_context`; enforcement (in `appraisal-enforce.ts`) is what makes that
 * conditional true, because one schema serves both shapes. `cited` holds exact lines from what the
 * plugin supplied; an empty `cited` on a non-abstention finding is dropped. `intentLine` is the
 * session evidence line for `intent_vs_artifact`.
 */
export const REVIEW_SCHEMA: TSchema = Type.Object({
	verdict: StringEnum(REVIEW_VERDICTS, { description: REVIEW_VERDICTS.join(" | ") }),
	rule: Type.Optional(
		Type.String({ maxLength: 300, description: "the stated rule; empty only for insufficient_context" }),
	),
	file: Type.Optional(Type.String({ maxLength: 300, description: "the file the finding is about" })),
	text: Type.String({ maxLength: 300, description: "one actionable sentence" }),
	cited: Cited,
	intentLine: Type.Optional(
		Type.String({ description: "a SESSION evidence line, for intent_vs_artifact" }),
	),
});

/** The `reviewer` role's enforced finding. `rule`/`file` are empty only for an abstention. */
export interface ReviewFinding {
	verdict: ReviewVerdict;
	rule: string;
	file: string;
	text: string;
	cited: string[];
	intentLine?: string;
}

export interface Intervention {
	kind: InterventionKind;
	text: string;
	cited: string[];
}

/**
 * The appraisal. Written by hand rather than derived from the schema so the exported type
 * does not carry a TypeBox-internal reference (TS2883); the schema and this type are kept
 * in step by a test that compares their key sets.
 */
export interface Appraisal {
	needs: Record<NeedKey, NeedVerdict>;
	load: { level: (typeof LOAD_LEVELS)[number]; cited: string[] };
	progress: { state: (typeof PROGRESS_STATES)[number]; cited: string[] };
	flow: { state: (typeof FLOW_STATES)[number]; cited: string[] };
	interventions: Intervention[];
	suggestions: Suggestion[];
}

/**
 * The neutral value per verdict field: where an unsupported claim is downgraded, and the
 * value a claim must already hold when its citations are empty.
 */
export const NEUTRAL: {
	needs: Record<NeedKey, (typeof NEED_STATES)[number]>;
	load: (typeof LOAD_LEVELS)[number];
	progress: (typeof PROGRESS_STATES)[number];
	flow: (typeof FLOW_STATES)[number];
} = {
	needs: { autonomy: "unassessed", competence: "unassessed", relatedness: "unassessed" },
	load: "unassessed",
	progress: "unproven",
	flow: "unassessed",
};

/** An appraisal that claims nothing. The result of enforcing evidence on a fabrication. */
export function neutralAppraisal(): Appraisal {
	return {
		needs: {
			autonomy: { state: NEUTRAL.needs.autonomy, cited: [] },
			competence: { state: NEUTRAL.needs.competence, cited: [] },
			relatedness: { state: NEUTRAL.needs.relatedness, cited: [] },
		},
		load: { level: NEUTRAL.load, cited: [] },
		progress: { state: NEUTRAL.progress, cited: [] },
		flow: { state: NEUTRAL.flow, cited: [] },
		interventions: [],
		suggestions: [],
	};
}