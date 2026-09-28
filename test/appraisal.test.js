/**
 * Appraisal contract and citation enforcement.
 *
 * Two of these tests guard rules that would otherwise fail silently in production: the
 * schema must contain no `anyOf`/`const` (Google's API rejects those, and every other
 * provider accepts them, so the bug only appears on one provider), and the schema's required
 * keys must still match the hand-written `Appraisal` type (they can drift, because the type
 * is no longer derived).
 *
 * The rest defend the rule the plugin exists for: no citation, no claim.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  APPRAISAL_SCHEMA,
  INTERVENTION_KINDS,
  LOAD_LEVELS,
  NEEDS,
  NEED_STATES,
  NEUTRAL,
  PROGRESS_STATES,
  FLOW_STATES,
  neutralAppraisal,
} from "../src/shared/appraisal.js";
import {
  enforceEvidence,
  extractJson,
  isSilent,
  parseAppraisal,
} from "../src/shared/appraisal-enforce.js";

const EVIDENCE = [
  "window: 3 prompt(s), 8 tool call(s), 21 min",
  "tool failures: 3/8 (38%), repeated: bash",
  "verified progress: none — no test, lint, typecheck or build succeeded in this window",
  "turns the operator cancelled: 1",
];

/** A raw (pre-enforcement) appraisal with one citation per verdict. */
function rawAppraisal(over = {}) {
  const cited = [EVIDENCE[2]];
  return {
    needs: {
      autonomy: { state: "at_risk", cited },
      competence: { state: "unmet", cited },
      relatedness: { state: "met", cited },
    },
    load: { level: "high", cited: [EVIDENCE[1]] },
    progress: { state: "blocked", cited: [EVIDENCE[0]] },
    flow: { state: "broken", cited: [EVIDENCE[3]] },
    interventions: [
      { kind: "name_next_win", text: "Name the smallest shippable increment.", cited: [EVIDENCE[2]] },
    ],
    ...over,
  };
}

function collectKeys(node, key, found = []) {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, key, found);
    return found;
  }
  for (const [k, value] of Object.entries(node)) {
    if (k === key) found.push(value);
    collectKeys(value, key, found);
  }
  return found;
}

test("the schema uses no anyOf or const, so every provider accepts it", () => {
  // The rule that is easy to break invisibly: StringEnum emits plain enums, while
  // Type.Union/Type.Literal emit anyOf/const that Google's API rejects (skill §2).
  for (const forbidden of ["anyOf", "oneOf", "const"]) {
    assert.deepEqual(collectKeys(APPRAISAL_SCHEMA, forbidden), [], `schema must not contain '${forbidden}'`);
  }
  const enums = collectKeys(APPRAISAL_SCHEMA, "enum");
  assert.ok(enums.length >= 4, "enums are present");
  assert.ok(
    enums.some((values) => JSON.stringify(values) === JSON.stringify(INTERVENTION_KINDS)),
    "the intervention kinds enum is the exported list",
  );
  assert.ok(enums.some((v) => JSON.stringify(v) === JSON.stringify(NEED_STATES)));
  assert.ok(enums.some((v) => JSON.stringify(v) === JSON.stringify(LOAD_LEVELS)));
  assert.ok(enums.some((v) => JSON.stringify(v) === JSON.stringify(PROGRESS_STATES)));
  assert.ok(enums.some((v) => JSON.stringify(v) === JSON.stringify(FLOW_STATES)));
});

test("the schema's required keys still match the hand-written Appraisal type", () => {
  // Drift guard, because Appraisal is no longer derived from the schema (TS2883). `suggestions`
  // is the one optional key: the API runtime never fills it, so it is absent from `required`
  // while still present on the neutral value.
  assert.deepEqual(
    [...APPRAISAL_SCHEMA.required].sort(),
    Object.keys(neutralAppraisal())
      .filter((key) => key !== "suggestions")
      .sort(),
  );
  assert.equal(APPRAISAL_SCHEMA.required.includes("suggestions"), false, "suggestions stays optional");
  assert.deepEqual(
    [...APPRAISAL_SCHEMA.properties.needs.required].sort(),
    [...NEEDS].sort(),
  );
  const intervention = APPRAISAL_SCHEMA.properties.interventions.items;
  assert.deepEqual([...intervention.required].sort(), ["cited", "kind", "text"]);
  assert.equal(APPRAISAL_SCHEMA.properties.interventions.maxItems, 1, "at most one intervention");
});

test("the interventions array is capped by the schema, not only by the prompt", () => {
  assert.equal(APPRAISAL_SCHEMA.properties.interventions.maxItems, 1);
  assert.equal(APPRAISAL_SCHEMA.properties.needs.properties.autonomy.properties.cited.maxItems, 4);
});

