/**
 * Arabic-aware text normalisation and tokenisation.
 *
 * Used by the inverted search index so that a user typing "احمد" finds "أحمد",
 * "عبد الرحمن" finds "عبدالرحمن", and "١٢٣" finds "123".
 */

const HARAKAT = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

/** Folds the Arabic letter variants that users (and data entry) mix freely. */
export function normalizeArabic(input) {
  return String(input ?? '')
    .replace(HARAKAT, '')
    .replace(TATWEEL, '')
    .replace(/[آأإٱا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ئ/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(/[ڪک]/g, 'ك')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Lowercases, strips punctuation and collapses whitespace (Arabic aware). */
export function normalizeText(input) {
  return normalizeArabic(input)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const MIN_TOKEN = 1;
const MAX_TOKEN = 32;
const MAX_TOKENS_PER_RECORD = 80;

/** Splits normalised text into the tokens that go into the inverted index. */
export function tokenizeText(input) {
  const text = normalizeText(input);
  if (!text) return [];
  const out = [];
  for (const raw of text.split(' ')) {
    if (!raw) continue;
    if (raw.length < MIN_TOKEN || raw.length > MAX_TOKEN) continue;
    out.push(raw);
  }
  return out;
}

/** Normalises a search query into tokens (duplicates removed, order kept). */
export function tokenizeQuery(query, { maxTokens = 8 } = {}) {
  const seen = new Set();
  const tokens = [];
  for (const token of tokenizeText(query)) {
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= maxTokens) break;
  }
  return tokens;
}

/**
 * Fields that must never contribute tokens.
 *
 * Timestamps used to dominate the posting count (an ISO string tokenises into
 * ~9 tokens such as 2026 / 09 / 24 / 101z) while being useless for search, so
 * they are skipped: fewer postings means a proportionally faster rebuild and
 * smaller writes.
 */
const IGNORED_FIELDS = new Set(['uid', 'rev', 'deviceId', 'tokens', 'deletedAt']);
const TIMESTAMP_LIKE = /^\d{4}-\d{2}-\d{2}T/;
const SKIP_SUFFIX = /(?:^(?:created|updated|deleted))|At$/;

/**
 * Tokens for a whole record: every declared, meaningful field contributes.
 */
export function tokenizeRecord(record, declaredFields) {
  // Normalising field-by-field meant ~20 Intl-powered lower-cases per record;
  // joining first brings that down to one pass per record (~15x cheaper on the
  // index build path).
  const source = declaredFields && declaredFields.length
    ? declaredFields
    : Object.keys(record || {});
  let text = '';
  for (const field of source) {
    if (field === 'id' || IGNORED_FIELDS.has(field)) continue;
    if (SKIP_SUFFIX.test(field)) continue;
    const value = record?.[field];
    if (value == null || typeof value === 'object') continue;
    if (typeof value === 'string' && TIMESTAMP_LIKE.test(value)) continue;
    text += ' ' + value;
  }
  if (!text) return [];
  // Dedupe: a repeated token would violate the (store, token, recordId) primary
  // key when the index is rebuilt with `add`.
  const unique = [];
  const seen = new Set();
  for (const token of tokenizeText(text)) {
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
    if (unique.length >= MAX_TOKENS_PER_RECORD) break;
  }
  return unique;
}

/** Highlights nothing — kept as a single place to tune display normalisation. */
export function displaySnippet(value, maxLength = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
