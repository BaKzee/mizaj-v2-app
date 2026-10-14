/**
 * The complete P0 pipeline as one pure function (used by the CLI, the tests and
 * the browser harness, so all three exercise identical code):
 *   extract catalog → migrate → rebuild v1 from v2 and compare bytes →
 *   finalise migration log → rule audit → audit report.
 */
import { extractCatalog, parseBackup } from "../legacy/extract.js";
import { auditLegacyRules } from "../legacy/ruleAuditor.js";
import { buildAuditReport, formulasForRuleAudit } from "../legacy/audit.js";
import { migrateV1ToV2 } from "./v1ToV2.js";
import { verifyRoundTrip } from "./exportV1.js";
import { validateBundleInvariants } from "../storage/invariants.js";
export function runP0Pipeline(input) {
    const catalog = extractCatalog(input.html);
    const migration = migrateV1ToV2({ catalog, backupText: input.backupText, backupFileName: input.backupFileName, ranAt: input.ranAt, ownerDecisions: input.ownerDecisions ?? null });
    const roundTrip = verifyRoundTrip(migration.bundle, input.backupText, catalog.catalog);
    const log = migration.bundle.migrationLog;
    log.droppedFields = roundTrip.droppedFields;
    if (!roundTrip.backupByteExact || !roundTrip.catalogDeepEqual)
        log.outcome = 'failed';
    const invariantProblems = validateBundleInvariants(migration.bundle);
    if (invariantProblems.length)
        log.outcome = 'failed';
    const ruleAudit = auditLegacyRules(catalog.catalog, formulasForRuleAudit(migration));
    const audit = buildAuditReport(catalog, input.backupText, parseBackup(input.backupText), migration);
    return { catalog, migration, roundTrip, invariantProblems, ruleAudit, audit };
}
