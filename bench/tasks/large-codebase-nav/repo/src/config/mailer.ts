export interface MailerConfig { host: string; port: number; secure: boolean; }
export function getMailerConfig(): MailerConfig {
  return { host: 'smtp.example.com', port: 587, secure: true };
}
