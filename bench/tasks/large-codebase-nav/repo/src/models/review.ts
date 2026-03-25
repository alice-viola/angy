export interface ReviewModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createReview(data: Partial<ReviewModel>): ReviewModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as ReviewModel;
}
