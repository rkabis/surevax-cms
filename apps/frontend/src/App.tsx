import { lazy, Suspense } from 'react'
import { type RouteObject, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './features/auth/context'
import { ShiftProvider } from './features/shift/context'
import AppShell from '@/components/AppShell'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ADMIN_ROLES, BILLING_ROLES, REVIEW_CENTER_ROLES } from '@/lib/roles'

import { NotFoundPage } from './components/layout/NotFoundPage'

const LoginPage = lazy(() => import('./features/auth/components/LoginPage'))
const ArrivalsPage = lazy(() => import('./features/arrivals/ArrivalsPage'))
const Step1Identify = lazy(() => import('./features/arrivals/steps/Step1Identify'))
const Step2Encounter = lazy(() => import('./features/arrivals/steps/Step2Encounter'))
const Step3Protocol = lazy(() => import('./features/arrivals/steps/Step3Protocol'))
const StepDone = lazy(() => import('./features/arrivals/steps/StepDone'))
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'))
const EncountersPage = lazy(() => import('./features/encounters/EncountersPage'))
const EncounterNewPage = lazy(() => import('./features/encounters/EncounterNewPage'))
const VitalsDemoPage = lazy(() => import('./features/encounters/VitalsDemoPage'))
const TodayPage = lazy(() => import('./features/today/TodayPage'))
const PatientsPage = lazy(() => import('./features/patients/PatientsPage'))
const PatientRecordPage = lazy(() => import('./features/patients/PatientRecordPage'))
const PatientNewPage = lazy(() => import('./features/patients/PatientNewPage'))
const PatientEditPage = lazy(() => import('./features/patients/PatientEditPage'))
const PatientStatementPage = lazy(() => import('./features/patients/PatientStatementPage'))
const ScheduledOrdersPage = lazy(() => import('./features/scheduled-orders/ScheduledOrdersPage'))
const ServicesPage = lazy(() => import('./features/services/ServicesPage'))
const TransactionsPage = lazy(() => import('./features/transactions/TransactionsPage'))
const TransactionsCreatePage = lazy(() => import('./features/transactions/TransactionsCreatePage'))
const TransactionReceiptPage = lazy(() => import('./features/transactions/TransactionReceiptPage'))
const ReceivablesPage = lazy(() => import('./features/receivables/ReceivablesPage'))
const GroupBillsPage = lazy(() => import('./features/group-bills/GroupBillsPage'))
const GroupBillCreatePage = lazy(() => import('./features/group-bills/GroupBillCreatePage'))
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage'))
const LabOrdersPage = lazy(() => import('./features/lab-orders/LabOrdersPage'))

const BranchesPage = lazy(() => import('./features/admin/BranchesPage'))
const BranchDetailPage = lazy(() => import('./features/admin/BranchDetailPage'))
const UsersPage = lazy(() => import('./features/admin/UsersPage'))
const ApprovalsPage = lazy(() => import('./features/admin/ApprovalsPage'))
const AttendancePage = lazy(() => import('./features/admin/AttendancePage'))
const AuditPage = lazy(() => import('./features/admin/AuditPage'))
const PartnerLabsPage = lazy(() => import('./features/admin/PartnerLabsPage'))
const PayerProfilesPage = lazy(() => import('./features/admin/PayerProfilesPage'))
const StandingOrdersPage = lazy(() => import('./features/standing-orders/StandingOrdersPage'))
const InitiateProtocolPage = lazy(() => import('./features/standing-orders/InitiateProtocolPage'))
const PatientStandingOrdersAdminPage = lazy(
  () => import('./features/standing-orders/PatientStandingOrdersAdminPage'),
)
const BranchKiosk = lazy(() => import('./features/branch/components/BranchKiosk'))

