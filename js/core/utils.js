import { normalizeText } from './text.js';
export const nowISO=()=>new Date().toISOString();export const clone=value=>value==null?value:structuredClone(value);export { normalizeText } from "./text.js";export function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}export function debounce(fn,wait=250){let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),wait)}}export function isPlainObject(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Date)}

/**
 * Boolean flags are stored as 0/1 numbers because IndexedDB cannot index
 * `true`/`false` (a boolean is not a valid key). These helpers read the flag the
 * way the UI means it, and stay correct for legacy rows still holding booleans.
 */
export function isActive(row) {
  if (row == null) return true;
  if (row.active === undefined || row.active === null) return true;
  return Number(row.active) === 1;
}
export function isArchived(row) {
  return row != null && Number(row.archived) === 1;
}
export function isFlagOn(row, field) {
  return row != null && Number(row[field]) === 1;
}
/** Normalises a flag field to 0/1 (undefined keeps `defaultValue`). */
export function toFlag(value, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return value ? 1 : 0;
}
