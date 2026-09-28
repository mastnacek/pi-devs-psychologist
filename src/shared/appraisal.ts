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
});

/**
 * The `ask` role's answer, and the shape `scout` and `pair` borrow until they get their own (T22).
 *
 * A placeholder on purpose: it holds the two fields every role has in common — an answer and the
 * evidence lines it rests on — so the child-mode tool can be validated today without inventing the
 * role contracts early. `cited` mirrors the appraisal's citation rule, which T23 keeps in the brief.
 *
 * TODO(T30/T31): `ask` gains `suggestions` in T25, `scout` returns candidates with an `installSpec`,
 * `pair` a convention finding; each then gets a schema of its own instead of this shared stand-in.
 */
export const ASK_SCHEMA: TSchema = Type.Object({
	answer: Type.String({ maxLength: 800, description: "the answer, in prose" }),
	cited: Cited,
});

export interface NeedVerdict {
	state: (typeof NEED_STATES)[number];
	cited: string[];
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
	};
}