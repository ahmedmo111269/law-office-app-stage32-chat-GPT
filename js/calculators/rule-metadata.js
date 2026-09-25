import { repo } from '../db/repositories.js';
import { STORES } from '../core/constants.js';
import { nowISO } from '../core/utils.js';

export const REQUIRED_RULE_METADATA = Object.freeze([
  'ruleId', 'source', 'sourceReference', 'sourceUrl',
  'effectiveFrom', 'version', 'verificationDate'
]);

export function missingRuleMetadata(rule) {
  return REQUIRED_RULE_METADATA.filter(field => !String(rule?.[field] ?? '').trim());
}

export function requireRuleMetadata(rule) {
  const missing = missingRuleMetadata(rule);
  if (missing.length) throw new Error(`القاعدة القانونية ناقصة بيانات التوثيق: ${missing.join('، ')}.`);
  for (const field of ['effectiveFrom', 'verificationDate']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rule[field]))) {
      throw new Error(`تاريخ ${field} في القاعدة القانونية غير صالح.`);
    }
  }
  if (!/^https?:\/\//i.test(String(rule.sourceUrl))) {
    throw new Error('رابط مصدر القاعدة القانونية غير صالح.');
  }
  return rule;
}

/**
 * Preserve existing user edits. Only backfill missing metadata on known seeded
 * rules, retaining their historical verification date (not pretending that a
 * later app startup re-verified the legal source).
 */
export async function ensureRuleSet(rules) {
  const r = repo(STORES.legalRules);
  for (const rule of rules) {
    requireRuleMetadata(rule);
    // eslint-disable-next-line no-await-in-loop
    const match = await r.byIndex('ruleId', rule.ruleId, { limit: 1 });
    const existing = match.rows[0];
    if (!existing) {
      // eslint-disable-next-line no-await-in-loop
      await r.add({ ...rule, createdAt: nowISO() });
      continue;
    }
    const backfill = {};
    for (const field of REQUIRED_RULE_METADATA) {
      if (!String(existing[field] ?? '').trim()) backfill[field] = rule[field];
    }
    if (Object.keys(backfill).length) {
      // eslint-disable-next-line no-await-in-loop
      await r.put({ ...existing, ...backfill });
    }
  }
}
