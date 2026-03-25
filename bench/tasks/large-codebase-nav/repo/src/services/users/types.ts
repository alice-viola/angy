export interface UusersEntity {
  id: string;
  createdAt: Date;
}
export type UusersCreateInput = Omit<UusersEntity, 'id' | 'createdAt'>;
