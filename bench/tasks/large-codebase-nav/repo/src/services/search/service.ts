export class SearchService {
  async search(query: string, index: string): Promise<unknown[]> { return []; }
  async suggest(prefix: string): Promise<string[]> { return []; }
}
