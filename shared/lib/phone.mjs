/**
 * Normalize a Brazilian phone number to digits with country code.
 *
 * Strips non-digits, prepends "55" if missing. Returns null if the result
 * is not a plausible Brazilian phone (12 or 13 digits: 55 + DDD + 8/9 digits).
 *
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeBrPhone(input) {
  if (typeof input !== "string") return null;
  let digits = input.replace(/\D/g, "");
  if (!digits) return null;
  if (!digits.startsWith("55")) digits = "55" + digits;
  if (digits.length !== 12 && digits.length !== 13) return null;
  return digits;
}