const AppointmentsPage = lazy(() => import('./features/appointments/AppointmentsPage'))
const AdverseEventsPage = lazy(() => import('./features/adverse-events/AdverseEventsPage'))
const BiteIncidentsPage = lazy(() => import('./features/bite-incidents/BiteIncidentsPage'))
const InventoryTransfersPage = lazy(
  () => import('./features/inventory-transfers/InventoryTransfersPage'),
)
const ColdChainPage = lazy(() => import('./features/cold-chain/ColdChainPage'))
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'))
const ClaimsPage = lazy(() => import('./features/admin/ClaimsPage'))
const ClinicalOrdersPage = lazy(() => import('./features/clinical-orders/ClinicalOrdersPage'))
const ProductRecallsPage = lazy(() => import('./features/admin/ProductRecallsPage'))
const NotificationsPage = lazy(() => import('./features/admin/NotificationsPage'))
const NotificationTemplatesPage = lazy(() => import('./features/admin/NotificationTemplatesPage'))
const CrossBranchAccessPage = lazy(() => import('./features/admin/CrossBranchAccessPage'))
const DaySummaryPage = lazy(() => import('./features/day-summary/DaySummaryPage'))
const ReviewCenterPage = lazy(() => import('./features/review-center/ReviewCenterPage'))

// Dev-only demo routes (gated on import.meta.env.DEV — see route mounts below)
const BiteAssessmentDemo = lazy(() => import('./features/encounters/components/BiteAssessmentDemo'))

const OperatorLoginPage = lazy(() => import('./features/operator/OperatorLoginPage'))
const OperatorDashboardPage = lazy(() => import('./features/operator/OperatorDashboardPage'))
const OperatorTenantsPage = lazy(() => import('./features/operator/OperatorTenantsPage'))
const OperatorMfaEnrollPage = lazy(() => import('./features/operator/OperatorMfaEnrollPage'))

// Per-role landing page. Falls back to /dashboard if a role's preferred
// route hasn't been added yet (e.g. /arrivals lands in a separate PR).
const ROUTE_REGISTRY = new Set([
  '/today',
  '/dashboard',
  '/encounters',
  '/patients',
  '/scheduled-orders',
  '/services',
  '/transactions',
  '/transactions/new',
  '/transactions/:id/receipt',
  '/group-bills',
  '/group-bills/new',
  '/inventory',
  '/lab-orders',
  '/branch/kiosk',
  '/day-summary',
])

const ROLE_DEFAULT_PATH: Record<string, string> = {
  Nurse: '/arrivals',
}

export function defaultPathForRole(role: string | undefined): string {
  // The Today cockpit is home (workflow-first IA — PATTERNS.md Pattern 33).
  if (!role) return '/today'
  const preferred = ROLE_DEFAULT_PATH[role]
  if (preferred && ROUTE_REGISTRY.has(preferred)) return preferred
  return '/today'
}

/**
 * Root layout — provides AuthContext, TooltipProvider, and Suspense fallback
 * to the entire route tree. createBrowserRouter's RouterProvider renders this
 * component at the tree root.
 */
export function AppRoot() {
  return (
    <AuthProvider>
      {/* TooltipProvider at the root so ComingSoonButton + any ad-hoc <Tooltip>
          works without each call-site wrapping its own provider. AcronymHint
          still wraps internally; nesting providers is safe. */}
      <TooltipProvider delayDuration={200}>
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </TooltipProvider>
    </AuthProvider>
  )
}

/**
 * Shared pending state for lazy-route loading AND the auth bootstrap.
 *
 * The four route guards below used to `return null` while `/api/auth/me`
 * resolved, which rendered a blank white page on every hard refresh — read
 * as "the app is broken", not "one request is in flight". They render this
 * instead.
 */
function RouteFallback() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background"
      role="status"
      aria-live="polite"
    >
      <div
        className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin"
        aria-label="Loading"
      />
    </div>
  )
}

/**
 * Wrapper component for the index redirect so it can read auth state at
 * render time rather than at route-tree construction time (data router
 * builds the tree eagerly before any component renders).
 */
