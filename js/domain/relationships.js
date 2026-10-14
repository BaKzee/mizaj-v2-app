export const RELATIONSHIP_TYPES = [
    'same_profile',
    'complementary',
    'contrast',
    'potential_redundancy',
    'reported_clash',
    'unknown',
];
export function pairKey(a, b) {
    if (a === b)
        throw new RangeError('pairKey: a relationship needs two different entities');
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}
export function groupKey(members) {
    return [...new Set(members)].sort().join('|');
}
/** Index pair claims once; lookups are then O(1) and symmetric by construction. */
export class RelationshipIndex {
    #byPair = new Map();
    constructor(claims) {
        const add = (key, view) => {
            const list = this.#byPair.get(key) ?? [];
            if (!list.some((x) => x.claimId === view.claimId))
                list.push(view);
            this.#byPair.set(key, list);
        };
        for (const c of claims) {
            const isPair = c.entityType === 'flavor_pair' || c.entityType === 'family_pair';
            // A group claim (e.g. the v1 "duplicates" list) holds for every pair of its members.
            const isGroup = c.entityType === 'flavor_group';
            if (!isPair && !isGroup)
                continue;
            const v = c.claimValue;
            const view = {
                relationshipType: v?.relationshipType ?? 'unknown',
                claimId: c.claimId,
                usage: c.usage,
                verificationStatus: c.verificationStatus,
                conflicting: c.conflicting,
                note: v?.note ?? null,
            };
            if (isPair) {
                add(c.entityId, view);
                continue;
            }
            const members = [...new Set(c.entityId.split('|'))].sort();
            for (let i = 0; i < members.length; i++)
                for (let j = i + 1; j < members.length; j++)
                    add(pairKey(members[i], members[j]), view);
        }
        for (const list of this.#byPair.values())
            list.sort((x, y) => (x.claimId < y.claimId ? -1 : 1));
    }
    between(a, b) {
        return [...(this.#byPair.get(pairKey(a, b)) ?? [])];
    }
    /** True only if some claim could block a pair. By policy this is always false in P0. */
    hasHardVeto(a, b) {
        return this.between(a, b).some((r) => r.usage === 'structural' && r.relationshipType === 'reported_clash');
    }
}
