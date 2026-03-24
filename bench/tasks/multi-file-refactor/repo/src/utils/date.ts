export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function fromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

export function isExpired(expiresAt: number): boolean {
  return nowSeconds() > expiresAt;
}
