/**
 * Webhook endpoints for external payment processor callbacks.
 *
 * CSRF exemption: this router is mounted BEFORE csrfMiddleware in app.ts.
 * Webhooks are server-to-server calls signed by the processor (PayMongo),
 * not browser-originated requests, so the custom-header CSRF defence does
 * not apply. Signature verification via verifyWebhookSignature() is the
 * equivalent guard.
 *
 * Auth exemption: mounted before authMiddleware — PayMongo signs requests,
 * not individual users. DB writes use withPlatformTx (bypasses tenant RLS)
 * with targetTenantId resolved from the payment row so the audit trigger
 * receives a non-null app.current_tenant_id.
 */
import { Router, type Request, type Response, type Router as RouterType } from 'express'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { payments } from '../../shared/db/schema.js'
import { withPlatformTx } from '../../shared/db/withTenantTx.js'
import { auditLog } from '../../shared/utils/auditLog.js'
import { logger } from '../../shared/utils/logger.js'
import { getVerifier } from './index.js'

export const paymentWebhooksRouter: RouterType = Router()

// Platform operator user ID used for system-originated audit rows.
// Matches the seeded platform@surevax.com account (PLT-AAAAAAAAA1, id=1).
const PLATFORM_USER_ID = 1

/**
 * POST /api/payments/webhooks/paymongo
 *
 * Receives a PayMongo webhook event and updates the matching payment's
 * reconciliation status. The stub verifier accepts all events and returns
 * { ok: true, stub: true } since verifyPayment() is a no-op today.
 *
 * Uses express.raw() on this route only so the raw body is available for
 * HMAC signature verification. Do NOT apply express.json() here — that
 * would consume the stream and make rawBody unusable.
 */
