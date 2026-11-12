/**
 * payments_verifier — factory + public exports.
 *
 * getVerifier() returns the active adapter. In dev the stub returns
 * null from verifyPayment and accepts every webhook signature; the
 * factory will REFUSE to hand out the stub when NODE_ENV=production
 * unless an explicit `PAYMENT_VERIFIER` override names it. The webhook
 * route catches the resulting error and replies 503 — production
 * deploys without a real adapter are fail-closed (C1 from the
 * 2026-05-23 360 codebase review).
 */
export type { PaymentVerifier, PaymentMethod, ReconciliationStatus } from './interface.js'
export { initialReconciliationStatus } from './interface.js'
export { StubPaymentVerifier } from './stub.js'
export { paymentWebhooksRouter } from './routes.js'

import type { PaymentVerifier } from './interface.js'
import { StubPaymentVerifier } from './stub.js'

let _verifier: PaymentVerifier | null = null

/**
 * Returns the singleton verifier instance.
 * Constructs on first call; subsequent calls return the cached instance.
 *
 * Throws `PAYMENT_VERIFIER_NOT_CONFIGURED` if NODE_ENV=production and no
 * explicit adapter has been wired (the stub accepts any webhook
 * signature — handing it out in production would be a critical auth bypass).
 */
export function getVerifier(): PaymentVerifier {
  if (_verifier) return _verifier

  const adapter = process.env['PAYMENT_VERIFIER'] ?? 'stub'
  const isProd = process.env['NODE_ENV'] === 'production'

  if (adapter === 'stub' && isProd) {
    const err = new Error(
      'PAYMENT_VERIFIER_NOT_CONFIGURED: stub adapter refused in production. Set PAYMENT_VERIFIER=paymongo (or another real adapter) before enabling payment webhooks.',
    )
    ;(err as Error & { code?: string }).code = 'PAYMENT_VERIFIER_NOT_CONFIGURED'
    throw err
  }

  // Only stub is wired today — when the real PayMongo adapter lands,
  // branch on `adapter === 'paymongo'` here and construct it.
  _verifier = new StubPaymentVerifier()
  return _verifier
}
