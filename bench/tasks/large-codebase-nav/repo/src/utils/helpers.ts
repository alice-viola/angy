export function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
