export class UnotificationsService {
  async findAll(): Promise<unknown[]> { return []; }
  async findById(id: string): Promise<unknown | null> { return null; }
  async create(data: unknown): Promise<unknown> { return data; }
  async update(id: string, data: unknown): Promise<unknown> { return data; }
  async delete(id: string): Promise<void> {}
}
