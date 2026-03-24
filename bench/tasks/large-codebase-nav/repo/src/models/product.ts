export interface ProductModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createProduct(data: Partial<ProductModel>): ProductModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as ProductModel;
}
