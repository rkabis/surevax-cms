import { cleanup, within, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { render } from '@testing-library/react'
import LoginPage from '../components/LoginPage'
import { AuthProvider } from '../context'
import { http, HttpResponse } from 'msw'
import { server } from '@/test-utils/msw-handlers'

// Explicit cleanup so DOM doesn't bleed across tests in this file.
afterEach(() => cleanup())

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
}

function renderLoginPage() {
  const result = render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  // Return both the container (for querySelector) and a scoped `within` view.
  return { container: result.container, view: within(result.container) }
}

describe('LoginPage', () => {
  it('renders the email and password inputs', () => {
    const { container, view } = renderLoginPage()
    expect(view.getByRole('textbox', { name: /email/i })).toBeDefined()
    expect(container.querySelector('input[name="password"]')).not.toBeNull()
  })

  it('shows the primary submit button', () => {
    const { container } = renderLoginPage()
    const submitBtn = container.querySelector('button[type="submit"]')
    expect(submitBtn).not.toBeNull()
    expect(submitBtn?.textContent).toMatch(/sign in/i)
  })

  it('shows a server error when credentials are invalid', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ error: 'Incorrect email or password.' }, { status: 401 }),
      ),
    )

    const { container, view } = renderLoginPage()
    const user = userEvent.setup()

    await user.type(view.getByRole('textbox', { name: /email/i }), 'bad@example.com')
    await user.type(container.querySelector('input[name="password"]')!, 'wrongpassword')
    await user.click(container.querySelector('button[type="submit"]')!)

    await waitFor(() => {
      expect(view.getByRole('alert')).toBeDefined()
      expect(view.getByText(/incorrect email or password/i)).toBeDefined()
    })
  })

  it('calls the login API with the entered credentials', async () => {
    const requestBodies: unknown[] = []
    server.use(
      http.post('/api/auth/login', async ({ request }) => {
        requestBodies.push(await request.json())
        return HttpResponse.json({
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
        })
      }),
    )

    vi.stubGlobal('scrollTo', vi.fn())

    const { container, view } = renderLoginPage()
    const user = userEvent.setup()

    await user.type(view.getByRole('textbox', { name: /email/i }), 'admin@surevax.com')
    await user.type(container.querySelector('input[name="password"]')!, 'TestPass123!')
    await user.click(container.querySelector('button[type="submit"]')!)

    await waitFor(() => {
      expect(requestBodies).toHaveLength(1)
      expect(requestBodies[0]).toMatchObject({
        email: 'admin@surevax.com',
        password: 'TestPass123!',
      })
    })
  })
})
