import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from './server.js';

describe('POST /api/users', () => {
  it('returns 201 with valid input', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'alice@example.com', age: 30 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Alice');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: 'bob@example.com', age: 25 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when name is empty string', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: '', email: 'bob@example.com', age: 25 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Bob', age: 25 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when email format is invalid', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Bob', email: 'not-an-email', age: 25 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when age is negative', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Bob', email: 'bob@example.com', age: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when age is greater than 150', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Bob', email: 'bob@example.com', age: 200 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when age is not a number', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Bob', email: 'bob@example.com', age: 'thirty' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/users', () => {
  it('returns array of users', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
