export const PRECISION_CONFIG_V1 = Object.freeze({
    id: 'precision-config@1',
    // Owner's recorded formulas: 141 of 144 versions have ≤ 5 products (DECISIONS C-22).
    defaults: { maxProducts: 5, sourceQualityMin: 'recorded', gramsTotalMg: 20_000 },
    retrieval: { maxReferences: 12, minTargetCoverage: 0.5 },
    diversity: { maxIngredientJaccard: 0.6, minDescriptorDistance: 0.5 },
    caution: { lowRating: 2, similarJaccard: 0.75, similarHalfL1Bp: 2000 },
    ranking: {
        weights: { evidence: 4, target: 3, redundancy: 1, uncertainty: 1, complexity: 0.25, stock: 1 },
        perturbation: 0.25,
    },
});
