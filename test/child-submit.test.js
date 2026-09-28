/**
 * psych_submit — the child's only speaking channel (D3).
 *
 * The behaviour worth pinning down is the failure path: a wrong answer must be refused *with the field
 * that is wrong*, so the child can retry, and the retrying must end. One test asserts the happy path
 * and its termination flag; the rest assert the three ways a submission is turned away.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeCtx, makePi } from "./fakes.js";
import { APPRAISAL_SCHEMA, ASK_SCHEMA } from "../src/shared/appraisal.js";
import { registerSubmitTool, schemaForRole } from "../src/slices/child/submit.js";

/** A well-formed appraisal that claims nothing — the minimal legal answer for the psychologist role. */
const VALID_APPRAISAL = {
  needs: {
    autonomy: { state: "met", cited: [] },
    competence: { state: "at_risk", cited: [] },
    relatedness: { state: "unassessed", cited: [] },
  },
  load: { level: "moderate", cited: [] },
  progress: { state: "advanced", cited: [] },
  flow: { state: "in_flow", cited: [] },
  interventions: [],
};

function build(role = "psychologist") {
  const pi = makePi();
  const state = { submitted: false, failures: 0 };
  registerSubmitTool(pi, role, state);
  return { def: pi.tools.get("psych_submit"), state, ctx: makeCtx() };
}

function submit(built, params) {
  return built.def.execute("call-1", params, undefined, undefined, built.ctx);
}

test("the role picks the schema, and the psychologist gets the real appraisal contract", () => {
  assert.equal(schemaForRole("psychologist"), APPRAISAL_SCHEMA);
  assert.equal(schemaForRole("ask"), ASK_SCHEMA);
  // scout and pair borrow the ask shape until T30/T31 give them their own.
  assert.equal(schemaForRole("scout"), ASK_SCHEMA);
  assert.equal(schemaForRole("pair"), ASK_SCHEMA);
  assert.equal(build("psychologist").def.parameters, APPRAISAL_SCHEMA);
  assert.equal(build("ask").def.parameters, ASK_SCHEMA);
});

test("the tool is named psych_submit and says plainly that plain text is not read", () => {
  const { def } = build();
  assert.equal(def.name, "psych_submit");
  assert.match(def.description, /exactly once/);
  assert.match(def.description, /Plain text/);
});

test("a valid appraisal is accepted, and the answer tells the child to stop", async () => {
  const built = build();
  const result = await submit(built, VALID_APPRAISAL);
  assert.equal(result.content[0].text, "Submitted. Stop now.");
  assert.equal(result.terminate, true, "the run ends after the batch");
  assert.equal(built.state.submitted, true);
});

test("an invalid submission throws with the failing field path", async () => {
  const built = build();
  const broken = { ...VALID_APPRAISAL, progress: { state: "bogus", cited: [] } };
  await assert.rejects(() => submit(built, broken), /\/progress\/state/);
  assert.equal(built.state.failures, 1);
  assert.equal(built.state.submitted, false);
});

test("a root-level failure names the object rather than crashing on an empty path", async () => {
  const built = build();
  await assert.rejects(() => submit(built, {}), /\/: must have required properties/);
});

test("the ask role reports the field it rejected", async () => {
  const built = build("ask");
  await assert.rejects(() => submit(built, { answer: 5 }), /\/answer/);
});

test("a second successful submit is refused", async () => {
  const built = build();
  await submit(built, VALID_APPRAISAL);
  await assert.rejects(() => submit(built, VALID_APPRAISAL), /already submitted/);
  assert.equal(built.state.submitted, true);
});

test("a well-formed second submit is refused too — re-submitting is not a strategy", async () => {
  const built = build();
  await submit(built, VALID_APPRAISAL);
  await assert.rejects(() => submit(built, {}), /already submitted/);
});

test("after two rejections the third stops listing fields and says what to do", async () => {
  const built = build();
  const broken = { ...VALID_APPRAISAL, load: { level: "nonsense", cited: [] } };
  await assert.rejects(() => submit(built, broken), /psych_submit is invalid/);
  await assert.rejects(() => submit(built, broken), /psych_submit is invalid/);
  await assert.rejects(() => submit(built, broken), /minimal valid object/);
  assert.equal(built.state.failures, 3);
  // Still refused, still not accepted: advice is not a relaxation of the contract.
  assert.equal(built.state.submitted, false);
});

test("the ask role accepts its own shape", async () => {
  const built = build("ask");
  const result = await submit(built, { answer: "try a smaller slice", cited: [] });
  assert.equal(result.content[0].text, "Submitted. Stop now.");
  assert.equal(result.terminate, true);
});
