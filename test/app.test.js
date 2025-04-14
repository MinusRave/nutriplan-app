const request = require('supertest');
const app = require('../app');

describe('App Endpoints', () => {
  test('GET / should return the home page', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  test('GET /api/conversation/state should return a valid response', async () => {
    const res = await request(app).get('/api/conversation/state');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('exists');
  });
});