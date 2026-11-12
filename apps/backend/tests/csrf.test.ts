import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { app } from '../src/app.js'

// CSRF middleware is the gate behind every state-changing request. It
// rejects any POST/PUT/PATCH/DELETE without `X-Requested-With: fetch`.
// GET requests are unrestricted.
describe('CSRF middleware', () => {
  it('rejects POST without X-Requested-With', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@surevax.com', password: 'TestPass123!' })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('CSRF_REQUIRED')
  })

  it('rejects POST with the wrong X-Requested-With value', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'admin@surevax.com', password: 'TestPass123!' })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('CSRF_REQUIRED')
  })

  it('lets GET requests through with no header', async () => {
    // /health is public — a clean way to confirm GETs aren't gated.
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('lets state-changing requests through when the header is present', async () => {
    // POST /login with the header should reach the login handler. Without
    // a body it'll fail validation (400) — the point is that we get past
    // the CSRF gate, not the eventual response code.
    const res = await request(app).post('/api/auth/login').set('X-Requested-With', 'fetch').send({})

    expect(res.body.code).not.toBe('CSRF_REQUIRED')
    expect(res.status).not.toBe(403)
  })
})
