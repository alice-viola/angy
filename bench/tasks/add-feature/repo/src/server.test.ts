import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, items } from './server.js';

// Reset items before each test
beforeEach(() => {
  items.length = 0;
  items.push({ id: 1, name: 'Item One' }, { id: 2, name: 'Item Two' });
});

describe('GET /api/items', () => {
  it('returns all items', async () => {
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

describe('GET /api/items/:id', () => {
  it('returns a single item', async () => {
    const res = await request(app).get('/api/items/1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Item One');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/items/999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/items', () => {
  it('creates a new item', async () => {
    const res = await request(app).post('/api/items').send({ name: 'Item Three' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Item Three');
    expect(res.body.id).toBeDefined();
  });

  it('returns 400 if name is missing', async () => {
    const res = await request(app).post('/api/items').send({});
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/items/:id', () => {
  it('updates an existing item', async () => {
    const res = await request(app).put('/api/items/1').send({ name: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).put('/api/items/999').send({ name: 'Nope' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/items/:id', () => {
  it.todo('DELETE /api/items/:id returns 200 and removes the item');
  it.todo('DELETE /api/items/:id returns 404 for unknown id');
});
