import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../src/app.js'

describe('health and readiness', () => {
  it('keeps dependency-free liveness public', async () => {
    const response = await request(app).get('/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
  })

  it('makes database readiness public without tenant or auth headers', async () => {
    const response = await request(app).get('/ready')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ready' })
    expect(response.body).not.toHaveProperty('env')
    expect(response.body).not.toHaveProperty('error')
  })
})
