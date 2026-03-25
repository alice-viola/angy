export interface UproductsEntity {
  id: string;
  createdAt: Date;
}
export type UproductsCreateInput = Omit<UproductsEntity, 'id' | 'createdAt'>;
