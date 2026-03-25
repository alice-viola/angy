export class MessageQueue {
  async publish(topic: string, message: unknown): Promise<void> {}
  async subscribe(topic: string, handler: (msg: unknown) => void): Promise<void> {}
}
