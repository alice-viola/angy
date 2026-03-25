export interface ReportModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createReport(data: Partial<ReportModel>): ReportModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as ReportModel;
}
