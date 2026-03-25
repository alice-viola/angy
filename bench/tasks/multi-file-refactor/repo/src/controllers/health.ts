export function healthCheck(): { status: number; body: { ok: boolean; uptime: number } } {
  return {
    status: 200,
    body: { ok: true, uptime: process.uptime() },
  };
}
