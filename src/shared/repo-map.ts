/**
 * repo-map — the objective structural map of the repo a session is working in, as arithmetic and
 * citable lines (T8).
 *
 * The appraiser otherwise has no idea how big the codebase is, so "this is a large change" is a
 * guess. This module turns a list of `{ path, lineCount }` into counts the model may cite: file
 * totals, the longest file, the test-to-source ratio, the slice layout. Every number is arithmetic
 * over the collected list, so a finding resting on "18 files over 300 lines" survives enforcement
 * without the model having interpreted anything.
 *
 * This is the PURE core: it never touches the filesystem, the clock or the model. The impure walk
 * lives in `src/slices/mapper/collect.ts`, which hands this function a plain list. That split is
 * what makes "the mapper reads REPO STRUCTURE, never file contents" checkable — no content ever
 * exists here, only a counted line per path.
 *
 * Facts:
 *   fileCount           files counted
 *   sourceFileCount     source-language files that are not tests
 *   testFileCount       files under a test directory or named `*.test.*` / `*.spec.*`
 *   testToSourceRatio   test / source, rounded to 2 decimals; 0 when there are no sources
 *   longestFile         most lines; ties resolve to the lexicographically first path
 *   filesOver300Lines   strictly more than 300 lines
 *   topLevelDirs        first path segment, by file count desc then name (≤ 6)
 *   sliceDirs           `src`/`slice(s)` directories with ≥ 2 subdirectories (≤ 4)
 *   medianFileLines     median of the line counts
 */

/** One counted file. `path` is repo-relative and `/`-separated so the number is portable. */
export interface RepoFile {
	path: string;
	lineCount: number;
}

/** A top-level directory and how many counted files live under it. */
export interface RepoMapDir {
	name: string;
	count: number;
}

/** A `src`/`slice(s)` directory with at least two subdirectories. */
export interface RepoSliceDir {
	path: string;
	childCount: number;
	fileCount: number;
}

export interface RepoMap {
	fileCount: number;
	sourceFileCount: number;
	testFileCount: number;
	testToSourceRatio: number;
	longestFile: { path: string; lines: number } | undefined;
	filesOver300Lines: number;
	topLevelDirs: RepoMapDir[];
	sliceDirs: RepoSliceDir[];
	medianFileLines: number;
	/** Files the collector could not count: binary-ish (> 20 000 lines) or over the 1 MiB read cap. */
	skippedLarge: number;
}

export interface RepoMapOptions {
	/** Files the collector skipped as too large to count; surfaced as a fact, never a line. */
	skippedLarge?: number;
	/** Classify a path as source. Overridable so a caller can pin its own languages. */
	isSource?: (path: string) => boolean;
	/** Classify a path as test. */
	isTest?: (path: string) => boolean;
}

/**
 * The cached map for one session (T8). Held in `state` so the walk runs once per cwd and every
 * later appraisal and `/psych` reuses the same numbers, instead of re-reading the tree each turn.
 */
export interface RepoMapCache {
	cwd: string;
	available: boolean;
	facts: RepoMap | undefined;
	evidence: string[];
	computedAtTurn: number;
}

/** A map older than this many turns is shown as stale in the report. */
export const MAP_STALE_TURNS = 20;

const MAX_LEVELS = 300;
const MAX_TOP_LEVEL = 6;
const MAX_SLICE_DIRS = 4;

/** Source languages the map counts as "source". Config/markup files exist but are not sources. */
const SOURCE_EXT = new Set([
	".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs",
	".py", ".rs", ".go", ".java", ".cs", ".rb", ".php",
]);

