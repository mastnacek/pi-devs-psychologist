/**
 * agent-runner-io — the injectable process surface for the agent runner (T24).
 *
 * The runner must be testable without spawning a real pi, so every side effect it performs lives
 * behind this interface: spawn, the temp-dir files, the kill, the clock. The real implementation is
 * `defaultAgentRunIo()`; the suite passes a fake whose "child" is an EventEmitter with two fake
 * streams, so a scripted JSONL stream can drive the whole run deterministically.
 *
 * Kept in its own file both to stay under the line budget and because the interface is the seam: a
 * reader who wants to know what a run touches reads this file and is done.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** How much stderr is kept for a failure message. The rest is dropped, not buffered. */
export const STDERR_TAIL_BYTES = 8 * 1024;

/** A readable stream of stdout/stderr, as much as the runner listens to. */
export interface ChildDataStream {
	on(event: "data", listener: (chunk: Buffer) => void): void;
}

/** The child process as much as the runner needs it: two streams, an error path and an exit. */
export interface ChildProcessHandle {
	pid?: number;
	stdout: ChildDataStream | null;
	stderr: ChildDataStream | null;
	on(event: "error", listener: (error: Error) => void): void;
	on(event: "close", listener: (code: number | null, signal: string | null) => void): void;
}

export interface SpawnCallOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	shell: false;
	stdio: ["ignore", "pipe", "pipe"];
	detached: boolean;
	windowsHide: boolean;
}

/** `setTimeout`'s handle, named so the interface never returns `unknown`. */
export type TimerHandle = ReturnType<typeof setTimeout>;

/** The injectable surface: spawn, the temp-dir filesystem, the kill and the clock. */
export interface AgentRunIo {
	spawn(command: string, args: string[], options: SpawnCallOptions): ChildProcessHandle;
	mkdir(path: string): Promise<void> | void;
	writeFile(path: string, data: string): Promise<void> | void;
	rm(path: string): Promise<void> | void;
	killTree(pid: number | undefined): void;
	now(): number;
	setTimeout(callback: () => void, ms: number): TimerHandle;
	clearTimeout(handle: TimerHandle): void;
}

/** The run directory. One per run, so two runs never share a transcript. */
export function agentRunTmpDir(runId: string): string {
	return join(tmpdir(), "pi-devs-psychologist", runId);
}

/** The real IO: node child_process, the node filesystem, taskkill/process-group kill, real clock. */
export function defaultAgentRunIo(): AgentRunIo {
	return {
		spawn: (command, args, options) => {
			// SAFETY: node's ChildProcess is structurally a superset of ChildProcessHandle (stdout/stderr
			// are Readables whose `on("data")` accepts a Buffer listener). The runner only ever calls the
			// members declared here, so the narrowing is sound.
			return spawn(command, args, options) as unknown as ChildProcessHandle;
		},
		mkdir: (path) =>
			mkdir(path, { recursive: true }).then(() => undefined),
		writeFile: (path, data) =>
			writeFile(path, data, "utf8").then(() => undefined),
		rm: (path) =>
			rm(path, { recursive: true, force: true }).then(() => undefined),
		killTree: (pid) => {
			if (typeof pid !== "number") return;
			try {
				if (process.platform === "win32") {
					// The git-bash `//PID` form works, but argv is not run through a shell here, so the plain
					// form is correct and finds the whole descendant tree (spike Q10).
					spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
				} else {
					process.kill(-pid);
				}
			} catch {
				// The child may already be gone; a kill that fails is not an error.
			}
		},
		now: () => Date.now(),
		setTimeout: (callback, ms) => setTimeout(callback, ms),
		clearTimeout: (handle) => clearTimeout(handle),
	};
}
