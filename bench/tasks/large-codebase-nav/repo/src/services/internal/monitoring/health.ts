export async function checkHealth(): Promise<{ status: string; uptime: number }> {
  return { status: 'ok', uptime: process.uptime() };
}
