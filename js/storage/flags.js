/**
 * Feature flags (MIGRATION §6: `MIZAJ_CORE_V2`, rollback without data loss).
 *
 * P0 ships with MIZAJ_CORE_V2 = false: the legacy UI stays the default. Flipping
 * the flag only chooses which UI reads which database; it never writes to either
 * database, so switching back and forth cannot lose data.
 */
export const FLAGS_KEY = 'mizaj:v2:flags';
export const DEFAULT_FLAGS = Object.freeze({ MIZAJ_CORE_V2: false });
export function readFlags(kv) {
    if (!kv)
        return { ...DEFAULT_FLAGS };
    try {
        const raw = kv.getItem(FLAGS_KEY);
        if (!raw)
            return { ...DEFAULT_FLAGS };
        const parsed = JSON.parse(raw);
        return { MIZAJ_CORE_V2: parsed.MIZAJ_CORE_V2 === true };
    }
    catch {
        return { ...DEFAULT_FLAGS };
    }
}
export function writeFlags(kv, flags) {
    if (!kv)
        return false;
    try {
        kv.setItem(FLAGS_KEY, JSON.stringify({ MIZAJ_CORE_V2: flags.MIZAJ_CORE_V2 === true }));
        return true;
    }
    catch {
        return false;
    }
}
