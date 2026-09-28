/**
 * pi-paths — where the running engine keeps its docs (T23).
 *
 * The brief points the child at the installed pi documentation, and that directory moves with the
 * node version, the machine and the store layout (skill §"Live Engine Documentation"). So it is
 * resolved at runtime, never hardcoded. The engine reads the same two facts: `process.argv[1]` is
 * the absolute path to `dist/bundle/cli.js`, and `PI_PACKAGE_DIR` points at the package directory
 * (spike Q1). Either yields the package root; `<root>/docs` is returned only when it actually holds
 * the navigation index, so a guess is never given to the model.
 *
 * The filesystem check is injected (`exists`) so the resolver is a pure decision in tests.
 */

import { dirname, join } from "node:path";

/** The package root is three levels above `dist/bundle/cli.js`. */
function packageRootFromCli(cliPath: string): string {
	return dirname(dirname(dirname(cliPath)));
}

export interface ResolvePiDocsDirInput {
	/** `process.argv[1]` — the running engine's CLI entry, when it looks like one. */
	argv1?: string;
	/** `process.env.PI_PACKAGE_DIR` — the fallback package directory. */
	packageDir?: string;
	/** `fs.existsSync`-shaped, injected so the resolver has no I/O of its own. */
	exists: (path: string) => boolean;
}

/**
 * The absolute docs directory, or `undefined` when it cannot be located.
 *
 * `argv1` is preferred because it is what is actually running; `packageDir` is the fallback. The
 * result is returned only if `<root>/docs/docs.json` exists.
 */
export function resolvePiDocsDir({ argv1, packageDir, exists }: ResolvePiDocsDirInput): string | undefined {
	const root = argv1 && argv1.length > 0 ? packageRootFromCli(argv1) : packageDir;
	if (!root || root.length === 0) return undefined;
	const docsDir = join(root, "docs");
	return exists(join(docsDir, "docs.json")) ? docsDir : undefined;
}