test("a neutral appraisal claims nothing and is silent", () => {
  const appraisal = neutralAppraisal();
  for (const need of NEEDS) {
    assert.equal(appraisal.needs[need].state, NEUTRAL.needs[need]);
    assert.deepEqual(appraisal.needs[need].cited, []);
  }
  assert.equal(appraisal.load.level, NEUTRAL.load);
  assert.equal(appraisal.progress.state, NEUTRAL.progress);
  assert.equal(appraisal.flow.state, NEUTRAL.flow);
  assert.deepEqual(appraisal.interventions, []);
  assert.equal(isSilent(appraisal), true);
});

test("extractJson reads bare, fenced and prose-wrapped objects", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('```\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure, here it is:\n{"a":1}\nHope that helps.'), { a: 1 });
  assert.deepEqual(extractJson('{"a":{"b":[1,2]}}'), { a: { b: [1, 2] } });
});

test("extractJson refuses anything that is not an object", () => {
  for (const bad of ["no json here", "[1,2,3]", '"a string"', "", "```", null, 42]) {
    assert.equal(extractJson(bad), undefined, JSON.stringify(bad));
  }
});

test("a citation copied exactly is kept", () => {
  const { appraisal, unmatched, downgraded } = enforceEvidence(rawAppraisal(), EVIDENCE);
  assert.deepEqual(appraisal.needs.autonomy.cited, [EVIDENCE[2]]);
  assert.deepEqual(appraisal.load.cited, [EVIDENCE[1]]);
  assert.deepEqual(downgraded, []);
  assert.deepEqual(unmatched, []);
});

test("a citation differing only in case or spacing is kept, and canonicalised", () => {
  const raw = rawAppraisal({
    load: { level: "high", cited: [EVIDENCE[1].toUpperCase()] },
    progress: { state: "blocked", cited: [EVIDENCE[0].replace(/ /g, "   ")] },
  });
  const { appraisal, unmatched } = enforceEvidence(raw, EVIDENCE);
  assert.deepEqual(appraisal.load.cited, [EVIDENCE[1]], "the plugin's spelling wins, not the model's");
  assert.deepEqual(appraisal.progress.cited, [EVIDENCE[0]]);
  assert.deepEqual(unmatched, []);
});

test("a verdict whose citations all fail is downgraded to neutral, not kept", () => {
  const raw = rawAppraisal({
    load: { level: "high", cited: ["i made this up"] },
    progress: { state: "blocked", cited: ["Tool failures were 3 of 8, which is 38 percent"] },
  });
  const { appraisal, downgraded, unmatched } = enforceEvidence(raw, EVIDENCE);
  assert.equal(appraisal.load.level, NEUTRAL.load, "an uncited level is not a level");
  assert.equal(appraisal.progress.state, NEUTRAL.progress);
  assert.deepEqual(appraisal.load.cited, []);
  assert.deepEqual(downgraded.sort(), ["load", "progress"]);
  assert.equal(unmatched.length, 2, "both fabrications are recorded for the report");
});

test("a verdict with no citations at all is downgraded too", () => {
  const raw = rawAppraisal({
    needs: {
      autonomy: { state: "unmet", cited: [] },
      competence: { state: "met", cited: [] },
      relatedness: { state: "met", cited: [] },
    },
  });
  const { appraisal, downgraded } = enforceEvidence(raw, EVIDENCE);
  assert.equal(appraisal.needs.autonomy.state, NEUTRAL.needs.autonomy);
  assert.equal(appraisal.needs.competence.state, NEUTRAL.needs.competence);
  // All three carried a non-neutral state with no citation, so all three downgrade.
  assert.deepEqual(downgraded, ["needs.autonomy", "needs.competence", "needs.relatedness"]);
});

test("a neutral verdict with no citation is NOT punished: abstention is always allowed", () => {
  const raw = rawAppraisal({
    load: { level: "unassessed", cited: [] },
    flow: { state: "unassessed", cited: [] },
    progress: { state: "unproven", cited: [] },
    needs: {
      autonomy: { state: "unassessed", cited: [] },
      competence: { state: "unassessed", cited: [] },
      relatedness: { state: "unassessed", cited: [] },
    },
    interventions: [],
  });
  const { appraisal, downgraded } = enforceEvidence(raw, EVIDENCE);
  assert.deepEqual(downgraded, [], "abstaining must never be recorded as a downgrade");
  assert.equal(isSilent(appraisal), true);
});

test("one part surviving keeps the verdict: partial support is enough", () => {
  const raw = rawAppraisal({
    load: { level: "high", cited: ["fabricated", EVIDENCE[1]] },
  });
  const { appraisal, unmatched } = enforceEvidence(raw, EVIDENCE);
  assert.equal(appraisal.load.level, "high");
  assert.deepEqual(appraisal.load.cited, [EVIDENCE[1]]);
  assert.deepEqual(unmatched, ["fabricated"]);
});

