import 'dotenv/config'
// env validation must run before any other module reads process.env
import { env } from './shared/config/env.js'
// Sentry init must happen BEFORE the rest of the app boots so its
// instrumentation patches into express + http + console early. The init is
// a no-op when SENTRY_DSN isn't set, so local dev works without a project.
import * as Sentry from '@sentry/node'
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
  })
}
import express, { type Express } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { pinoHttp } from 'pino-http'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'
import { checkDatabaseReadiness } from './shared/db/readiness.js'
import { authMiddleware } from './shared/middleware/auth.js'
import { csrfMiddleware } from './shared/middleware/csrf.js'
import { tenantMiddleware } from './shared/middleware/tenant.js'
import { requireRole } from './shared/middleware/requireRole.js'
import { errorHandler } from './shared/middleware/error.js'
import { logger } from './shared/utils/logger.js'
import { adverseEventsRouter } from './modules/adverse_events/routes.js'
import { authRouter } from './modules/auth/routes.js'
import { operatorRouter } from './modules/auth/operatorRoutes.js'
import { operatorTenantsRouter } from './modules/operator/tenants.js'
import { patientsRouter } from './modules/patients/routes.js'
import { payerProfilesRouter } from './modules/payer_profiles/routes.js'
import { staffTimeLogsRouter } from './modules/staff_time_logs/routes.js'
import { dashboardRouter } from './modules/dashboard/routes.js'
import { daySummaryRouter } from './modules/day_summary/routes.js'
import { reviewCenterRouter } from './modules/review_center/routes.js'
import { reportsRouter } from './modules/reports/routes.js'
import { encountersRouter } from './modules/encounters/routes.js'
import { inventoryRouter } from './modules/inventory/routes.js'
import { labOrdersRouter } from './modules/lab_orders/routes.js'
import { partnerLabsRouter } from './modules/partner_laboratories/routes.js'
import { productRecallsRouter } from './modules/product_recalls/routes.js'
import { scheduledOrdersRouter } from './modules/scheduled_orders/routes.js'
import { servicesRouter } from './modules/service_catalog/routes.js'
import { doseCalcRouter } from './modules/dose_calc/routes.js'
import { shiftsRouter } from './modules/shifts/routes.js'
import {
  adminPatientStandingOrdersRouter,
  adminStandingOrderTemplatesRouter,
  patientStandingOrdersRouter,
  standingOrderTemplatesRouter,
  standingOrdersRouter,
} from './modules/standing_orders/routes.js'
import { transactionsRouter } from './modules/transactions/routes.js'
import { adminUsersRouter } from './modules/admin/users.js'
import { adminAttendanceRouter } from './modules/admin/attendance.js'
import { adminApprovalsRouter } from './modules/admin/approvals.js'
import { adminAuditRouter } from './modules/admin/audit.js'
import { adminClaimsRouter } from './modules/admin/claims.js'
import { adminBranchesRouter } from './modules/admin/branches.js'
import { adminNotificationTemplatesRouter } from './modules/admin/notificationTemplates.js'
import { adminPatientsCancelPendingRouter } from './modules/admin/patientsCancelPending.js'
import { adminDpaRouter } from './modules/admin/dpa.js'
import { adminCrossbranchRouter } from './modules/admin/crossBranchAccess.js'
import { auditRouter } from './modules/audit/routes.js'
import { branchRouter } from './modules/branch/routes.js'
import { cashDrawerRouter } from './modules/cash_drawer/routes.js'
import { arrivalsRouter } from './modules/arrivals/routes.js'
import { attachmentsRouter } from './modules/attachments/routes.js'
import { appointmentsRouter } from './modules/appointments/routes.js'
import { notificationsRouter } from './modules/notifications/routes.js'
import { phiAccessLogMiddleware } from './shared/middleware/phiAccessLog.js'
import { requestContextMiddleware } from './shared/middleware/requestContext.js'
import { fhirRouter } from './modules/fhir/routes.js'
import { placesRouter } from './modules/places/routes.js'
import { biteIncidentsRouter } from './modules/bite_incidents/routes.js'
import { inventoryTransfersRouter } from './modules/inventory_transfers/routes.js'
import { paymentWebhooksRouter } from './modules/payments_verifier/index.js'
import { healthCardsRouter } from './modules/health_cards/routes.js'
import { patientAccountsRouter, receivablesRouter } from './modules/patient_accounts/routes.js'
import { groupBillingRouter } from './modules/group_billing/routes.js'

