export interface UordersEntity {
  id: string;
  createdAt: Date;
}
export type UordersCreateInput = Omit<UordersEntity, 'id' | 'createdAt'>;