/** Pre-computed one-decimal-capped ratio: `Math.round(x * 100) / 100`, and 0 when undefined. */
function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function extOf(path: string): string {
	const base = path.slice(path.lastIndexOf("/") + 1);
	const dot = base.lastIndexOf(".");
	return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** A test by location (`test/`, `tests/`, `__tests__/`, `spec/`) or by name (`*.test.*`, `*.spec.*`). */
export function defaultIsTest(path: string): boolean {
	const segments = path.split("/");
	for (let i = 0; i < segments.length - 1; i += 1) {
		if (/^(tests?|__tests__|spec)$/i.test(segments[i])) return true;
	}
	return /\.(test|spec)\.[^./]+$/i.test(path);
}

/** A source-language file that is not itself a test. */
export function defaultIsSource(path: string): boolean {
	return SOURCE_EXT.has(extOf(path)) && !defaultIsTest(path);
}

/** Build the map and its citable lines from a list of already-counted files. */
export function buildRepoMap(
	files: readonly RepoFile[],
	options: RepoMapOptions = {},
): { evidence: string[]; facts: RepoMap } {
	const isTest = options.isTest ?? defaultIsTest;
	const isSource = options.isSource ?? ((path: string) => SOURCE_EXT.has(extOf(path)) && !isTest(path));

	const fileCount = files.length;
	let sourceFileCount = 0;
	let testFileCount = 0;
	let longestFile: { path: string; lines: number } | undefined;
	let filesOver300Lines = 0;

	for (const file of files) {
		if (isTest(file.path)) testFileCount += 1;
		else if (isSource(file.path)) sourceFileCount += 1;
		if (file.lineCount > MAX_LEVELS) filesOver300Lines += 1;
		// Ties resolve to the lexicographically first path, whatever order the collector produced.
		if (
			longestFile === undefined ||
			file.lineCount > longestFile.lines ||
			(file.lineCount === longestFile.lines && file.path < longestFile.path)
		) {
			longestFile = { path: file.path, lines: file.lineCount };
		}
	}

	const testToSourceRatio = sourceFileCount === 0 ? 0 : round2(testFileCount / sourceFileCount);

	// One pass over every ancestor directory: `dirFiles` counts files recursively, `dirChildren`
	// records immediate children, so both the top-level tally and the slice layout fall out.
	const dirFiles = new Map<string, number>();
	const dirChildren = new Map<string, Set<string>>();
	const topLevel = new Map<string, number>();
	for (const file of files) {
		const segments = file.path.split("/");
		if (segments.length > 1) topLevel.set(segments[0], (topLevel.get(segments[0]) ?? 0) + 1);
		for (let i = 1; i <= segments.length - 1; i += 1) {
			const dir = segments.slice(0, i).join("/");
			dirFiles.set(dir, (dirFiles.get(dir) ?? 0) + 1);
			if (i >= 2) {
				const parent = segments.slice(0, i - 1).join("/");
				const children = dirChildren.get(parent) ?? new Set<string>();
				children.add(dir);
				dirChildren.set(parent, children);
			}
		}
	}

	const topLevelDirs: RepoMapDir[] = [...topLevel.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
		.slice(0, MAX_TOP_LEVEL);

	const sliceDirs: RepoSliceDir[] = [...dirFiles.entries()]
		.filter(([dir]) => /^(slices?|src)$/i.test(baseName(dir)))
		.map(([dir, fileCount]: [string, number]) => ({
			path: dir,
			childCount: dirChildren.get(dir)?.size ?? 0,
			fileCount,
		}))
		.filter((dir) => dir.childCount >= 2)
		.sort((a, b) => b.fileCount - a.fileCount || a.path.localeCompare(b.path))
		.slice(0, MAX_SLICE_DIRS);

	const sorted = files.map((file) => file.lineCount).sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const medianFileLines =
		sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

	const facts: RepoMap = {
		fileCount,
		sourceFileCount,
		testFileCount,
		testToSourceRatio,
		longestFile,
		filesOver300Lines,
		topLevelDirs,
		sliceDirs,
		medianFileLines,
		skippedLarge: options.skippedLarge ?? 0,
	};

	const evidence: string[] = [
		`repo: ${fileCount} file(s) tracked by structure (${sourceFileCount} source, ${testFileCount} test, ratio ${testToSourceRatio.toFixed(2)})`,
	];
	if (fileCount > 0 && longestFile) {
		evidence.push(`repo: longest file ${longestFile.path} at ${longestFile.lines} lines`);
		evidence.push(`repo: ${filesOver300Lines} file(s) over 300 lines`);
	}
	if (topLevelDirs.length > 1) {
		evidence.push(
			`repo: top-level directories: ${topLevelDirs.map((dir) => `${dir.name} (${dir.count})`).join(", ")}`,
		);
	}
	if (sliceDirs.length > 0) {
		evidence.push(
			`repo: slice layout: ${sliceDirs
				.map((dir) => `${dir.path}/… children: ${dir.childCount} (${dir.fileCount} files)`)
				.join(", ")}`,
		);
	}
	if (fileCount > 0) {
		evidence.push(`repo: median file ${Math.round(medianFileLines)} lines`);
	}

	return { evidence, facts };
}
