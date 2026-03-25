export interface WishlistModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
export function createWishlist(data: Partial<WishlistModel>): WishlistModel {
  return { id: '', createdAt: new Date(), updatedAt: new Date(), ...data } as WishlistModel;
}
