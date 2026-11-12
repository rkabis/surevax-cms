import crypto from 'node:crypto'
import type { PaymentVerifier } from './interface.js'
import { env } from '../../shared/config/env.js'
import { logger } from '../../shared/utils/logger.js'

/**
 * Parse the Paymongo-Signature header into its components.
 *
 * Header format (documented at https://developers.paymongo.com/docs/webhooks):
 *   t=<unix-timestamp>,te=<test-env-signature>,li=<live-env-signature>
 *
 * The signed payload is: `<timestamp>.<rawBody>`
 * The signature is HMAC-SHA256 of that string keyed with the webhook secret.
 *
 * In test-mode webhooks only `te` is present; live webhooks carry `li`.
 * Both `te` and `li` may be present simultaneously — we accept either.
 */
function parsePaymongoSignature(header: string): {
  timestamp: string
  signatures: string[]
} | null {
  const parts = header.split(',')
  let timestamp: string | null = null
  const signatures: string[] = []

  for (const part of parts) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const key = part.slice(0, eqIdx).trim()
    const value = part.slice(eqIdx + 1).trim()
    if (key === 't') {
      timestamp = value
    } else if (key === 'te' || key === 'li') {
      if (value) signatures.push(value)
    }
  }

  if (!timestamp || signatures.length === 0) return null
  return { timestamp, signatures }
}

/**
 * Verify a PayMongo webhook signature.
 *
 * Algorithm (ref: https://developers.paymongo.com/docs/webhooks):
 *   1. Extract t=, te=/li= from Paymongo-Signature header.
 *   2. Compute signedPayload = `${timestamp}.${rawBody}`
 *   3. Compute HMAC-SHA256(signedPayload, webhookSecret)
 *   4. Timing-safe compare against each signature in the header.
 *
 * Returns true when at least one signature matches.
 * Returns false on malformed header, missing/mismatching signatures.
 */
export function verifyPaymongoSignature(rawBody: string, header: string, secret: string): boolean {
  const parsed = parsePaymongoSignature(header)
  if (!parsed) return false

  const signedPayload = `${parsed.timestamp}.${rawBody}`
  const computed = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex')
  const computedBuf = Buffer.from(computed, 'utf8')

  for (const sig of parsed.signatures) {
    // timingSafeEqual requires same-length buffers — pad/truncate to constant length.
    const sigBuf = Buffer.from(sig, 'utf8')
    if (sigBuf.length !== computedBuf.length) continue
    if (crypto.timingSafeEqual(computedBuf, sigBuf)) return true
  }
  return false
}

/**
 * Stub adapter. verifyPayment() is a no-op (returns null).
 *
 * verifyWebhookSignature() performs REAL signature verification when
 * PAYMONGO_WEBHOOK_SECRET is set in env. When the secret is absent (dev
 * only), it logs a prominent WARNING and passes through — this is the
 * intentional "accept all in dev" behaviour. In production the secret
 * should always be configured; the go-live check in getVerifier() ensures
 * the real adapter is wired, but belt-and-suspenders: if somehow the stub
 * is used in production without a secret the WARNING fires on every call.
 *
 * When the real PayMongo adapter is wired, swap getVerifier() in index.ts
 * to instantiate the real adapter instead of the stub.
 */
export class StubPaymentVerifier implements PaymentVerifier {
  async verifyPayment(): Promise<null> {
    return null
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    const secret = env.PAYMONGO_WEBHOOK_SECRET

    if (!secret) {
      // No secret configured — warn loudly and pass through. Acceptable in
      // development only; production deploys must set PAYMONGO_WEBHOOK_SECRET.
      logger.warn(
        'payments/webhooks: PAYMONGO_WEBHOOK_SECRET is not set — webhook signature verification SKIPPED. ' +
          'Set PAYMONGO_WEBHOOK_SECRET in production to enforce signature checks.',
      )
      return true
    }

    if (!signature) {
      logger.warn(
        'payments/webhooks: Paymongo-Signature header is missing — rejecting unsigned request.',
      )
      return false
    }

    const valid = verifyPaymongoSignature(rawBody, signature, secret)
    if (!valid) {
      logger.warn(
        { signatureHeader: signature },
        'payments/webhooks: HMAC signature mismatch — rejecting request.',
      )
    }
    return valid
  }
}
