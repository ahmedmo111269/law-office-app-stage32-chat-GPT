/**
 * Convert a user-entered decimal amount to integer minor currency units.
 * Never store a binary floating-point amount in a financial record.
 * Arabic-Indic digits and the Arabic decimal/thousands separators are accepted.
 */
export function parseMoneyMinor(value, { emptyValue = null } = {}) {
  if (value == null || String(value).trim() === '') return emptyValue;
  const s = String(value).trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[,٬]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) {
    throw new Error('المبلغ يجب أن يكون غير سالب وبحد أقصى منزلتين عشريتين.');
  }
  const [whole, fraction = ''] = s.split('.');
  const minor = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(minor)) throw new Error('المبلغ يتجاوز الحد الآمن للأرقام الصحيحة.');
  return minor;
}
