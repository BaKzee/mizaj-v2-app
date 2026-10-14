/**
 * MIZAJ v2 domain types.
 *
 * These types encode the contract in docs/02_MIZAJ_CORE.md and
 * docs/04_DATA_AND_MIGRATION.md. They describe DATA and PROVENANCE; nothing in
 * this file predicts taste or safety.
 */
export const SCHEMA_VERSION = 2;
export const ENGINE_VERSION = '2.3.0-p3';
/* ------------------------------------------------------------------ *
 * Provenance vocabulary (CORE §3)
 * ------------------------------------------------------------------ */
/** Source classes for every assertion. Fixed by CORE §3 — do not extend casually. */
export const SOURCE_TYPES = [
    'USER_OBSERVATION', // personal exact-version observation
    'MANUFACTURER_DESCRIPTION', // what the maker says about its own product (not a test result)
    'PUBLISHED_FORMULA', // externally published exact recipe (ingredients + proportions)
    'PEER_REVIEWED_METHOD', // general method / theory; never a brand-specific mix ratio
    'MODEL_INFERENCE', // computed by this software; may be wrong
    'LEGACY_UNVERIFIED', // inherited from the v1 app with no traceable source
    'UNKNOWN',
];
export const VERIFICATION_STATUSES = ['verified', 'plausible', 'unverified', 'rejected'];
/** How a claim may be used downstream. Legacy heuristics can never be a hard veto. */
export const CLAIM_USAGES = [
    'structural', // identity / bookkeeping facts (ids, names) needed to operate
    'descriptive_only', // may be shown, with its badge; never used for ranking
    'weak_prior', // may nudge ordering in later phases, never decides alone
    'warning_only', // may raise a visible caution; never rejects a recipe
    'excluded', // stored for audit only; must not be shown as advice
];
/** Who published the page. Only `manufacturer` pages can back a MANUFACTURER_DESCRIPTION. */
export const PUBLISHER_ROLES = ['manufacturer', 'official_distributor', 'retailer', 'review_site', 'research', 'health_authority'];
export const RECIPE_VERSION_ORIGINS = ['recorded', 'published', 'derived', 'hypothesis', 'legacy'];
/* ------------------------------------------------------------------ *
 * Inventory (event-sourced, integer milligrams)
 * ------------------------------------------------------------------ */
export const INVENTORY_EVENT_TYPES = ['opening_snapshot', 'purchase', 'consume', 'correction', 'waste', 'refund'];
