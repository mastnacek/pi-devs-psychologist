/**
 * child-limits — the child's budget reader.
 *
 * The one property that matters is that it fails CLOSED: the limits arrive as environment JSON that
 * the parent wrote, and the child must never *gain* a capability from a value it could not read. So
 * every junk case below asserts the strictest reading, not "roughly the defaults".
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CHILD_LIMITS, parseChildLimits, parseChildRole } from "../src/shared/child-limits.js";

const STRICT = { maxToolCalls: 10, allowWeb: false, allowMcp: false, allowNlm: false };

test("the strictest fallback is small and capability-free", () => {
  assert.deepEqual(DEFAULT_CHILD_LIMITS, STRICT);
});

test("missing, empty and malformed limits all degrade to the strictest defaults", () => {
  for (const junk of [undefined, null, "", "   ", "{ not json", "[]", "null", "42", '"json"', "{}"]) {
    assert.deepEqual(parseChildLimits(junk), STRICT, `junk value: ${String(junk)}`);
  }
});

test("a well-formed limits object is read key by key", () => {
  assert.deepEqual(parseChildLimits('{"maxToolCalls":3,"allowWeb":true,"allowMcp":false,"allowNlm":true}'), {
    maxToolCalls: 3,
    allowWeb: true,
    allowMcp: false,
    allowNlm: true,
  });
});

test("a key the parent did not send means off, not on", () => {
  assert.deepEqual(parseChildLimits('{"maxToolCalls":4}'), {
    maxToolCalls: 4,
    allowWeb: false,
    allowMcp: false,
    allowNlm: false,
  });
});

test("only an explicit boolean true enables a capability", () => {
  // The plausible mistakes: a string from a shell, a number, a truthy object. All must stay off.
  for (const value of ['"true"', "1", "{}", '"yes"', "0", "null"]) {
    const limits = parseChildLimits(`{"allowWeb":${value},"allowMcp":${value},"allowNlm":${value}}`);
    assert.deepEqual(
      [limits.allowWeb, limits.allowMcp, limits.allowNlm],
      [false, false, false],
      `value: ${value}`,
    );
  }
});

test("maxToolCalls honours a non-negative integer and rejects everything else", () => {
  assert.equal(parseChildLimits('{"maxToolCalls":0}').maxToolCalls, 0);
  assert.equal(parseChildLimits('{"maxToolCalls":7}').maxToolCalls, 7);
  for (const value of [-1, 1.5, '"3"', "true", "null", '"many"']) {
    assert.equal(parseChildLimits(`{"maxToolCalls":${value}}`).maxToolCalls, STRICT.maxToolCalls, `value: ${value}`);
  }
});

test("a known role passes through; a missing or junk role is the psychologist", () => {
  for (const role of ["psychologist", "pair", "scout", "ask"]) {
    assert.equal(parseChildRole(role), role);
  }
  for (const junk of [undefined, null, "", "PSYCHOLOGIST", "critic", 7, " psychologist "]) {
    assert.equal(parseChildRole(junk), "psychologist", `junk value: ${String(junk)}`);
  }
});
