/** "Strong personal record" for audit display only: ≥3 probable ratings averaging ≥4.5. */
export const STRONG_RECORD_MIN_N = 3;
export const STRONG_RECORD_MIN_AVG = 4.5;
function num(f, k) {
    const v = f[k];
    return typeof v === 'number' ? v : NaN;
}
function roles(f) {
    return Array.isArray(f['roles']) ? f['roles'] : [];
}
function runCheck(formulas, byId, pred) {
    let flagged = 0;
    const strong = [];
    for (const fm of formulas) {
        const items = fm.items.map((i) => ({ f: byId.get(i.id), pct: i.pct })).filter((x) => x.f);
        if (items.length !== fm.items.length)
            continue;
        const hit = pred(items);
        if (!hit)
            continue;
        flagged += 1;
        const n = fm.probableRatings.length;
        const avg = n ? fm.probableRatings.reduce((s, x) => s + x, 0) / n : null;
        if (n >= STRONG_RECORD_MIN_N && avg !== null && avg >= STRONG_RECORD_MIN_AVG) {
            strong.push({ key: fm.key, name: fm.name, probableN: n, probableAvg: Math.round(avg * 100) / 100, detail: hit });
        }
    }
    strong.sort((a, b) => b.probableN - a.probableN || (a.key < b.key ? -1 : 1));
    return { formulasChecked: formulas.length, flagged, flaggedWithStrongPersonalRecord: strong };
}
const COOL_BLOCK_SUBFAMILIES = new Set(['قهوة', 'شوكولاتة وبندق', 'شوكولاتة مخبوزة']); // L1313
export function auditLegacyRules(catalog, formulas) {
    const byId = new Map(catalog.flavors.map((f) => [f.id, f]));
    const out = [];
    const law = (n) => catalog.laws.find((l) => l.n === n);
    const lawText = (n) => {
        const l = law(n);
        return l ? `${l.title}: ${l.rule}` : `(law ${n} missing from catalog)`;
    };
    // --- Family matrix (asymmetry + use as score) ---------------------------
    const fams = Object.keys(catalog.familyMatrix);
    const asym = [];
    for (const a of fams)
        for (const b of fams)
            if (a < b && catalog.familyMatrix[a]?.[b] !== catalog.familyMatrix[b]?.[a])
                asym.push(`${a}↔${b}: ${catalog.familyMatrix[a]?.[b]} vs ${catalog.familyMatrix[b]?.[a]}`);
    out.push({
        ruleId: 'R-MATRIX', category: 'family_matrix', location: 'index.html L603 DATA.familyMatrix; used as min-score at L1322',
        legacyText: `10×10 family compatibility scores 1–5. Asymmetric pairs: ${asym.join('; ') || 'none'}`,
        legacyEnforcement: 'score', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'demoted_to_weak_prior',
        rationale: 'No source for the numbers; family-level scores ignore concentration and full-mix context (S-002: mixture perception is largely not predictable from composition). Asymmetric pairs are stored as conflicting and excluded.',
        evidenceNeededToUpgrade: 'Documented sensory test of specific product pairs at stated concentrations, or a published corpus with method.',
        methodSourceIds: ['S-002'],
        check: runCheck(formulas, byId, (items) => {
            let min = 5;
            let pair = '';
            for (const x of items)
                for (const y of items)
                    if (x !== y) {
                        const s = catalog.familyMatrix[x.f.family]?.[y.f.family];
                        if (typeof s === 'number' && s < min) {
                            min = s;
                            pair = `${x.f.family}→${y.f.family}`;
                        }
                    }
            return min <= 1 ? `lowest family score ${min} (${pair})` : null;
        }),
    });
    // --- Law 1: acid + cream "curdling" -------------------------------------
    out.push({
        ruleId: 'R-LAW1', category: 'law_curdling', location: 'DATA.laws[n=1]; evaluate() L1284-1287; banRules[0]',
        legacyText: lawText(1), legacyEnforcement: 'warning', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'scientific_claim_removed',
        rationale: 'The chemical claim (citric acid reacting with fat protein in smoke) has no source and is removed. A possible aromatic mismatch may remain as a non-blocking caution.',
        evidenceNeededToUpgrade: 'Direct study on comparable materials or a documented sensory panel; until then: caution text only.',
        methodSourceIds: ['S-002'],
        check: runCheck(formulas, byId, (items) => {
            for (const a of items)
                for (const b of items)
                    if (a !== b && num(a.f, 'acid') >= 4 && b.f.family === 'creamy' && num(b.f, 'density') >= 4)
                        return `${a.f.name} (acid ${num(a.f, 'acid')}) + ${b.f.name} (creamy density ${num(b.f, 'density')})`;
            return null;
        }),
    });
    // --- Law 2: stacking (second of a family ≤15%) + three berries ----------
    out.push({
        ruleId: 'R-LAW2', category: 'law_stacking', location: 'DATA.laws[n=2]; windowFor() L1342-1343; evaluate() L1298-1302',
        legacyText: lawText(2), legacyEnforcement: 'cap', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'demoted_to_warning',
        rationale: 'Redundancy is a useful heuristic (CORE §8) but the 15% cap is unsourced; v2 reports potential redundancy instead of capping.',
        evidenceNeededToUpgrade: 'Exact-version observations showing loss of identity attributable to same-family stacking.',
        methodSourceIds: ['S-002'],
        check: runCheck(formulas, byId, (items) => {
            const byFam = new Map();
            for (const x of items)
                byFam.set(x.f.family, [...(byFam.get(x.f.family) ?? []), x.pct]);
            for (const [fam, pcts] of byFam) {
                if (pcts.length < 2)
                    continue;
                const sorted = [...pcts].sort((a, b) => b - a);
                if (sorted.slice(1).some((p) => p > 15))
                    return `family ${fam}: ${sorted.join('/')}%`;
            }
            return null;
        }),
    });
    out.push({
        ruleId: 'R-BANRULE-3BERRY', category: 'ban_rule', location: 'DATA.banRules[1]; evaluate() L1305-1306 (hard)',
        legacyText: catalog.banRules[1] ? `${catalog.banRules[1].text} — ${catalog.banRules[1].reason}` : 'three berries together',
        legacyEnforcement: 'hard_block', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'demoted_to_warning',
        rationale: '“The brain cannot distinguish three berries” is an unsourced generalisation; becomes a redundancy caution.',
        evidenceNeededToUpgrade: 'Sensory evidence on the specific products.', methodSourceIds: [],
        check: runCheck(formulas, byId, (items) => {
            const n = items.filter((x) => x.f.family === 'berry').length;
            return n >= 3 ? `${n} berry-family products` : null;
        }),
    });
    // --- Law 3: dominance ----------------------------------------------------
    out.push({
        ruleId: 'R-LAW3', category: 'law_dominance', location: 'DATA.laws[n=3]; windowFor() L1348-1350',
        legacyText: lawText(3), legacyEnforcement: 'cap', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'demoted_to_warning',
        rationale: 'Masking is real (S-002) but its direction depends on concentration and products; legacy “dominance ladder” values are unmeasured.',
        evidenceNeededToUpgrade: 'Measured or panel-rated perceived intensity per product (CORE §7: intensity stays null until measured).',
        methodSourceIds: ['S-002'],
        check: runCheck(formulas, byId, (items) => {
            const max = Math.max(...items.map((x) => x.pct));
            const top = items.filter((x) => x.pct === max);
            return top.length >= 2 ? `tie at top ${max}%: ${top.map((x) => x.f.name).join(' = ')}` : null;
        }),
    });
    // --- Law 4: bridges “guaranteed” -----------------------------------------
    out.push({
        ruleId: 'R-LAW4', category: 'law_bridge', location: 'DATA.laws[n=4]; BRIDGE_NAMES L1463',
        legacyText: lawText(4), legacyEnforcement: 'recommendation', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'scientific_claim_removed',
        rationale: 'CORE §2: no product holds a universal bridge role; a product’s role must be shown in a referenced recipe.',
        evidenceNeededToUpgrade: 'Specific reference recipes or sensory data.', methodSourceIds: [], check: null,
    });
    // --- Law 5: heat ceiling / volatility gaps -------------------------------
    out.push({
        ruleId: 'R-LAW5-CEILING', category: 'law_heat_volatility', location: 'DATA.laws[n=5]; evaluate() L1291-1294',
        legacyText: lawText(5), legacyEnforcement: 'warning', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'excluded_safety_sensitive',
        rationale: 'Heat-ceiling values are unmeasured and heat advice is out of scope (rule 12, CORE §11). Excluded from taste reasoning; kept only for audit.',
        evidenceNeededToUpgrade: 'Not upgradeable to a recommendation in this product: heat/coal guidance is excluded by policy.',
        methodSourceIds: ['S-003'],
        check: runCheck(formulas, byId, (items) => {
            for (const a of items)
                for (const b of items)
                    if (a !== b && Math.abs(num(a.f, 'ceiling') - num(b.f, 'ceiling')) >= 3)
                        return `ceiling gap ${a.f.name} ${num(a.f, 'ceiling')} vs ${b.f.name} ${num(b.f, 'ceiling')}`;
            return null;
        }),
    });
    out.push({
        ruleId: 'R-LAW5-VOLATILITY', category: 'law_heat_volatility', location: 'evaluate() L1293-1294',
        legacyText: 'Volatility gap ≥3 between two flavors → “one dies before the other wakes”.',
        legacyEnforcement: 'warning', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'demoted_to_warning',
        rationale: 'Volatility values are unmeasured estimates; may be displayed as an unverified note only.',
        evidenceNeededToUpgrade: 'Time-resolved observations on the exact products.', methodSourceIds: [],
        check: runCheck(formulas, byId, (items) => {
            for (const a of items)
                for (const b of items)
                    if (a !== b && Math.abs(num(a.f, 'volatility') - num(b.f, 'volatility')) >= 3)
                        return `volatility gap ${a.f.name}/${b.f.name}`;
            return null;
        }),
    });
    // --- Law 6: cooling 5% cap and “never with” bans -------------------------
    out.push({
        ruleId: 'R-LAW6-CAP', category: 'law_cooling', location: 'DATA.laws[n=6]; windowFor() L1345-1346',
        legacyText: lawText(6), legacyEnforcement: 'cap', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'demoted_to_warning',
        rationale: 'CORE §2: the general “cooling ≤5%” ban is cancelled as a scientific rule; no invented thresholds.',
        evidenceNeededToUpgrade: 'Product-specific information for the cooling product in question.', methodSourceIds: [],
        check: runCheck(formulas, byId, (items) => {
            const c = items.find((x) => roles(x.f).includes('pureCool') && x.pct > 5);
            return c ? `${c.f.name} at ${c.pct}%` : null;
        }),
    });
    out.push({
        ruleId: 'R-LAW6-NEVER', category: 'law_cooling', location: 'DATA.laws[n=6].ban; evaluate() L1310-1316 (hard block)',
        legacyText: (law(6)?.ban ?? []).join(' · '),
        legacyEnforcement: 'hard_block', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'demoted_to_warning',
        rationale: '“Forbidden forever” is unsourced; becomes a visible caution, never a block.',
        evidenceNeededToUpgrade: 'Sensory evidence on specific products and concentrations.', methodSourceIds: [],
        check: runCheck(formulas, byId, (items) => {
            const cool = items.find((x) => roles(x.f).includes('pureCool'));
            if (!cool)
                return null;
            const blocker = items.find((x) => ['creamy', 'floral'].includes(x.f.family) || COOL_BLOCK_SUBFAMILIES.has(String(x.f.subfamily)));
            return blocker ? `${cool.f.name} with ${blocker.f.name}` : null;
        }),
    });
    // --- Per-flavor percentage windows ---------------------------------------
    out.push({
        ruleId: 'R-PCT-MAX', category: 'pct_threshold', location: 'DATA.flavors[*].maxPct; windowFor() L1337-1355',
        legacyText: 'Each flavor has min/ideal/max % (and 5 have hardCap). Above maxPct “may swallow the rest of the blend”.',
        legacyEnforcement: 'cap', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'demoted_to_warning',
        rationale: 'CORE §2 + golden case 1: idealPct/minPct/maxPct are legacy_heuristic, non-binding.',
        evidenceNeededToUpgrade: 'Evidence at the product and version level.', methodSourceIds: [],
        check: runCheck(formulas, byId, (items) => {
            const x = items.find((i) => i.pct > num(i.f, 'maxPct'));
            return x ? `${x.f.name} ${x.pct}% > maxPct ${num(x.f, 'maxPct')}` : null;
        }),
    });
    out.push({
        ruleId: 'R-PCT-HARDCAP', category: 'pct_threshold', location: 'DATA.flavors[*].hardCap; windowFor() L1352-1353',
        legacyText: '“Documented cap — exceeding it changes its taste” (5 products).',
        legacyEnforcement: 'cap', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'demoted_to_warning',
        rationale: 'Called “documented” in the UI but no document is referenced.', evidenceNeededToUpgrade: 'The referenced document.', methodSourceIds: [],
        check: runCheck(formulas, byId, (items) => {
            const x = items.find((i) => typeof i.f['hardCap'] === 'number' && i.pct > i.f['hardCap']);
            return x ? `${x.f.name} ${x.pct}% > hardCap ${String(x.f['hardCap'])}` : null;
        }),
    });
    // --- Pair bans (47) ------------------------------------------------------
    const fail = catalog.bans.filter((b) => b.kind === 'fail');
    const waste = catalog.bans.filter((b) => b.kind !== 'fail');
    const banPred = (list) => (items) => {
        const names = new Set(items.map((x) => x.f.name));
        const b = list.find((x) => names.has(x.a) && names.has(x.b));
        return b ? `${b.a} × ${b.b}: ${b.reason}` : null;
    };
    out.push({
        ruleId: 'R-BAN-FAIL', category: 'pair_ban', location: `DATA.bans (${fail.length} kind=fail); evaluate() L1273 (hard block)`,
        legacyText: `${fail.length} product pairs marked as failures.`, legacyEnforcement: 'hard_block', sourceType: 'LEGACY_UNVERIFIED',
        v2Decision: 'demoted_to_warning', rationale: 'Unsourced pair verdicts become reported_clash warnings (CORE §6); a single bad rating is never a universal ban.',
        evidenceNeededToUpgrade: 'Exact-version observations or documented tests of the pair.', methodSourceIds: [],
        check: runCheck(formulas, byId, banPred(fail)),
    });
    out.push({
        ruleId: 'R-BAN-WASTE', category: 'pair_waste', location: `DATA.bans (${waste.length} kind=waste); evaluate() L1274`,
        legacyText: `${waste.length} product pairs marked as redundant (“waste”).`, legacyEnforcement: 'warning', sourceType: 'LEGACY_UNVERIFIED',
        v2Decision: 'demoted_to_warning', rationale: 'Kept as potential_redundancy information.', evidenceNeededToUpgrade: 'Product identity audit (P1).', methodSourceIds: [],
        check: runCheck(formulas, byId, banPred(waste)),
    });
    // --- Generator structure, setup and chip advice --------------------------
    out.push({
        ruleId: 'R-GEN-SKELETON', category: 'generator_structure', location: 'generateFromTaste() L3723-3812',
        legacyText: 'Random weighted pick (Math.random L3751) into a fixed main/bottom/top/bridge skeleton (35/25/15/15), then filler products until 100%.',
        legacyEnforcement: 'structure', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'replaced_by_structural_rule',
        rationale: 'Violates CORE §8 (no forced 4 ingredients) and ENGINE §4 (deterministic, no arbitrary filler). Replaced by integer-bp structural validation now and the P2 engine later.',
        evidenceNeededToUpgrade: 'n/a', methodSourceIds: [], check: null,
    });
    out.push({
        ruleId: 'R-SETUP-HEAT', category: 'setup_heat_coal', location: 'inferBowl() L3704-3720; DATA.recipes[*].setup',
        legacyText: 'Heat level, coal count and session minutes derived from the lowest “heat ceiling”.',
        legacyEnforcement: 'recommendation', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'excluded_safety_sensitive',
        rationale: 'Rule 12 / CORE §11: no coal or heat recommendations; a flavor match says nothing about smoke harm (S-003).',
        evidenceNeededToUpgrade: 'Not upgradeable within this product.', methodSourceIds: ['S-003', 'S-004'], check: null,
    });
    out.push({
        ruleId: 'R-CHIP-ADVICE', category: 'chip_advice', location: 'CHIPS L1897-1912 (fix texts saved into each rating)',
        legacyText: 'Quick-tag remedies such as “add half a coal” stored inside ratings.fix.',
        legacyEnforcement: 'recommendation', sourceType: 'LEGACY_UNVERIFIED', v2Decision: 'excluded_safety_sensitive',
        rationale: 'Stored verbatim as legacyAutoAdvice (usage=excluded); the user’s own tags and notes are kept as observations.',
        evidenceNeededToUpgrade: 'n/a', methodSourceIds: ['S-003'], check: null,
    });
    return out;
}
