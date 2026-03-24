export interface ApiRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}
