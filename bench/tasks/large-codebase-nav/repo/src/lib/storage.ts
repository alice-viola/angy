export class FileStorage {
  async upload(key: string, data: Buffer): Promise<string> { return key; }
  async download(key: string): Promise<Buffer> { return Buffer.alloc(0); }
  async delete(key: string): Promise<void> {}
}
