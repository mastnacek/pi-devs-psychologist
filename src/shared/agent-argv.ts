/**
 * agent-argv — the pure launch builder for the child pi (T24).
 *
 * Every constraint here is an observed fact from `docs/agent-runtime-spike.md`, not a guess, and
 * each one is a way an earlier attempt failed:
 *
 * - spawn `process.execPath` with the engine's own `cli.js` (Q1) — never `pi.cmd` through a shell,
 *   where quoting and injection live;
 * - the message travels as its OWN `@<file>` argv token (Q2): concatenated with prompt text it is
 *   read as part of the filename;
 * - `--append-system-prompt <file>` appends to pi's 25 KB core prompt (Q3) — never
 *   `--system-prompt`, which would erase the tool knowledge that makes the child useful;
 * - `--fork` and `--no-session` are mutually exclusive, so a fork without a parent session file
 *   falls back to `--no-session` and says so;
 * - `ctx.isProjectTrusted() ? "--approve" : "--no-approve"` (Q7), so the child's project resources
 *   mirror the parent's exactly rather than depending on an ambient saved decision;
 * - never `-e` (Q9) and never `--no-lens` (Q8): both would either double-load this package or abort
 *   a child on a machine without pi-lens.
 *
 * This module is PURE: it returns a command, an argument array and an environment. No spawn, no
 * filesystem, no process. The wrapper in `agent-runner.ts` does the spawning; a test can pin the
 * exact argv and env without starting anything.
 */

import { join } from "node:path";
import type { AgentContextLevel } from "./agent-config.js";
import type { ChildLimits, ChildRole } from "./child-limits.js";

/** The three environment markers the child reads. Kept in one place so the runner and child agree. */
export const CHILD_ENV_MARKER = "PI_DEVS_PSYCH_CHILD";
export const CHILD_ENV_RUN = "PI_DEVS_PSYCH_RUN";
export const CHILD_ENV_ROLE = "PI_DEVS_PSYCH_ROLE";
export const CHILD_ENV_LIMITS = "PI_DEVS_PSYCH_LIMITS";

/** Markers that switch off peer workshop plugins; the child must NOT carry them (D5). */
const SHARED_MARKERS = ["PI_SUBAGENT", "PI_CHILD_SESSION"] as const;

export interface BuildChildLaunchInput {
	/** Absolute path to the engine CLI entry (`process.argv[1]`), spawned by `execPath`. */
	cliPath: string;
	/** `process.execPath` — the node binary running this session. */
	execPath: string;
	/** The consent level; picks `--no-session` or `--fork`. */
	context: AgentContextLevel;
	/** `ctx.sessionManager.getSessionFile()`, required for `context: "fork"`. */
	parentSessionFile?: string;
	/** The per-run temp directory; the brief/message files and the fork session dir live here. */
	runTmp: string;
	/** `provider/modelId[:thinking]` passed as `--model`. */
	modelRef: string;
	/** A thinking level passed as `--thinking`; empty means "engine default". */
	thinking: string;
	/** `ctx.isProjectTrusted()` — mirrored as `--approve`/`--no-approve`. */
	trusted: boolean;
	/** Extra argv tokens appended verbatim before the message (the documented escape hatch). */
	extraArgs: readonly string[];
	/** Which role the child runs as; carried to the child via `PI_DEVS_PSYCH_ROLE`. */
	role: ChildRole;
	/** The run id; carried to the child via `PI_DEVS_PSYCH_RUN`. */
	runId: string;
	/** The child's budget, serialised into `PI_DEVS_PSYCH_LIMITS`. */
	limits: ChildLimits;
	/** The parent's environment to copy, then amend. */
	baseEnv: NodeJS.ProcessEnv;
}

export interface ChildLaunch {
	/** The binary to spawn: node, never a shell. */
	command: string;
	/** The argv, starting with the engine CLI path. */
	args: string[];
	/** The environment for the child. */
	env: NodeJS.ProcessEnv;
	/** True when `context: "fork"` had no parent session file and fell back to `--no-session`. */
	fallback: boolean;
}

/**
 * Build the child's command, argv and environment.
 *
 * The argv order is fixed and matters: `--no-session`/`--fork` sits inside the launch group, the
 * `@message` token is last and alone, and `extraArgs` are appended after the flags we own but
 * before the message, so an operator-supplied token can never be mistaken for the prompt.
 */
export function buildChildLaunch(input: BuildChildLaunchInput): ChildLaunch {
	const fallback = input.context === "fork" && !input.parentSessionFile;
	const useFork = input.context === "fork" && Boolean(input.parentSessionFile);

	const sessionArgs = useFork
		? ["--fork", input.parentSessionFile as string, "--session-dir", join(input.runTmp, "session")]
		: ["--no-session"];

	const args = [
		input.cliPath,
		"--mode",
		"json",
		"-p",
		...sessionArgs,
		"--model",
		input.modelRef,
		...(input.thinking.length > 0 ? ["--thinking", input.thinking] : []),
		"--append-system-prompt",
		join(input.runTmp, "brief.md"),
		input.trusted ? "--approve" : "--no-approve",
		...input.extraArgs,
		// The message is its own token, never glued to prompt text (Q2).
		"@" + join(input.runTmp, "message.md"),
	];

	const env: NodeJS.ProcessEnv = { ...input.baseEnv };
	env[CHILD_ENV_MARKER] = "1";
	env[CHILD_ENV_RUN] = input.runId;
	env[CHILD_ENV_ROLE] = input.role;
	env[CHILD_ENV_LIMITS] = JSON.stringify(input.limits);
	// D5: the child gets our OWN marker and not the shared ones, which switch off peer plugins.
	for (const marker of SHARED_MARKERS) delete env[marker];

	return { command: input.execPath, args, env, fallback };
}
