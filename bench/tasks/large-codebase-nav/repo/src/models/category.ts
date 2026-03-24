export interface CategoryModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createCategory(data: Partial<CategoryModel>): CategoryModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as CategoryModel;
}
