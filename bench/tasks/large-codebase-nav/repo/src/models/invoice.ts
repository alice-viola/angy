export interface InvoiceModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createInvoice(data: Partial<InvoiceModel>): InvoiceModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as InvoiceModel;
}
