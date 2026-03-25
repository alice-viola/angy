/**
 * Truncates a string to the given max length, appending '...' if truncated.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str; // BUG: crashes if str is null/undefined
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Capitalizes the first letter of a string.
 */
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Converts a string to kebab-case.
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}
