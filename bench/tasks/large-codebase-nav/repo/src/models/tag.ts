export interface TagModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createTag(data: Partial<TagModel>): TagModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as TagModel;
}
