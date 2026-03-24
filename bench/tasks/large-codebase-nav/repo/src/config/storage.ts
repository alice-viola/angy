export interface StorageConfig { bucket: string; region: string; }
export function getStorageConfig(): StorageConfig {
  return { bucket: 'uploads', region: 'us-east-1' };
}
