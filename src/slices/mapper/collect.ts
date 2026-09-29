/**
 * mapper/collect — the impure walk that turns a directory tree into counted files (T8).
 *
 * This is the only part of the mapper that touches the filesystem, and it is deliberately the
 * narrowest surface that can: it reads a file to count its `\n`s and then throws the text away.
 * Nothing but the line count ever leaves this file, which is what makes "the mapper reads repo
 * structure, never file contents" a property of the code rather than a promise.
 *
 * Safety rules, all load-bearing:
 * - **Never follow symlinks.** `stat` is the platform's `lstat`, and a symlink is skipped outright
 *   rather than resolved, so a link to the OS temp dir cannot pull files from outside `cwd` in.
 * - **Never leave `cwd`.** The walk starts at `cwd` and only ever enqueues a non-symlink
 *   subdirectory of a directory already inside it.
 * - **Bounded.** At most `MAX_REPO_FILES` files, a 1 MiB read cap per file, and a 20 000-line cap;
 *   anything over the caps is counted in `skippedLarge` and never measured.
 */

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { RepoFile } from "../../shared/repo-map.js";

/** The process surface the walk uses. Injectable so tests can drive a virtual tree. */
export interface MapperIo {
	readdir(path: string): string[];
	/** MUST be `lstat` semantics: never resolve a symlink. */
	stat(path: string): { size: number; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean };
	readFile(path: string): string;
	exists(path: string): boolean;
}

/** The real filesystem. `stat` is `lstatSync` so a symlink is seen as a link, not as its target. */
export function defaultMapperIo(): MapperIo {
	return {
		readdir: (path) => readdirSync(path),
		stat: (path) => lstatSync(path),
		readFile: (path) => readFileSync(path, "utf8"),
		exists: (path) => existsSync(path),
	};
}

export interface CollectOptions {
	/** File cap. Defaults to `MAX_REPO_FILES`; lower values are a test seam. */
	maxFiles?: number;
}

export interface CollectedRepoFiles {
	files: RepoFile[];
	/** Files counted as skipped: over the byte cap or over the line cap. */
	skippedLarge: number;
}

export const MAX_REPO_FILES = 4000;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_FILE_LINES = 20000;

/** Counted extensions. Config/markup files count too; a binary-ish file is caught by the caps. */
export const ALLOWED_EXTENSIONS = new Set([
	".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs", ".md", ".json", ".py", ".rs",
	".go", ".java", ".cs", ".rb", ".php", ".sh", ".sql", ".yaml", ".yml", ".toml",
]);

/** Directory names the walk never descends into: build output, VCS metadata, the engine's own dirs. */
export function skipDirectory(name: string): boolean {
	if (name === "node_modules" || name === "dist" || name === "build" || name === "coverage") return true;
	// Every dot-directory is skipped (`.git`, `.pi`, `.pi-lens`, …) except `.github`.
	return name.startsWith(".") && name !== ".github";
}

function extOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** Newlines, plus one for a non-empty file with no trailing newline (its last line still exists). */
function countLines(text: string): number {
	let lines = 0;
	for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) lines += 1;
	if (text.length > 0 && text.charCodeAt(text.length - 1) !== 10) lines += 1;
	return lines;
}

/** Repo-relative, forward-slashed, so the same tree yields the same path on Windows and POSIX. */
function toPosix(path: string): string {
	return path.split(sep).join("/");
}

/**
 * Walk `cwd` breadth-first and return the counted files, plus the skipped-large tally.
 *
 * A directory that cannot be read, an entry that cannot be statted and a file that cannot be read
 * are all skipped silently: an unreadable node is not a fact about the repo, and a walk that threw
 * on one would lose the whole map.
 */
export function collectRepoFiles(
	cwd: string,
	io: MapperIo = defaultMapperIo(),
	options: CollectOptions = {},
): CollectedRepoFiles {
	const maxFiles = options.maxFiles ?? MAX_REPO_FILES;
	const files: RepoFile[] = [];
	let skippedLarge = 0;
	const queue: string[] = [cwd];

	while (queue.length > 0 && files.length < maxFiles) {
		const dir = queue.shift() as string;
		let entries: string[];
		try {
			entries = io.readdir(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (files.length >= maxFiles) break;
			const full = join(dir, entry);
			let stat: ReturnType<MapperIo["stat"]>;
			try {
				stat = io.stat(full);
			} catch {
				continue;
			}
			// A symlink is skipped before its type is consulted: following it would let a link to
			// `/tmp` or a parent directory pull files from outside `cwd` into the map.
			if (stat.isSymbolicLink()) continue;
			if (stat.isDirectory()) {
				if (!skipDirectory(entry)) queue.push(full);
				continue;
			}
			if (!stat.isFile()) continue;
			if (!ALLOWED_EXTENSIONS.has(extOf(entry))) continue;
			if (stat.size > MAX_FILE_BYTES) {
				skippedLarge += 1;
				continue;
			}
			let text: string;
			try {
				text = io.readFile(full);
			} catch {
				continue;
			}
			const lineCount = countLines(text);
			// Binary-ish: a jetpack of lines is not readable source, so it is counted as skipped
			// rather than allowed to dominate the longest-file fact.
			if (lineCount > MAX_FILE_LINES) {
				skippedLarge += 1;
				continue;
			}
			files.push({ path: toPosix(relative(cwd, full)), lineCount });
		}
	}

	return { files, skippedLarge };
}
