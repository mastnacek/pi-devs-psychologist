/**
 * model-catalog — the cached registry catalog the plugins' pickers read.
 *
 * Split out of `state.ts` by concept (and to keep both files under the line budget): `state.ts` owns
 * the session kernel, this owns the one derived fact that has to be cached because the completion
 * callback receives only the argument prefix and cannot ask the registry itself.
 */

/** The synchronous slice of the model registry this plugin reads. */
export interface ModelCatalogSource {
	getAvailable(): readonly ModelRefLike[];
	getAll(): readonly ModelRefLike[];
}

export interface ModelRefLike {
	provider?: unknown;
	id?: unknown;
}

/** The part of the state `refreshModelCatalog` writes. Structural, so a fake catalog is enough. */
export interface ModelCatalogHolder {
	modelCatalog: string[];
	modelProviders: string[];
}

/**
 * Refresh the cached catalog from the registry.
 *
 * Prefers models whose providers have complete auth — the ones this plugin could actually call —
 * and falls back to the whole catalog when nothing is configured yet, so the picker still teaches
 * what exists instead of being empty. Every entry comes from the registry and none is invented, so
 * a completed value is always a model the engine can resolve.
 *
 * Deliberately not called from `resetWindow`: the catalog is not session-window state and must
 * survive the reset that every session start performs.
 */
export function refreshModelCatalog(
	state: ModelCatalogHolder,
	registry: ModelCatalogSource | undefined,
): void {
	if (!registry) return;
	const collect = (read: () => readonly ModelRefLike[]): readonly ModelRefLike[] => {
		try {
			return read() ?? [];
		} catch {
			// A registry that cannot answer is treated as empty, never as a crash.
			return [];
		}
	};
	let models = collect(() => registry.getAvailable());
	if (models.length === 0) models = collect(() => registry.getAll());

	const refs = new Set<string>();
	const providers = new Set<string>();
	for (const model of models) {
		const provider = model?.provider;
		const id = model?.id;
		if (typeof provider !== "string" || provider.length === 0) continue;
		if (typeof id !== "string" || id.length === 0) continue;
		refs.add(provider + "/" + id);
		providers.add(provider);
	}
	state.modelCatalog = [...refs].sort();
	state.modelProviders = [...providers].sort();
}
