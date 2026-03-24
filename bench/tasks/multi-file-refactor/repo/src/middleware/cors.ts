export interface CorsOptions {
  origins: string[];
  methods: string[];
}

export const defaultCorsOptions: CorsOptions = {
  origins: ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
};

export function getCorsHeaders(options: CorsOptions = defaultCorsOptions): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': options.origins.join(', '),
    'Access-Control-Allow-Methods': options.methods.join(', '),
  };
}