function RoleDefaultRedirect() {
  const { user } = useAuth()
  return <Navigate to={defaultPathForRole(user?.role)} replace />
}

/**
 * Wrapper for /login that redirects already-authenticated users to their
 * home route. Reads auth state at render time.
 */
function LoginOrRedirect() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <RouteFallback />
  if (user) return <Navigate to={defaultPathForRole(user.role)} replace />
  return <LoginPage />
}

// Layout element for the authenticated section. Renders <AppShell /> (which
// renders <Outlet />) for all matched children. Handles the auth redirect.
function RequireAuthLayout() {
  const { user, isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) return <RouteFallback />
  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />
  }
  return (
    <ShiftProvider>
      <AppShell />
    </ShiftProvider>
  )
}

// Layout element for admin-only routes. Falls through to <Outlet /> when
// authorized; redirects non-admins to their role default.
function RequireAdminLayout() {
  const { user, isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) return <RouteFallback />
  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />
  }
  // ADMIN_ROLES (@/lib/roles) accepts the legacy SuperAdmin value alongside
  // the canonical TenantAdmin, so existing `user_roles` rows still resolve
  // admin access. See .claude/rules/gotchas.md "SuperAdmin to TenantAdmin
  // rename".
  if (!ADMIN_ROLES.has(user.role)) {
    return <Navigate to={defaultPathForRole(user.role)} replace />
  }
  return <Outlet />
}

/** Route-level mirror of the group-bills backend gate, avoiding dead 403 pages. */
function RequireBillingLayout() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <RouteFallback />
  if (!user) return <Navigate to="/login" replace />
  if (!BILLING_ROLES.has(user.role)) return <Navigate to={defaultPathForRole(user.role)} replace />
  return <Outlet />
}

function RequireReviewCenterLayout() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <RouteFallback />
  if (!user || !REVIEW_CENTER_ROLES.has(user.role) || !user.branchId) {
    return <Navigate to={defaultPathForRole(user?.role)} replace />
  }
  return <Outlet />
}

// Layout element for operator routes.
function RequireOperatorLayout() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <RouteFallback />
  if (!user) return <Navigate to="/operator/login" replace />
  if (!user.isPlatformAdmin) return <Navigate to="/" replace />
  return <Outlet />
}

