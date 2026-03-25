export function createOrder(userId: string, items: unknown[]): Promise<{ orderId: string }> {
  return Promise.resolve({ orderId: '' });
}
export function getOrderStatus(orderId: string): Promise<string> {
  return Promise.resolve('pending');
}
