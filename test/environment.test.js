/**
 * Environment facts — what the psychologist is told about the machine it watches.
 *
 * The tests that matter here are the degraded ones. A missing config file must still produce a
 * citable line, because an empty value is indistinguishable from a read that failed, and the
 * appraiser would treat either as evidence of something.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { environmentEvidence, engineVersion } from "../src/shared/environment.js";

function fixtureHome(config) {
  const home = mkdtempSync(join(tmpdir(), "psych-env-"));
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(
    join(home, ".pi", "agent", "settings.json"),
    JSON.stringify({ packages: ["npm:one", "git:two", "npm:three"] }),
  );
  if (config !== undefined) {
    mkdirSync(join(home, ".pi-lens"), { recursive: true });
    writeFileSync(join(home, ".pi-lens", "config.json"), JSON.stringify(config));
  }
  return home;
}

function line(lines, prefix) {
  const found = lines.find((entry) => entry.startsWith(prefix));
  assert.ok(found !== undefined, `no evidence line starting with '${prefix}' in:\n${lines.join("\n")}`);
  return found;
}

test("missing ~/.pi-lens/config.json yields not-set defaults rather than an error", () => {
  const home = fixtureHome(undefined);
  const lines = environmentEvidence({
    home,
    cwd: "D:/01_programovani/pi/plugins/pi-openrouter-accounts",
  });

  assert.equal(line(lines, "pi-lens config:"), "pi-lens config: absent");
  assert.equal(line(lines, "read-before-edit guard:"), "read-before-edit guard: not set (default)");
  assert.equal(line(lines, "autofix:"), "autofix: not set (default)");
  assert.equal(line(lines, "language servers configured:"), "language servers configured: none");
  // A missing file is still a citable claim about the machine, not an empty line.
  for (const entry of lines) {
    assert.ok(entry.endsWith(":") === false, `line carries no value: '${entry}'`);
  }
});

test("configured lens flags are reported as facts, not as file contents", () => {
  const home = fixtureHome({
    lens: { readGuard: { enabled: true }, format: { mode: "immediate" }, autofix: { enabled: false } },
    lsp: { servers: { "lotusscript-lsp": { command: ["secret-binary.exe"] } } },
  });
  const lines = environmentEvidence({ home, cwd: "/tmp/project" });

  assert.equal(line(lines, "pi-lens config:"), "pi-lens config: present");
  assert.equal(line(lines, "read-before-edit guard:"), "read-before-edit guard: on");
  assert.equal(line(lines, "autofix:"), "autofix: off");
  assert.equal(line(lines, "autoformat mode:"), "autoformat mode: immediate");
  assert.equal(line(lines, "language servers configured:"), "language servers configured: lotusscript-lsp");
  // The server's command line is not a fact about the programmer and must not travel.
  assert.ok(!lines.join("\n").includes("secret-binary"), "a binary path leaked into the evidence");
});

test("the project line carries a directory name, never an absolute path", () => {
  const home = fixtureHome(undefined);
  const lines = environmentEvidence({ home, cwd: "D:/01_programovani/pi/plugins/pi-openrouter-accounts" });
  const project = line(lines, "project directory:");

  assert.equal(project, "project directory: pi-openrouter-accounts");
  for (const entry of lines) {
    assert.ok(!/[A-Za-z]:\\/.test(entry), `absolute Windows path in evidence: '${entry}'`);
    assert.ok(!entry.includes("/Users/"), `absolute POSIX path in evidence: '${entry}'`);
  }
});

test("a malformed settings file degrades to 'unknown' rather than throwing", () => {
  const home = mkdtempSync(join(tmpdir(), "psych-env-bad-"));
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "settings.json"), "{ not json");

  const lines = environmentEvidence({ home, cwd: "/tmp/x" });
  assert.equal(line(lines, "packages loaded:"), "packages loaded: unknown");
});

test("the engine version is resolved from the installed package", () => {
  // An unknown search root falls back to the running install rather than failing: the version
  // is always knowable in-process, and a missing one would be a hole in the evidence.
  assert.match(engineVersion(), /^\d+\.\d+\.\d+/);
  assert.match(engineVersion(join(tmpdir(), "psych-nowhere-does-not-exist")), /^\d+\.\d+\.\d+/);
});
