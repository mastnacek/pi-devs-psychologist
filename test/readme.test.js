/**
 * README — the key table must document every configuration key.
 *
 * A config key that ships without a README row is undiscoverable, and a README row
 * that disappears when the code changes is a claim that quietly stops being true.
 * This reads README.md as text and asserts each `DEFAULT_CONFIG` key appears in a
 * markdown table row (a line starting with "|" and containing the backticked name).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG } from "../src/shared/config.js";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("every DEFAULT_CONFIG key appears in a README table row", () => {
  const rows = README.split("\n").filter((line) => line.startsWith("|"));
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const documented = rows.some((row) => row.includes(`\`${key}\``));
    assert.ok(documented, `README has no table row for config key \`${key}\``);
  }
});