const app: Express = express()

// Railway sits one proxy hop in front of the app. Trust it so that
// `req.ip`, `req.protocol`, and `X-Forwarded-For`-aware middleware
// (rate-limit, secure-cookie checks) see the real client values.
app.set('trust proxy', 1)

// ── Middleware stack (order is mandatory) ─────────────────────────────────────
// 1. Request logging + correlation ID. Mounted first so every downstream log and
//    audited transaction can share the same request context.
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existingId = req.headers['x-request-id']
      const headerId = Array.isArray(existingId) ? existingId[0] : existingId
      const requestId = headerId && headerId.length > 0 ? headerId : randomUUID()
      res.setHeader('X-Request-Id', requestId)
      return requestId
    },
    customProps: (req) => {
      const user = (req as typeof req & { user?: { displayId?: string; role?: string } }).user
      return {
        userId: user?.displayId,
        userRole: user?.role,
      }
    },
    autoLogging: {
      ignore: (req) => req.url === '/health',
    },
  }),
)
app.use(requestContextMiddleware)

// 2. Security headers — the API serves JSON only (frontend lives on Cloudflare
//    Pages at a different origin), so CSP can lock down everything. HSTS at
//    2 years + preload covers H4 from the 2026-05-23 360 review.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    hsts: {
      maxAge: 63072000, // 2 years
      includeSubDomains: true,
      preload: true,
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  }),
)

// 3. CORS — strict origin + credentials for HTTP-Only cookie auth.
//    Origin is validated by config/env.ts (no localhost in production).
//    M1: CORS_ORIGIN parsed as a comma-separated list so preview / custom
//    domains can be allow-listed without code changes. Wildcard `*` is
//    rejected at boot in production by env.ts.
const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean)
app.use(
  cors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
)

// 4. Rate limiting — global per-IP cap. Default 600/min (env.ts) accommodates a
//    multi-staff clinic behind one NAT IP + dashboard polling; still bounds
//    abuse. Credential endpoints keep their own tighter limiter in auth/routes.
app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  }),
)

// 5. Body + cookie parsing
app.use(express.json({ limit: '100kb' }))
app.use(cookieParser(env.COOKIE_SECRET))

// ── Liveness — mounted BEFORE auth/tenant middleware ─────────────────────────
// Railway sends GET /health from `healthcheck.railway.internal`. The tenant
// middleware would parse `healthcheck` as a slug, fail the DB lookup, and
// return 404 — failing the deploy healthcheck. The /health endpoint has no
// dependencies and is intentionally public; mounting it here bypasses CSRF,
// auth, and tenant resolution entirely.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Public readiness is mounted before auth/tenant resolution so Railway and
// external monitors can verify DB connectivity. The response is intentionally
// generic; detailed failures stay in PHI-safe server logs.
app.get('/ready', async (_req, res) => {
  const readiness = await checkDatabaseReadiness()
  if (readiness.ready) {
    res.json({ status: 'ready' })
    return
  }
  logger.error({ reason: readiness.reason }, 'readiness check failed')
  res.status(503).json({ status: 'not_ready' })
})

// Payment processor webhooks — mounted BEFORE csrfMiddleware and authMiddleware.
// Webhooks are server-to-server calls signed by the processor (PayMongo);
// they cannot send X-Requested-With or auth cookies. Signature verification
// inside the route handler is the equivalent guard.
app.use('/api/payments/webhooks', paymentWebhooksRouter)

