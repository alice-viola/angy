export interface PaymentModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createPayment(data: Partial<PaymentModel>): PaymentModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as PaymentModel;
}