// RouteObject tree exported for createBrowserRouter in main.tsx.
// AppRoot (AuthProvider + TooltipProvider + Suspense) wraps the entire tree.
export const routes: RouteObject[] = [
  {
    element: <AppRoot />,
    children: [
      { path: '/login', element: <LoginOrRedirect /> },

      // Unlinked dev/demo route — VitalsPanel harness. Stripped from prod bundle.
      ...(import.meta.env.DEV ? [{ path: '/vitals-demo', element: <VitalsDemoPage /> }] : []),

      // Operator console — standalone layout, outside AppShell
      { path: '/operator/login', element: <OperatorLoginPage /> },
      {
        element: <RequireOperatorLayout />,
        children: [
          { path: '/operator', element: <OperatorDashboardPage /> },
          { path: '/operator/tenants', element: <OperatorTenantsPage /> },
          { path: '/operator/mfa/enroll', element: <OperatorMfaEnrollPage /> },
        ],
      },

      // Authenticated staff routes — AppShell layout
      {
        element: <RequireAuthLayout />,
        children: [
          { index: true, element: <RoleDefaultRedirect /> },

          // Today-group
          {
            path: '/arrivals',
            element: <ArrivalsPage />,
            children: [
              { index: true, element: <Navigate to="/arrivals/identify" replace /> },
              { path: 'identify', element: <Step1Identify /> },
              { path: 'encounter', element: <Step2Encounter /> },
              { path: 'protocol', element: <Step3Protocol /> },
              { path: 'done', element: <StepDone /> },
            ],
          },
          { path: '/today', element: <TodayPage /> },
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/day-summary', element: <DaySummaryPage /> },
          {
            element: <RequireReviewCenterLayout />,
            children: [{ path: '/review-center', element: <ReviewCenterPage /> }],
          },
          { path: '/encounters', element: <EncountersPage /> },
          { path: '/scheduled-orders', element: <ScheduledOrdersPage /> },
          { path: '/appointments', element: <AppointmentsPage /> },

          // Records-group — visible to all roles including Branch
          { path: '/patients', element: <PatientsPage /> },
          { path: '/patients/new', element: <PatientNewPage /> },
          { path: '/patients/:id', element: <PatientRecordPage /> },
          { path: '/patients/:id/edit', element: <PatientEditPage /> },
          { path: '/patients/:id/statement', element: <PatientStatementPage /> },
          { path: '/patients/:id/encounters/new', element: <EncounterNewPage /> },
          { path: '/services', element: <ServicesPage /> },
          { path: '/transactions/new', element: <TransactionsCreatePage /> },
          { path: '/transactions/:id/receipt', element: <TransactionReceiptPage /> },
          { path: '/transactions', element: <TransactionsPage /> },
          {
            element: <RequireBillingLayout />,
            children: [
              { path: '/group-bills', element: <GroupBillsPage /> },
              { path: '/group-bills/new', element: <GroupBillCreatePage /> },
            ],
          },
          { path: '/receivables', element: <ReceivablesPage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/inventory', element: <InventoryPage /> },
          { path: '/lab-orders', element: <LabOrdersPage /> },
          { path: '/clinical-orders', element: <ClinicalOrdersPage /> },
          // `/standing-orders` kept as redirect to /initiate-protocol so any
          // old links keep working; canonical name disambiguates from
          // /admin/standing-orders (the templates page).
          {
            path: '/standing-orders',
            element: <Navigate to="/initiate-protocol" replace />,
          },
          { path: '/initiate-protocol', element: <InitiateProtocolPage /> },
          // Deliberately OUTSIDE RequireAdminLayout: the Branch operator runs
          // patient schedules (pause/resume) — the backend mount allows
          // TenantAdmin/Physician/Branch; /admin/users stays admin-only.
          {
            path: '/admin/patient-standing-orders',
            element: <PatientStandingOrdersAdminPage />,
          },
          { path: '/branch/kiosk', element: <BranchKiosk /> },
          { path: '/adverse-events', element: <AdverseEventsPage /> },
          { path: '/bite-incidents', element: <BiteIncidentsPage /> },
          { path: '/inventory-transfers', element: <InventoryTransfersPage /> },
          { path: '/cold-chain', element: <ColdChainPage /> },

          // Dev-only fixture routes — stripped from prod bundle
          ...(import.meta.env.DEV
            ? [{ path: '/dev/bite-assessment', element: <BiteAssessmentDemo /> }]
            : []),

          // Admin-only routes
          {
            element: <RequireAdminLayout />,
            children: [
              { path: '/settings', element: <SettingsPage /> },
              { path: '/admin/branches', element: <BranchesPage /> },
              { path: '/admin/branches/:id', element: <BranchDetailPage /> },
              { path: '/admin/users', element: <UsersPage /> },
              { path: '/admin/approvals', element: <ApprovalsPage /> },
              { path: '/admin/attendance', element: <AttendancePage /> },
              { path: '/admin/audit', element: <AuditPage /> },
              { path: '/admin/partner-labs', element: <PartnerLabsPage /> },
              { path: '/admin/payer-profiles', element: <PayerProfilesPage /> },
              { path: '/admin/standing-orders', element: <StandingOrdersPage /> },
              { path: '/admin/claims', element: <ClaimsPage /> },
              { path: '/admin/product-recalls', element: <ProductRecallsPage /> },
              { path: '/admin/notifications', element: <NotificationsPage /> },
              {
                path: '/admin/notification-templates',
                element: <NotificationTemplatesPage />,
              },
              {
                path: '/admin/cross-branch-access',
                element: <CrossBranchAccessPage />,
              },
            ],
          },
        ],
      },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
