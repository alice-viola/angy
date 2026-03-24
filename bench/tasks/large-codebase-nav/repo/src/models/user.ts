export interface UserModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createUser(data: Partial<UserModel>): UserModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as UserModel;
}
