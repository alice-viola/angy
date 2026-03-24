export class SearchIndexer {
  async indexDocument(index: string, id: string, doc: unknown): Promise<void> {}
  async removeDocument(index: string, id: string): Promise<void> {}
  async reindexAll(index: string): Promise<number> { return 0; }
}
