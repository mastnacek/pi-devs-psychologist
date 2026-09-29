/**
 * i18n-labels — the human names for the appraisal's fixed vocabulary.
 *
 * Split from `i18n.ts` purely to keep each locale file under the line budget: this is still the
 * one table where user-facing prose belongs. Every map is typed against the enum it names, so
 * adding a state to the contract without naming it in both locales is a compile error rather
 * than a raw token on screen.
 */

import {
	FLOW_STATES,
	INTERVENTION_KINDS,
	LOAD_LEVELS,
	NEED_STATES,
	NEEDS,
	PROGRESS_STATES,
	REVIEW_VERDICTS,
	SCOUT_FITS,
	type InterventionKind,
	type NeedKey,
	type ReviewVerdict,
	type ScoutFit,
} from "./appraisal.js";

type NeedState = (typeof NEED_STATES)[number];
type LoadLevel = (typeof LOAD_LEVELS)[number];
type ProgressState = (typeof PROGRESS_STATES)[number];
type FlowState = (typeof FLOW_STATES)[number];

export interface Labels {
	needs: Record<NeedKey, string>;
	needStates: Record<NeedState, string>;
	loadLevels: Record<LoadLevel, string>;
	progressStates: Record<ProgressState, string>;
	flowStates: Record<FlowState, string>;
	interventionKinds: Record<InterventionKind, string>;
	/** How well a scout candidate fits the friction (T31). */
	scoutFits: Record<ScoutFit, string>;
	/** The reviewer's finding class (T32a). */
	reviewVerdicts: Record<ReviewVerdict, string>;
}

export const EN_LABELS: Labels = {
	needs: {
		autonomy: "Autonomy",
		competence: "Competence",
		relatedness: "Relatedness",
	},
	needStates: {
		met: "met",
		at_risk: "at risk",
		unmet: "unmet",
		unassessed: "not assessed",
	},
	loadLevels: {
		low: "low",
		moderate: "moderate",
		high: "high",
		unassessed: "not assessed",
	},
	progressStates: {
		advanced: "advancing",
		blocked: "blocked",
		unproven: "unproven",
	},
	flowStates: {
		in_flow: "in flow",
		broken: "broken",
		unassessed: "not assessed",
	},
	interventionKinds: {
		name_next_win: "name the next win",
		thin_slice: "cut it thinner",
		reduce_load: "verify before writing more",
		protect_flow: "protect the flow",
		close_loop: "close the loop",
		return_autonomy: "hand the decision back",
		stop: "stop",
	},
	scoutFits: {
		solves: "solves it",
		partial: "partial fit",
		inspiration: "inspiration",
	},
	reviewVerdicts: {
		convention_mismatch: "convention mismatch",
		intent_vs_artifact: "intent vs artifact",
		unverified_claim: "unverified claim",
		insufficient_context: "insufficient context",
	},
};

export const CS_LABELS: Labels = {
	needs: {
		autonomy: "Autonomie",
		competence: "Kompetence",
		relatedness: "Sounáležitost",
	},
	needStates: {
		met: "naplněno",
		at_risk: "ohroženo",
		unmet: "nenaplněno",
		unassessed: "nevyhodnoceno",
	},
	loadLevels: {
		low: "nízká",
		moderate: "přiměřená",
		high: "vysoká",
		unassessed: "nevyhodnoceno",
	},
	progressStates: {
		advanced: "postupuje",
		blocked: "zablokováno",
		unproven: "neprokázáno",
	},
	flowStates: {
		in_flow: "v toku",
		broken: "přerušený",
		unassessed: "nevyhodnoceno",
	},
	interventionKinds: {
		name_next_win: "pojmenuj nejbližší výhru",
		thin_slice: "nakrájej to tenčeji",
		reduce_load: "ověř, než napíšeš další kód",
		protect_flow: "chraň tok",
		close_loop: "uzavři smyčku",
		return_autonomy: "vrať rozhodnutí člověku",
		stop: "skonči",
	},
	scoutFits: {
		solves: "řeší to",
		partial: "částečně sedí",
		inspiration: "inspirace",
	},
	reviewVerdicts: {
		convention_mismatch: "rozpor s konvencí",
		intent_vs_artifact: "záměr vs artefakt",
		unverified_claim: "neprokázané tvrzení",
		insufficient_context: "málo kontextu",
	},
};

/** Every label key, for the completeness test and for the command's `lang` help. */
export const LABEL_GROUPS = [
	"needs",
	"needStates",
	"loadLevels",
	"progressStates",
	"flowStates",
	"interventionKinds",
	"scoutFits",
	"reviewVerdicts",
] as const;

/** Compile-time proof that the label maps name every enum member. Unused at runtime. */
export const LABEL_SOURCES = {
	needs: NEEDS,
	needStates: NEED_STATES,
	loadLevels: LOAD_LEVELS,
	progressStates: PROGRESS_STATES,
	flowStates: FLOW_STATES,
	interventionKinds: INTERVENTION_KINDS,
	scoutFits: SCOUT_FITS,
	reviewVerdicts: REVIEW_VERDICTS,
} as const;
