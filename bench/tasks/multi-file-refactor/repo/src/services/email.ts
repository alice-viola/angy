export interface EmailOptions {
  to: string;
  subject: string;
  body: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  console.log(`Sending email to ${options.to}: ${options.subject}`);
  return true;
}