test("duplicate citations collapse", () => {
  const raw = rawAppraisal({ load: { level: "high", cited: [EVIDENCE[1], EVIDENCE[1], EVIDENCE[1]] } });
  assert.deepEqual(enforceEvidence(raw, EVIDENCE).appraisal.load.cited, [EVIDENCE[1]]);
});

test("an intervention with no surviving citation is removed entirely", () => {
  const raw = rawAppraisal({
    interventions: [{ kind: "thin_slice", text: "Cut it thinner.", cited: ["invented"] }],
  });
  const { appraisal, downgraded, unmatched } = enforceEvidence(raw, EVIDENCE);
  assert.deepEqual(appraisal.interventions, []);
  assert.ok(downgraded.includes("interventions:unsupported"));
  assert.deepEqual(unmatched, ["invented"]);
  assert.equal(isSilent(appraisal), false, "the verdicts still stand even though the advice did not");
});

test("two interventions are refused as a batch, not truncated to one", () => {
  const cited = [EVIDENCE[2]];
  const raw = rawAppraisal({
    interventions: [
      { kind: "thin_slice", text: "First.", cited },
      { kind: "reduce_load", text: "Second.", cited },
    ],
  });
  const { appraisal, downgraded } = enforceEvidence(raw, EVIDENCE);
  assert.deepEqual(appraisal.interventions, [], "taking the first would reward ignoring the contract");
  assert.ok(downgraded.includes("interventions:more-than-one"));
});

test("an unknown intervention kind or empty text is refused", () => {
  const cited = [EVIDENCE[2]];
  const unknownKind = enforceEvidence(
    rawAppraisal({ interventions: [{ kind: "motivate_harder", text: "Try.", cited }] }),
    EVIDENCE,
  );
  assert.deepEqual(unknownKind.appraisal.interventions, []);
  assert.ok(unknownKind.downgraded.includes("interventions:unsupported"));

  const emptyText = enforceEvidence(
    rawAppraisal({ interventions: [{ kind: "thin_slice", text: "   ", cited }] }),
    EVIDENCE,
  );
  assert.deepEqual(emptyText.appraisal.interventions, []);
});

test("junk in any single field degrades that field, not the whole appraisal", () => {
  const raw = {
    needs: "not an object",
    load: { level: "enormous", cited: [EVIDENCE[1]] },
    progress: null,
    flow: { state: "broken", cited: EVIDENCE[3] },
    interventions: "nope",
  };
  const { appraisal, downgraded } = enforceEvidence(raw, EVIDENCE);
  assert.equal(appraisal.load.level, NEUTRAL.load, "an out-of-vocabulary level is not a level");
  assert.equal(appraisal.progress.state, NEUTRAL.progress);
  assert.equal(appraisal.flow.state, NEUTRAL.flow, "a string instead of an array cites nothing");
  assert.deepEqual(appraisal.interventions, []);
  assert.ok(downgraded.length > 0);
});

test("parseAppraisal reports a response with no JSON rather than inventing one", () => {
  const result = parseAppraisal("I'm sorry, I can't help with that.", EVIDENCE);
  assert.equal(result.ok, false);
  assert.match(result.error, /no JSON object/);
});

test("parseAppraisal returns an enforced appraisal end to end", () => {
  const result = parseAppraisal(JSON.stringify(rawAppraisal()), EVIDENCE);
  assert.equal(result.ok, true);
  assert.equal(result.appraisal.progress.state, "blocked");
  assert.deepEqual(result.appraisal.interventions[0].cited, [EVIDENCE[2]]);
  assert.equal(isSilent(result.appraisal), false);
});

test("a fully fabricated response parses to a silent, neutral appraisal", () => {
  const fabricated = {
    needs: {
      autonomy: { state: "unmet", cited: ["trust me"] },
      competence: { state: "unmet", cited: ["trust me"] },
      relatedness: { state: "unmet", cited: ["trust me"] },
    },
    load: { level: "high", cited: ["trust me"] },
    progress: { state: "blocked", cited: ["trust me"] },
    flow: { state: "broken", cited: ["trust me"] },
    interventions: [{ kind: "stop", text: "Give up for today.", cited: ["trust me"] }],
  };
  const result = parseAppraisal(JSON.stringify(fabricated), EVIDENCE);
  assert.equal(result.ok, true, "well-formed JSON, so it parses");
  assert.equal(isSilent(result.appraisal), true, "and it says nothing, because it cited nothing");
  assert.equal(result.appraisal.progress.state, NEUTRAL.progress);
  assert.deepEqual(result.appraisal.interventions, []);
});