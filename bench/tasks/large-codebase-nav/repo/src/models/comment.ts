export interface CommentModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createComment(data: Partial<CommentModel>): CommentModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as CommentModel;
}
