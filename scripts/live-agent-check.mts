// Live end-to-end check of the agent runtime: real spawn, child mode, guard, psych_submit.
// Costs one cheap model call (~$0.002). Run: npx tsx scripts/live-agent-check.mts
// The child loads the INSTALLED git copy (spike Q9): push + `pi update` before trusting a result.
import { runAgent } from "../src/shared/agent-runner.ts";
import { defaultAgentRunIo } from "../src/shared/agent-runner-io.ts";
import { parseAppraisal } from "../src/shared/appraisal-enforce.ts";
import { resolvePiDocsDir } from "../src/shared/pi-paths.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
const PKG = process.env.PI_PACKAGE_DIR ?? "D:/02_knihovny_path/node-v22.17.1-win-x64/node_modules/@earendil-works/pi-coding-agent";
const cliPath = join(PKG, "dist", "bundle", "cli.js");
const live = ["window: 6 prompt(s), 31 tool call(s), 48 min", "tool failures: 9/31 (29%), repeated: bash", "verified progress: none — no test, lint, typecheck or build succeeded in this window", "prompts restating an earlier prompt: 2", "recurring failure: bash · exit code 1 ×5", "appraisal triggered by: failure_streak, restatement"];
const session = ["turns the operator cancelled: 2", "operator declared this session as: fix the overlay scroll"];
const t0 = Date.now();
const r = await runAgent(
  { modelRef: "openrouter/deepseek/deepseek-v4.1-flash", evidence: { liveLines: live, sessionLines: session } },
  { cliPath, execPath: process.execPath, role: "psychologist", context: "evidence", piVersion: "0.87.1",
    docsDir: resolvePiDocsDir({ argv1: cliPath, packageDir: undefined, exists: existsSync }), thinking: "",
    trusted: true, cwd: process.cwd(), timeoutMs: 180000, maxCostUsd: 0.25, maxToolCalls: 6,
    allowWeb: true, allowMcp: false, allowNlm: false, nlmNotebooks: [], extraArgs: [], keepTranscript: false },
  defaultAgentRunIo());
console.log("secs", ((Date.now() - t0) / 1000).toFixed(1));
console.log(JSON.stringify({ ok: r.ok, stage: r.stage, error: r.error, run: r.run, usage: r.usage && { in: r.usage.input, out: r.usage.output, cost: r.usage.cost } }, null, 1));
if (r.ok) { const p = parseAppraisal(r.text, [...live, ...session]); console.log(JSON.stringify(p, null, 1).slice(0, 2500)); }
