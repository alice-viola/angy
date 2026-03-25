export class UproductsRepository {
  async query(sql: string, params: unknown[]): Promise<unknown[]> { return []; }
  async findOne(id: string): Promise<unknown | null> { return null; }
  async insert(data: unknown): Promise<unknown> { return data; }
}