// 6. CSRF — require custom header on state-changing requests so the browser
//    forces a CORS preflight (which the strict origin allow-list blocks for
//    any non-allowed origin). Mounted before auth so unauthenticated POSTs
//    (login) are also protected.
app.use(csrfMiddleware)

// 7. Auth — verifies access token cookie, attaches req.user (skips public routes)
app.use(authMiddleware)

// 8. Tenant — resolves tenant/branch context, attaches req.tenant
app.use(tenantMiddleware)

// 9. PHI access logging — runs after auth+tenant so req.user and req.tenant are
//    populated. Writes phi_access_log rows asynchronously on res.finish for
//    patient detail reads. Never blocks the response.
app.use(phiAccessLogMiddleware)

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/auth', authRouter)
// Platform operator login — separate from tenant auth; no tenant middleware required.
// This route is mounted AFTER authMiddleware + tenantMiddleware so the public-path
// bypass in authMiddleware covers /api/operator/login.
app.use('/api/operator', operatorRouter)
app.use('/api/operator/tenants', operatorTenantsRouter)
app.use('/api/patients', patientsRouter)
app.use('/api/patients', healthCardsRouter)
// Patient balance / ledger / pay-on-account. Sits under /api/patients so the
// phiAccessLog PATIENT_DETAIL matcher resolves the patient FK for these reads.
app.use('/api/patients', patientAccountsRouter)
// The clinic-wide roll-up must NOT live under /api/patients. See the comment on
// receivablesRouter for why that would silently skip PHI logging.
app.use('/api/accounts-receivable', receivablesRouter)
app.use('/api/payer-profiles', payerProfilesRouter)
app.use('/api/staff-time-logs', staffTimeLogsRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/day-summary', daySummaryRouter)
app.use(
  '/api/review-center',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  reviewCenterRouter,
)
app.use('/api/reports', reportsRouter)
app.use('/api/encounters', encountersRouter)
app.use('/api/inventory', inventoryRouter)
app.use(
  '/api/lab-orders',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  labOrdersRouter,
)
app.use(
  '/api/partner-labs',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  partnerLabsRouter,
)
app.use(
  '/api/scheduled-orders',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Cashier', 'Branch'),
  scheduledOrdersRouter,
)
// /api/services is intentionally ungated at the mount: the catalog is what
// backs the POS line-item picker, the administer brand picker and the arrivals
// wizard, so every clinical role needs GET. The write routes (POST / PATCH /
// PUT) carry their own requireRole('TenantAdmin','BranchAdmin') inside
// routes.ts. Gating the whole router here would 403 those pickers.
app.use('/api/services', servicesRouter)
// CLIN-1 — weight-based immunoglobulin dose preview (pure calc, no DB write).
app.use(
  '/api/dose-calc',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  doseCalcRouter,
)
app.use('/api/shifts', shiftsRouter)
app.use(
  '/api/cash-drawer',
  requireRole('TenantAdmin', 'BranchAdmin', 'Cashier', 'Branch'),
  cashDrawerRouter,
)
app.use('/api/standing-orders', standingOrdersRouter)
app.use('/api/standing-order-templates', standingOrderTemplatesRouter)
app.use('/api/patient-standing-orders', patientStandingOrdersRouter)
app.use('/api/transactions', transactionsRouter)
// Payer AR may be read/created/settled only by money-facing roles. In
// particular, Nurse and Physician are deliberately absent: clinical ordering
// does not authorize corporate receivable creation or collection.
app.use(
  '/api/group-bills',
  requireRole('TenantAdmin', 'BranchAdmin', 'Cashier', 'Branch'),
  groupBillingRouter,
)
app.use('/api/adverse-events', adverseEventsRouter)
app.use('/api/bite-incidents', biteIncidentsRouter)
app.use('/api/inventory-transfers', inventoryTransfersRouter)
app.use('/api/arrivals', arrivalsRouter)
app.use('/api/product-recalls', productRecallsRouter)
app.use('/api/attachments', attachmentsRouter)
app.use('/api/appointments', appointmentsRouter)
// Branch kiosk endpoints — staff roster + physician dropdown for the Branch
// session UI. Admins may also call these (with optional ?branchId=) for
// testing. Nurses are allowed too so the standing-orders form can pull
// the same physician list when a nurse is logged in directly.
app.use('/api/branch', requireRole('Branch', 'TenantAdmin', 'BranchAdmin', 'Nurse'), branchRouter)
// /api/audit is NOT admin-only at the mount, because print-event and
// export-event must fire from whichever role produced the receipt, statement
// or report, and that is almost always the Branch account. Gating the whole
// router to TenantAdmin/BranchAdmin 403'd every print and export call, which
// is why the DPA print/export trail was empty.
//
// READING the trail is a different question from writing your own entry to it,
// so `GET /recent` keeps its own admin-only gate inside routes.ts. Widening the
// mount is not licence to widen the read.
app.use(
  '/api/audit',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Cashier', 'Branch'),
  auditRouter,
)
// Admin-only endpoints — role gate enforces TenantAdmin/BranchAdmin only.
// authMiddleware (mounted globally above) guarantees req.user is present.
app.use('/api/admin/users', requireRole('TenantAdmin', 'BranchAdmin'), adminUsersRouter)
app.use('/api/admin/attendance', requireRole('TenantAdmin', 'BranchAdmin'), adminAttendanceRouter)
app.use('/api/admin/approvals', requireRole('TenantAdmin', 'BranchAdmin'), adminApprovalsRouter)
app.use('/api/admin/audit', requireRole('TenantAdmin', 'BranchAdmin'), adminAuditRouter)
app.use('/api/admin/claims', requireRole('TenantAdmin', 'BranchAdmin'), adminClaimsRouter)
app.use('/api/admin/branches', requireRole('TenantAdmin', 'BranchAdmin'), adminBranchesRouter)
app.use(
  '/api/admin/standing-order-templates',
  requireRole('TenantAdmin', 'BranchAdmin'),
  adminStandingOrderTemplatesRouter,
)
// Branch role is the comprehensive single-login-per-physical-location
// (cashier + clinical). Per the role posture (Wave 2.1, 2026-05-23): no
// per-user kiosk; the Branch login does intake + standing-order assign
// + transactions. Tenant + Branch admin handle user/branch/audit work.
app.use(
  '/api/admin/patient-standing-orders',
  requireRole('TenantAdmin', 'Physician', 'Branch'),
  adminPatientStandingOrdersRouter,
)
app.use('/api/admin/notifications', requireRole('TenantAdmin', 'BranchAdmin'), notificationsRouter)
app.use(
  '/api/admin/notification-templates',
  requireRole('TenantAdmin', 'BranchAdmin'),
  adminNotificationTemplatesRouter,
)
app.use('/api/admin/patients', requireRole('TenantAdmin'), adminPatientsCancelPendingRouter)
// DPA primary-store de-identification. Live execution consumes a short-lived
// two-TenantAdmin approval and never claims statutory deletion completion.
app.use('/api/admin/dpa', requireRole('TenantAdmin'), adminDpaRouter)
// Cross-branch access grants — retrospective compliance review list.
// Metadata reads (no clinical chart rows). Guarded TenantAdmin + BranchAdmin.
app.use(
  '/api/admin/cross-branch-access',
  requireRole('TenantAdmin', 'BranchAdmin'),
  adminCrossbranchRouter,
)

// FHIR R4 read-only projection endpoints.
// Restricted to clinical roles (Cashier excluded — no clinical need for FHIR data).
app.use('/api/places', placesRouter)
app.use('/api/fhir', requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse'), fhirRouter)

// Sentry's express error handler — captures any uncaught exception that
// reaches the express error pipeline. Mounted BEFORE the project's
// errorHandler so Sentry sees the raw error first. No-op when Sentry
// wasn't initialised (DSN missing).
if (env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app)
}

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(errorHandler)

export { app }
