export interface SubscriptionModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createSubscription(data: Partial<SubscriptionModel>): SubscriptionModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as SubscriptionModel;
}
