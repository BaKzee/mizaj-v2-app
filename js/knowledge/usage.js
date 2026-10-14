export function computeUsage(b) {
    const versionFlavors = new Map();
    for (const v of b.recipeVersions)
        versionFlavors.set(v.versionId, new Set(v.ingredients.map((i) => i.flavorId)));
    const sessions = new Map();
    const certain = new Map();
    for (const s of b.sessions) {
        const sets = s.candidateVersionIds.map((id) => versionFlavors.get(id)).filter((x) => !!x);
        if (!sets.length)
            continue;
        const any = new Set();
        for (const st of sets)
            for (const f of st)
                any.add(f);
        for (const f of any) {
            sessions.set(f, (sessions.get(f) ?? 0) + 1);
            if (sets.every((st) => st.has(f)))
                certain.set(f, (certain.get(f) ?? 0) + 1);
        }
    }
    const recipes = new Map();
    for (const r of b.recipes) {
        for (const f of versionFlavors.get(r.headVersionId) ?? [])
            recipes.set(f, (recipes.get(f) ?? 0) + 1);
    }
    const rows = b.flavors.map((f) => ({
        flavorId: f.id, brand: f.brand, name: f.name,
        sessions: sessions.get(f.id) ?? 0, sessionsCertain: certain.get(f.id) ?? 0, recipesContaining: recipes.get(f.id) ?? 0, rank: 0,
    }));
    rows.sort((a, b2) => b2.sessions - a.sessions || b2.recipesContaining - a.recipesContaining || (a.flavorId < b2.flavorId ? -1 : a.flavorId > b2.flavorId ? 1 : 0));
    rows.forEach((r, i) => (r.rank = i + 1));
    return rows;
}
