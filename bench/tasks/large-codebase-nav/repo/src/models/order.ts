export interface OrderModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createOrder(data: Partial<OrderModel>): OrderModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as OrderModel;
}
