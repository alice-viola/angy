export interface NotificationModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createNotification(data: Partial<NotificationModel>): NotificationModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as NotificationModel;
}
