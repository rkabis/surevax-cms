// apps/frontend/src/test-utils/msw-handlers.ts
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// Default handlers — override per-test via `server.use(http.post(...))`.
export const handlers = [
  // Sensible defaults; tests can override per-case.
  http.post('/api/auth/login', () =>
    HttpResponse.json({
      user: {
        id: 1,
        displayId: 'USR_AAAAAAA1',
        email: 'admin@surevax.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'TenantAdmin',
        tenantId: 'SVX',
        branchId: 1,
        branchCode: 'HST',
        isPlatformAdmin: false,
      },
      accessToken: 'mock-access-token',
    }),
  ),

  http.get('/api/auth/me', () =>
    HttpResponse.json({
      user: {
        id: 1,
        displayId: 'USR_AAAAAAA1',
        firstName: 'Admin',
        lastName: 'User',
        role: 'TenantAdmin',
        tenantId: 'SVX',
        branchId: 1,
        branchCode: 'HST',
        isPlatformAdmin: false,
        email: 'admin@surevax.com',
      },
    }),
  ),

  http.get('/api/patients', () => HttpResponse.json([])),
]

export const server = setupServer(...handlers)
