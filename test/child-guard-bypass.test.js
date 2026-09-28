/**
 * Bypass forms of the child guard (T22 residual risks): a wrapper word, git global options, and
 * interpreter one-liners that write. Each must be refused; the read-only neighbours must pass.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { childBashBlockReason, isChildForbiddenTool } from "../src/shared/lexicon.js";

const BLOCKED = [
  "sudo rm -rf x",
  "env A=1 git push",
  "find . -name '*.tmp' | xargs rm",
  "git -c user.name=x commit -m y",
  "git -C sub push",
  "git --no-pager commit -m y",
  "ls; sudo git reset --hard",
  `node -e "require('fs').writeFileSync('a','b')"`,
  `python -c "open('a','w').write('x')"`,
];

const ALLOWED = [
  "git diff",
  "git log --oneline -5",
  "git -C sub log",
  "git --no-pager diff",
  `node -e "console.log(1)"`,
  "npm test",
  "cat src/copy.ts",
  "echo x 2>&1",
  "time npm test",
  "env | grep PI_",
];

for (const command of BLOCKED) {
  test(`blocked: ${command}`, () => {
    assert.ok(childBashBlockReason(command), "a wrapper or option must not walk past the guard");
  });
}

for (const command of ALLOWED) {
  test(`allowed: ${command}`, () => {
    assert.equal(childBashBlockReason(command), undefined);
  });
}

test("file-creating tools outside the explicit list are caught by name", () => {
  assert.equal(isChildForbiddenTool("herdr_scaffold_plugin"), true);
  assert.equal(isChildForbiddenTool("psych_submit"), false, "the one exception stays open");
  for (const readOnly of ["read", "web_search", "fetch_content", "mcp", "mcpScript"]) {
    assert.equal(isChildForbiddenTool(readOnly), false, `${readOnly} stays usable`);
  }
});
