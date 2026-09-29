// Live end-to-end check of the agent runtime: real spawn, child mode, guard, psych_submit.
// Costs one cheap model call (~$0.002). Run: npx tsx scripts/live-agent-check.mts
// The child loads the INSTALLED git copy (spike Q9): push + `pi update` before trusting a result.
import { runAgent } from "../src/shared/agent-runner.ts";
import { defaultAgentRunIo } from "../src/shared/agent-runner-io.ts";
import { parseAppraisal } from "../src/shared/appraisal-enforce.ts";
import { resolvePiDocsDir } from "../src/shared/pi-paths.ts";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The engine's own CLI entry, resolved rather than hardcoded. A machine path in this file made the
 * script fail the moment the node version changed, and the compliance auditor cannot see `.mts` at
 * all, so nothing would have said so. Order: PI_PACKAGE_DIR, then this repo's own node_modules
 * copy, then the versioned global store next to the running node.
 */
function resolveCliPath(): string {
	if (process.env.PI_PACKAGE_DIR) {
		const p = join(process.env.PI_PACKAGE_DIR, "dist", "bundle", "cli.js");
		if (existsSync(p)) return p;
	}
	const local = join(dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
	if (existsSync(local)) return local;
	// …/node-vX.Y.Z-win-x64/node.exe  ->  …/node-vX.Y.Z-win-x64/node_modules
	const store = join(dirname(process.execPath), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
	if (existsSync(store)) return store;
	const prefix = dirname(dirname(dirname(process.execPath)));
	try {
		for (const entry of readdirSync(prefix)) {
			if (!/^node-v\d/.test(entry)) continue;
			const p = join(prefix, entry, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
			if (existsSync(p)) return p;
		}
	} catch {
		// Fall through to the error below, which names what was looked for.
	}
	throw new Error("cannot find the pi CLI entry; set PI_PACKAGE_DIR to the @earendil-works/pi-coding-agent package root");
}

const cliPath = resolveCliPath();
const PKG = cliPath.split(/[\/]dist[\/]bundle[\/]cli\.js$/)[0];
const live = ["window: 6 prompt(s), 31 tool call(s), 48 min", "tool failures: 9/31 (29%), repeated: bash", "verified progress: none — no test, lint, typecheck or build succeeded in this window", "prompts restating an earlier prompt: 2", "recurring failure: bash · exit code 1 ×5", "appraisal triggered by: failure_streak, restatement"];
const session = ["turns the operator cancelled: 2", "operator declared this session as: fix the overlay scroll"];
const t0 = Date.now();
const r = await runAgent(
  { modelRef: "openrouter/deepseek/deepseek-v4.1-flash", evidence: { liveLines: live, sessionLines: session } },
  { cliPath, execPath: process.execPath, role: "psychologist", context: "evidence", piVersion: "the installed engine",
    docsDir: resolvePiDocsDir({ argv1: cliPath, packageDir: PKG, exists: existsSync }), thinking: "",
    trusted: true, cwd: process.cwd(), timeoutMs: 180000, maxCostUsd: 0.25, maxToolCalls: 6,
    allowWeb: true, allowMcp: false, allowNlm: false, nlmNotebooks: [], extraArgs: [], keepTranscript: false },
  defaultAgentRunIo());
console.log("secs", ((Date.now() - t0) / 1000).toFixed(1));
console.log(JSON.stringify({ ok: r.ok, stage: r.stage, error: r.error, run: r.run, usage: r.usage && { in: r.usage.input, out: r.usage.output, cost: r.usage.cost } }, null, 1));
if (r.ok) { const p = parseAppraisal(r.text, [...live, ...session]); console.log(JSON.stringify(p, null, 1).slice(0, 2500)); }
