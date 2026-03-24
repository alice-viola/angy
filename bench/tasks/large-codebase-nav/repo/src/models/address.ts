export interface AddressModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createAddress(data: Partial<AddressModel>): AddressModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as AddressModel;
}
