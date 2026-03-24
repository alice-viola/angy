export interface UpaymentsEntity {
  id: string;
  createdAt: Date;
}
export type UpaymentsCreateInput = Omit<UpaymentsEntity, 'id' | 'createdAt'>;
