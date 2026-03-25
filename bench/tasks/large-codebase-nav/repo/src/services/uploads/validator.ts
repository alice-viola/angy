const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType);
}
export function isWithinSizeLimit(sizeBytes: number, maxMb: number = 10): boolean {
  return sizeBytes <= maxMb * 1024 * 1024;
}
