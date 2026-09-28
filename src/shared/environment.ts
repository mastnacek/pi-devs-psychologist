/**
 * environment — what machine the psychologist is watching, as citable facts.
 *
 * The gap this closes is not abstract. A tool failure and a wrong remedy look identical to a
 * model that only sees counts: "4 of 32 tool calls failed" cannot tell the appraiser whether to
 * say *run your tests* or *your context for that file is stale*. Meanwhile the fact that often
 * decides the answer lives in a config file the session record never mentions — `~/.pi-lens/
 * config.json`, not `~/.pi/agent/settings.json` — so no amount of prompting would surface it.
 *
 * Two rules, both learned the hard way from a live spike on this machine:
 *
 * - **The parent computes, the child investigates.** Facts the parent can read for free are
 *   handed over as lines. A file *path* in a prompt is not a fact: a model given
 *   `~/.pi-lens/config.json` did not open it, while a model given `read-before-edit guard: not
 *   set (default)` wrote the sharpest advice of the whole experiment with **zero** tool calls.
 * - **Every value degrades to a stated default, never to silence and never to a guess.** A
 *   missing file means "not set (default)", which is a true and citable claim. An empty value
 *   would be indistinguishable from a read that failed, and the appraiser would treat both as
 *   evidence of something.
 *
 * Privacy: these lines are the first evidence in this plugin that describes the operator's
 * machine rather than their work, so they are the first that can be switched off (`envFacts`).
 * Nothing here reads file *contents* except three booleans and a server-name list, and the
 * lines carry no absolute path.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the facts come from. Every path is injectable so tests never touch a real home. */
export interface EnvironmentSources {
	cwd?: string;
	/** Overrides `homedir()`; the tests point this at a fixture directory. */
	home?: string;
	/** Pi's agent settings, where the loaded package list lives. */
	settingsFile?: string;
	/** pi-lens' own config, where the LSP/format/guard flags live. NOT under `.pi/agent`. */
	lensConfigFile?: string;
	/** Directory to start the upward search for the engine's package.json from. */
	searchFrom?: string;
}

interface AgentSettings {
	packages?: unknown;
}

interface LensConfig {
	lens?: Record<string, unknown>;
	lsp?: { servers?: Record<string, unknown> };
}

/** Read a JSON file, or `undefined` for missing, unreadable or malformed. Never throws. */
function readJson(path: string): unknown {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

/**
 * A toggle as a citable claim, distinguishing "off" from "never configured".
 *
 * pi-lens nests its flags (`readGuard: { enabled: true }`), so the boolean is one level down.
 * Both shapes are accepted because a config file is hand-written and a bare `true` is as legal
 * there as the nested form.
 */
function toggle(value: unknown, whenUnset: string): string {
	if (value === undefined) return whenUnset;
	if (typeof value === "boolean") return value ? "on" : "off";
	if (value !== null && typeof value === "object") {
		const enabled = (value as { enabled?: unknown }).enabled;
		if (typeof enabled === "boolean") return enabled ? "on" : "off";
	}
	return "set (unrecognised shape)";
}

/** A mode as a citable claim. `format.mode` names the mode, so the mode is the fact. */
function mode(value: unknown, whenUnset: string): string {
	if (value === undefined) return whenUnset;
	if (typeof value === "string" && value.length > 0) return value;
	if (value !== null && typeof value === "object") {
		const inner = (value as { mode?: unknown }).mode;
		if (typeof inner === "string" && inner.length > 0) return inner;
	}
	return "set (unrecognised shape)";
}

/**
 * The running engine's version.
 *
 * `require.resolve("@earendil-works/pi-coding-agent")` is not available — the package's exports
 * map has no `"."` entry — so the manifest is found by walking up, exactly as the plugin-dev
 * skill documents. `PI_PACKAGE_DIR` short-circuits the walk when the runtime provides it.
 */
export function engineVersion(searchFrom?: string): string {
	const direct = process.env.PI_PACKAGE_DIR;
	const versionFrom = (root: string | undefined): string | undefined => {
		if (!root) return undefined;
		const parsed = readJson(join(root, "package.json")) as { version?: unknown } | undefined;
		return typeof parsed?.version === "string" && parsed.version.length > 0
			? parsed.version
			: undefined;
	};

	const fromEnv = versionFrom(direct);
	if (fromEnv) return fromEnv;

	// `fileURLToPath`, not `new URL(...).pathname`: the latter yields `/C:/…` on Windows, which
	// `existsSync` rejects. The plugin's own dir is the fallback search root — in a dev tree it
	// sits inside the same workspace as the engine.
	const roots = [searchFrom, process.cwd(), dirname(dirname(fileURLToPath(import.meta.url)))];
	for (const root of roots) {
		if (!root) continue;
		let dir = root;
		for (;;) {
			const nested = versionFrom(join(dir, "node_modules", "@earendil-works", "pi-coding-agent"));
			if (nested) return nested;
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	return "unknown";
}

/** Directory name only. An absolute path in an evidence line leaves the machine. */
function projectName(cwd: string): string {
	const name = basename(parse(cwd).root) === cwd ? "" : basename(cwd);
	return name.length > 0 ? name : "unknown";
}

/**
 * The environment evidence lines, in prompt order. Citable exactly like any other line, so a
 * verdict resting on "the LSP is off" survives enforcement without special-casing.
 */
export function environmentEvidence(sources: EnvironmentSources = {}): string[] {
	const home = sources.home ?? homedir();
	const settingsFile = sources.settingsFile ?? join(home, ".pi", "agent", "settings.json");
	const lensConfigFile = sources.lensConfigFile ?? join(home, ".pi-lens", "config.json");
	const cwd = sources.cwd ?? process.cwd();

	const settings = readJson(settingsFile) as AgentSettings | undefined;
	const lensConfig = readJson(lensConfigFile) as LensConfig | undefined;
	const lens = lensConfig?.lens ?? {};

	const packages = Array.isArray(settings?.packages) ? settings.packages.length : undefined;
	const servers = Object.keys(lensConfig?.lsp?.servers ?? {});

	return [
		`pi version: ${engineVersion(sources.searchFrom)}`,
		`project directory: ${projectName(cwd)}`,
		`packages loaded: ${packages === undefined ? "unknown" : packages}`,
		`pi-lens config: ${lensConfig === undefined ? "absent" : "present"}`,
		`language servers configured: ${servers.length > 0 ? servers.join(", ") : "none"}`,
		`read-before-edit guard: ${toggle(lens.readGuard, "not set (default)")}`,
		`autoformat mode: ${mode(lens.format, "not set (default: deferred at agent_end)")}`,
		`autofix: ${toggle(lens.autofix, "not set (default)")}`,
	];
}
