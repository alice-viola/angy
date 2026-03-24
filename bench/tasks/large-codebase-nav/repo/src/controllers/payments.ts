export function initiatePayment(orderId: string, amount: number): Promise<{ paymentId: string }> {
  return Promise.resolve({ paymentId: '' });
}
export function confirmPayment(paymentId: string): Promise<boolean> {
  return Promise.resolve(false);
}
