export interface CartModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createCart(data: Partial<CartModel>): CartModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as CartModel;
}
