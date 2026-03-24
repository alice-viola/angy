export function listCategories(): Promise<{ id: string; name: string }[]> {
  return Promise.resolve([]);
}
export function createCategory(name: string, parentId?: string): Promise<{ id: string }> {
  return Promise.resolve({ id: '' });
}
