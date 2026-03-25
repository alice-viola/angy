export interface UnotificationsEntity {
  id: string;
  createdAt: Date;
}
export type UnotificationsCreateInput = Omit<UnotificationsEntity, 'id' | 'createdAt'>;