paymentWebhooksRouter.post(
  '/paymongo',
  // Raw body for signature verification — applied per-route, not globally.
  (req, res, next) => {
    // If body was already parsed as Buffer (via express.raw applied upstream),
    // skip. Otherwise apply inline.
    if (Buffer.isBuffer(req.body)) return next()
    // express.raw middleware applied inline for this route.
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      req.body = Buffer.concat(chunks)
      next()
    })
    req.on('error', next)
  },
  async (req: Request, res: Response): Promise<void> => {
    // C1: getVerifier() throws PAYMENT_VERIFIER_NOT_CONFIGURED in production
    // when no real adapter is wired. Return 503 — fail closed.
    let verifier
    try {
      verifier = getVerifier()
    } catch (err) {
      const code = (err as Error & { code?: string }).code
      if (code === 'PAYMENT_VERIFIER_NOT_CONFIGURED') {
        logger.warn('payments/webhooks/paymongo: refused — verifier not configured')
        res.status(503).json({ error: 'Payment verifier not configured', code })
        return
      }
      throw err
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body)
    // PayMongo sends the canonical header name "Paymongo-Signature" (not "X-Paymongo-Signature").
    // Express lowercases incoming header names, so both lookup forms work; we prefer the
    // canonical casing for clarity. Ref: https://developers.paymongo.com/docs/webhooks
    const signature = req.header('paymongo-signature') ?? null

    // 1. Signature verification.
    //    When PAYMONGO_WEBHOOK_SECRET is set the verifier performs real HMAC-SHA256
    //    verification. When unset (dev) it logs a warning and passes through.
    if (!verifier.verifyWebhookSignature(rawBody, signature)) {
      res.status(401).json({ error: 'Invalid webhook signature', code: 'SIGNATURE_INVALID' })
      return
    }

    // 2. Parse event payload.
    let event: Record<string, unknown>
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      res.status(400).json({ error: 'Malformed JSON body', code: 'PARSE_ERROR' })
      return
    }

    // 3. Extract reference number from PayMongo payload shape.
    //    Real PayMongo events: { data: { id, attributes: { reference_number } } }
    const data = event.data as Record<string, unknown> | undefined
    const attributes = data?.attributes as Record<string, unknown> | undefined
    const externalRef =
      (attributes?.reference_number as string | undefined) ??
      (attributes?.reference as string | undefined) ??
      null

    // 4. Stub short-circuit — verifier.verifyPayment returns null (no real call).
    //    Return a stub acknowledgement without touching the DB.
    if (!externalRef) {
      logger.info({ event }, 'payments/webhooks/paymongo: no reference — stub ack')
      res.json({ ok: true, stub: true, reason: 'no_reference' })
      return
    }

    // 5. Find the payment row by referenceNumber (cross-tenant, platform tx).
    //    We need the tenantId to set the audit GUC before writing.
    //
    //    CONC-6 fix: referenceNumber is NOT a unique column — a naive LIMIT 1
    //    could reconcile the wrong payment and misattribute the audit row. To
    //    narrow deterministically we also filter on reconciliationStatus =
    //    'AwaitingReconciliation' (already-cleared/failed rows are ineligible)
    //    and order by id ASC (stable insertion order) so repeated webhook
    //    retries always pick the same row. If more than one row matches we
    //    log a warning and skip rather than silently picking an arbitrary one.
    const candidates = await withPlatformTx({ platformUserId: PLATFORM_USER_ID }, async (tx) => {
      return tx
        .select({
          id: payments.id,
          displayId: payments.displayId,
          tenantId: payments.tenantId,
          method: payments.method,
          amount: payments.amount,
          payerId: payments.payerId,
          reconciliationStatus: payments.reconciliationStatus,
        })
        .from(payments)
        .where(
          and(
            eq(payments.referenceNumber, externalRef),
            eq(payments.reconciliationStatus, 'AwaitingReconciliation'),
            // A voided payment is a corrected-and-replaced row; reconciling it
            // would settle money against a dead row instead of its replacement.
            isNull(payments.voidedAt),
          ),
        )
        .orderBy(asc(payments.id))
        .limit(2) // fetch 2 to detect ambiguity without loading the full table
    })

    if (candidates.length === 0) {
      logger.warn(
        { externalRef },
        'payments/webhooks/paymongo: no matching AwaitingReconciliation payment',
      )
      // Return 200 so PayMongo stops retrying for unknown refs.
      res.json({ ok: true, stub: true, reason: 'not_found' })
      return
    }

    if (candidates.length > 1) {
      // Multiple payments share this referenceNumber and are still awaiting
      // reconciliation. Reconciling the wrong row would misattribute the
      // audit entry. Log and skip — human intervention or a more-specific
      // re-delivery is required.
      logger.warn(
        { externalRef, paymentIds: candidates.map((p) => p.displayId) },
        'payments/webhooks/paymongo: ambiguous referenceNumber — multiple AwaitingReconciliation payments match; skipping to avoid misattribution',
      )
      res.json({ ok: true, stub: true, reason: 'ambiguous_reference' })
      return
    }

    const payment = candidates[0]!

    // 6. Call verifier — stub returns null (no-op). When real adapter lands,
    //    this will return { status, externalProcessorFee }.
    const result = await verifier.verifyPayment({
      method: payment.method as import('./interface.js').PaymentMethod,
      referenceNumber: externalRef,
      amount: payment.amount,
      payerId: payment.payerId,
    })

    if (!result) {
      // Stub path — nothing to update; just acknowledge.
      res.json({ ok: true, stub: true, reason: 'verifier_no_op' })
      return
    }

    // 7. Real result — update reconciliation status inside platform tx with
    //    targetTenantId so the audit trigger receives app.current_tenant_id.
    await withPlatformTx(
      { platformUserId: PLATFORM_USER_ID, targetTenantId: payment.tenantId },
      async (tx) => {
        await tx
          .update(payments)
          .set({
            reconciliationStatus: result.status,
            clearedAt: result.status === 'Cleared' ? new Date() : null,
            externalProcessorFee: result.externalProcessorFee ?? null,
            updatedAt: new Date(),
          })
          .where(eq(payments.id, payment.id))

        await auditLog(tx, {
          tenantId: payment.tenantId,
          userId: null, // system-originated (webhook)
          action: 'UPDATE',
          entityType: 'payments',
          entityId: payment.displayId,
          changes: {
            reconciliationStatus: {
              from: payment.reconciliationStatus,
              to: result.status,
            },
          },
          metadata: {
            source: 'paymongo_webhook',
            externalRef,
          },
        })
      },
    )

    logger.info(
      { paymentDisplayId: payment.displayId, status: result.status },
      'payments/webhooks/paymongo: reconciliation updated',
    )

    res.json({ ok: true })
  },
)
