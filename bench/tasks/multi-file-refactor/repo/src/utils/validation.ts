export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export function isValidId(id: string): boolean {
  return /^[a-f0-9-]{36}$/.test(id);
}
