export class UploadService {
  async processUpload(buffer: Buffer, mimeType: string): Promise<{ key: string; url: string }> {
    return { key: '', url: '' };
  }
  async deleteUpload(key: string): Promise<void> {}
}
