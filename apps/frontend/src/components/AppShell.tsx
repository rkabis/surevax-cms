import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { clinicCalendarDateString } from '@/lib/clinicDate'
import { ErrorBoundary } from '@/components/layout'
import { ConnectivityBanner } from '@/components/layout/ConnectivityBanner'
import {
  LayoutDashboard,
  Users,
  Wallet,
  CalendarClock,
  ReceiptText,
  Package,
  FlaskConical,
  Syringe,
  LogOut,
  Stethoscope,
  Shield,
  ClipboardCheck,
  Clock,
  ScrollText,
  TimerOff,
  Workflow,
  Building2,
  Calendar,
  AlertTriangle,
  FileText,
  PackageX,
  Bell,
  Menu,
  Keyboard,
  UserPlus,
  Search,
  Settings,
  ChevronDown,
  Mail,
  CalendarCheck,
  ArrowRightLeft,
  ArrowLeftRight,
  Fingerprint,
  ClipboardList,
  Bug,
  ListChecks,
  BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/context'
import { useShift } from '@/features/shift/context'
import { useClockOut } from '@/features/shift/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Toaster, toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command'
import { Fragment, useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import ClockInModal from '@/features/shift/components/ClockInModal'
import ClockInBanner from '@/features/shift/components/ClockInBanner'
import { BranchDayBanner } from '@/features/branch/components/BranchDayBanner'
import { useCurrentDrawer } from '@/features/branch/api'
import { useTransactions } from '@/features/transactions/api'
import { usePatientSearch } from '@/features/patients/api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SHORTCUTS, type Shortcut } from '@/lib/shortcuts'
import { ADMIN_ROLES, BILLING_ROLES, REVIEW_CENTER_ROLES } from '@/lib/roles'

const SHORTCUTS_BY_GROUP: Array<[Shortcut['group'], Shortcut[]]> = (() => {
  const acc = new Map<Shortcut['group'], Shortcut[]>()
  for (const s of SHORTCUTS) {
    const list = acc.get(s.group) ?? []
    list.push(s)
    acc.set(s.group, list)
  }
  return Array.from(acc.entries())
})()

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  roles?: ReadonlySet<string>
}

interface NavGroup {
  id: string
  label: string
  adminOnly?: boolean
  items: NavItem[]
}

// Three collapsible groups. Pages hidden until backend ships (Settings and
// Cold Chain) are reachable by URL but absent from nav.
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'today',
    label: 'Today',
    items: [
      { to: '/today', icon: LayoutDashboard, label: 'Today' },
      { to: '/dashboard', icon: CalendarCheck, label: 'Dashboard' },
      { to: '/arrivals', icon: UserPlus, label: 'New Arrival' },
      { to: '/scheduled-orders', icon: CalendarClock, label: 'Scheduled Orders' },
      { to: '/encounters', icon: Stethoscope, label: 'Encounters' },
      { to: '/appointments', icon: Calendar, label: 'Appointments' },
      { to: '/day-summary', icon: CalendarCheck, label: 'Day Summary' },
      {
        to: '/review-center',
        icon: ListChecks,
        label: 'Review Center',
        roles: REVIEW_CENTER_ROLES,
      },
      { to: '/branch/kiosk', icon: Fingerprint, label: 'Staff Kiosk' },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    items: [
      { to: '/patients', icon: Users, label: 'Patients' },
      { to: '/lab-orders', icon: FlaskConical, label: 'Lab Orders' },
      { to: '/clinical-orders', icon: ClipboardList, label: 'Clinical Orders' },
      { to: '/bite-incidents', icon: Bug, label: 'Bite Incidents' },
      { to: '/adverse-events', icon: AlertTriangle, label: 'Adverse Events' },
      { to: '/transactions', icon: ReceiptText, label: 'Transactions' },
      { to: '/group-bills', icon: Building2, label: 'Group Bills', roles: BILLING_ROLES },
      { to: '/receivables', icon: Wallet, label: 'Receivables' },
      { to: '/reports', icon: BarChart3, label: 'Reports' },
      { to: '/inventory', icon: Package, label: 'Inventory' },
      // Sits with Inventory, not under Administration: the branch receiving a
      // physical shipment is the one that has to confirm it, and the Branch
      // account is the only login a clinic uses.
      { to: '/inventory-transfers', icon: ArrowRightLeft, label: 'Inv. Transfers' },
      { to: '/services', icon: Syringe, label: 'Services' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    adminOnly: true,
    items: [
      { to: '/admin/branches', icon: Building2, label: 'Branches' },
      { to: '/admin/users', icon: Shield, label: 'Users' },
      { to: '/admin/approvals', icon: ClipboardCheck, label: 'Approvals' },
      { to: '/admin/attendance', icon: Clock, label: 'Attendance' },
      { to: '/admin/audit', icon: ScrollText, label: 'Audit Log' },
      { to: '/admin/partner-labs', icon: FlaskConical, label: 'Partner Labs' },
      { to: '/admin/payer-profiles', icon: Building2, label: 'Payer Profiles' },
      { to: '/admin/standing-orders', icon: Workflow, label: 'Standing Orders' },
      // Was reachable only by typing the URL: a working page with pause/resume
      // mutations and zero entry points anywhere in the app.
      { to: '/admin/patient-standing-orders', icon: CalendarClock, label: 'Patient Schedules' },
      { to: '/admin/claims', icon: FileText, label: 'Claims' },
      { to: '/admin/product-recalls', icon: PackageX, label: 'Product Recalls' },
      { to: '/admin/notifications', icon: Bell, label: 'Notifications' },
      { to: '/admin/notification-templates', icon: Mail, label: 'Templates' },
      { to: '/admin/cross-branch-access', icon: ArrowLeftRight, label: 'Cross-Branch' },
    ],
  },
]

const ROUTE_LABELS: Record<string, string> = {
  '/receivables': 'Receivables',
  '/today': 'Today',
  '/dashboard': 'Dashboard',
  '/arrivals': 'New Arrival',
  '/arrivals/identify': 'Identify',
  '/arrivals/encounter': 'Encounter',
  '/arrivals/protocol': 'Protocol',
  '/arrivals/done': 'Done',
  '/encounters': 'Encounters',
  '/patients': 'Patients',
  '/patients/new': 'Register patient',
  '/scheduled-orders': 'Scheduled Orders',
  '/day-summary': 'Day Summary',
  '/review-center': 'Review Center',
  '/services': 'Services',
  '/transactions': 'Transactions',
  '/transactions/new': 'New Transaction',
  '/group-bills': 'Group Bills',
  '/group-bills/new': 'New Group Bill',
  '/inventory': 'Inventory',
  '/lab-orders': 'Lab Orders',
  '/initiate-protocol': 'Initiate Protocol',
  '/branch': 'Branch',
  '/branch/kiosk': 'Staff Kiosk',
  '/admin': 'Administration',
  '/admin/branches': 'Branches',
  '/admin/users': 'Users',
  '/admin/approvals': 'Approvals',
  '/admin/attendance': 'Attendance',
  '/admin/audit': 'Audit Log',
  '/admin/partner-labs': 'Partner Labs',
  '/admin/payer-profiles': 'Payer Profiles',
  '/admin/standing-orders': 'Standing Orders',
  '/admin/patient-standing-orders': 'Patient Schedules',
  '/admin/claims': 'Claims',
  '/admin/product-recalls': 'Product Recalls',
  '/admin/notifications': 'Notifications',
  '/admin/notification-templates': 'Notification Templates',
  '/admin/cross-branch-access': 'Cross-Branch Access',
  '/appointments': 'Appointments',
  '/adverse-events': 'Adverse Events',
  '/inventory-transfers': 'Inventory Transfers',
  '/clinical-orders': 'Clinical Orders',
  '/bite-incidents': 'Bite Incidents',
  '/cold-chain': 'Cold Chain',
  '/reports': 'Reports',
  '/settings': 'Settings',
}

interface Crumb {
  to: string
  label: string
}

/**
 * Display IDs (PAT_K9MX3VQ2, TXN_M3WPK7VR, MRN-000042, SVX.HST) are opaque
 * handles, not labels. Before 2026-07-25 they fell through to the
 * capitalise-the-segment fallback, so the breadcrumb read
 * "Patients / PAT_K9MX3VQ2" — the ID is already shown on the record itself,
 * and in the trail it is noise the operator has to decode.
 */
const DISPLAY_ID_SEGMENT = /^(?:[A-Z]{3,4}[_.][A-Z0-9.]{2,}|MRN-\d+|\d+)$/

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean)
  const crumbs: Crumb[] = []
  let acc = ''
  for (const seg of segments) {
    acc += `/${seg}`
    const mapped = ROUTE_LABELS[acc]
    if (!mapped && DISPLAY_ID_SEGMENT.test(seg)) {
      // Collapse the record segment into a generic leaf. Keeps the trail
      // navigable ("Patients / Record") without printing the raw handle.
      crumbs.push({ to: acc, label: 'Record' })
      continue
    }
    crumbs.push({ to: acc, label: mapped ?? seg.charAt(0).toUpperCase() + seg.slice(1) })
  }
  return crumbs
}

function ShortcutKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 text-2xs font-medium text-muted-foreground">
      {children}
    </kbd>
  )
}

function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press <ShortcutKey>?</ShortcutKey> any time to reopen this dialog.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {SHORTCUTS_BY_GROUP.map(([group, items]) => (
            <div key={group} className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </p>
              <ul className="flex flex-col gap-1.5">
                {items.map((s) => (
                  <li
                    key={s.description}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span className="text-foreground">{s.description}</span>
                    <span className="flex items-center gap-1">
                      {s.keys.map((k, i) => (
                        <Fragment key={`${s.description}-${i}`}>
                          {i > 0 && <span className="text-muted-foreground">+</span>}
                          <ShortcutKey>{k}</ShortcutKey>
                        </Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const NAV_OPEN_STORAGE_KEY = 'sv.navOpenGroups'

function readPersistedOpen(): Record<string, boolean> | null {
  try {
    const raw = localStorage.getItem(NAV_OPEN_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Record<string, boolean>
  } catch {
    return null
  }
}

function defaultOpenState(): Record<string, boolean> {
  return { today: true, records: true, admin: false }
}

interface NavGroupBlockProps {
  group: NavGroup
  open: boolean
  onToggle: () => void
  pathname: string
  onItemClick?: () => void
}

function NavGroupBlock({ group, open, onToggle, pathname, onItemClick }: NavGroupBlockProps) {
  const containsActive = group.items.some(
    (it) => pathname === it.to || pathname.startsWith(`${it.to}/`),
  )
  const expanded = open || containsActive

  const linkClasses = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-3 h-9 rounded-md px-3 xl:px-3.5 text-sm font-medium transition-colors',
      'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
      isActive &&
        'bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0.1875rem_0_0_0_hsl(var(--sidebar-primary))]',
    )
  const iconClasses = (isActive: boolean) =>
    cn('h-4 w-4 shrink-0', isActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/50')

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`nav-group-${group.id}`}
        className="flex items-center justify-between px-4 pt-3 pb-1 text-2xs font-medium uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring rounded-sm"
      >
        <span>{group.label}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-150',
            expanded ? 'rotate-0' : '-rotate-90',
          )}
          aria-hidden
        />
      </button>
      {expanded && (
        <div id={`nav-group-${group.id}`} className="flex flex-col gap-0.5 px-2 pb-2">
          {group.items.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onItemClick}
              aria-label={label}
              className={linkClasses}
            >
              {({ isActive }) => (
                <>
                  <Icon className={iconClasses(isActive)} aria-hidden />
                  <span className="truncate">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  // ⌘K live patient search — reuses the lightweight /api/patients?q= lookup
  // (same hook as registration dedupe). Fires at ≥2 chars while the
  // palette is open; results render above page navigation.
  const [commandQuery, setCommandQuery] = useState('')
  const { data: patientHits } = usePatientSearch(commandQuery, commandOpen)

  const { activeShift } = useShift()
  const clockOut = useClockOut()

  const isBranch = user?.role === 'Branch'
  const today = clinicCalendarDateString()

  // Branch-only: drawer state for day-close warning
  const { data: drawerForLogout } = useCurrentDrawer({ enabled: isBranch })
  const drawerIsOpen = isBranch && drawerForLogout?.state === 'Open'

  // Branch-only: unsettled transactions today for day-close warning
  const { data: txData } = useTransactions({
    date: today,
    status: 'Pending',
    enabled: isBranch,
  })
  const unsettledCount = isBranch ? (txData?.data?.length ?? 0) : 0

  const [signOutWarningOpen, setSignOutWarningOpen] = useState(false)

  // Defensive: `firstName`/`lastName` may be missing if a future auth payload
  // drops them (or if the user object is the bare JWT payload). Falling back
  // to '?' keeps the whole shell from crashing on reload.
  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || '?'
    : '?'

  const isAdmin = ADMIN_ROLES.has(user?.role ?? '')
  const crumbs = useMemo(() => buildCrumbs(location.pathname), [location.pathname])

  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS.filter((group) => !group.adminOnly || isAdmin)
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !item.roles || item.roles.has(user?.role ?? '')),
        }))
        .filter((group) => group.items.length > 0),
    [isAdmin, user?.role],
  )

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => readPersistedOpen() ?? defaultOpenState(),
  )

  useEffect(() => {
    try {
      localStorage.setItem(NAV_OPEN_STORAGE_KEY, JSON.stringify(openGroups))
    } catch {
      // localStorage unavailable; ignore
    }
  }, [openGroups])

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '?') {
        const target = e.target as HTMLElement | null
        if (!target) return
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable)
          return
        e.preventDefault()
        setShortcutsOpen((v) => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function handleEndShift() {
    try {
      await clockOut.mutateAsync({})
    } catch (err) {
      // Was `// swallow`: the shift silently stayed open, so staff believed
      // they had clocked out and attendance disagreed.
      toast.error('Could not end your shift', {
        description: apiErrorMessage(err),
      })
    }
  }

  async function handleLogout() {
    // Branch role: warn if drawer open or unsettled transactions exist
    if (isBranch && (drawerIsOpen || unsettledCount > 0)) {
      setSignOutWarningOpen(true)
      return
    }
    await doLogout()
  }

  async function doLogout() {
    if (activeShift) {
      if (!confirm('You have an active shift. Signing out will clock you out. Continue?')) return
      try {
        await clockOut.mutateAsync({})
      } catch (err) {
        // Still log out — never trap someone in a session — but say so, since
        // an unrecorded clock-out is an attendance/payroll discrepancy the
        // operator needs to raise.
        toast.error('Signed out, but your clock-out was not recorded', {
          description: apiErrorMessage(err),
        })
      }
    }
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Skip nav */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 bg-primary text-primary-foreground px-3 py-1.5 rounded text-sm"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar — dark ink surface driven by the --sidebar-* tokens
          (PATTERNS.md Pattern 19). Content area stays light; the dark rail
          anchors wayfinding on the 27" front-desk display. */}
      <nav
        aria-label="Main navigation"
        className="hidden md:flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0 transition-all duration-200 w-56 xl:w-64 2xl:w-72 print:hidden"
      >
        {/* Brand */}
        <div className="flex items-center gap-3 h-14 px-4 border-b border-sidebar-border shrink-0">
          <div className="flex items-center justify-center w-7 h-7 rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-2xs font-bold shrink-0">
            SV
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold tracking-tight truncate">SureVax</span>
            <span className="text-2xs text-sidebar-foreground/60 truncate">
              {user?.branchCode ?? '—'}
            </span>
          </div>
        </div>

        {/* Collapsible groups */}
        <div className="flex-1 flex flex-col py-1 overflow-y-auto">
          {visibleGroups.map((g) => (
            <NavGroupBlock
              key={g.id}
              group={g}
              open={!!openGroups[g.id]}
              onToggle={() => toggleGroup(g.id)}
              pathname={location.pathname}
            />
          ))}
        </div>

        {/* Session card */}
        <div className="mx-2 mb-2 mt-auto shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`User menu — ${user?.firstName} ${user?.lastName}`}
                className="w-full flex items-center gap-3 p-3 xl:p-3.5 border border-sidebar-border rounded-lg hover:bg-sidebar-accent/60 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-medium truncate text-sidebar-foreground">
                    {user?.firstName} {user?.lastName}
                  </span>
                  <span className="text-2xs text-sidebar-foreground/60 truncate">
                    {user?.role}
                    {user?.branchCode ? ` · ${user.branchCode}` : ''}
                  </span>
                </div>
                <LogOut className="h-3.5 w-3.5 text-sidebar-foreground/50 shrink-0" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-52">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-muted-foreground">{user?.role}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setShortcutsOpen(true)} className="cursor-pointer">
                <Keyboard className="mr-2 h-4 w-4" aria-hidden />
                Keyboard shortcuts
              </DropdownMenuItem>
              {activeShift && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={handleEndShift}
                    disabled={clockOut.isPending}
                    className="cursor-pointer"
                  >
                    <TimerOff className="mr-2 h-4 w-4" aria-hidden />
                    End Shift
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleLogout}
                className="text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" aria-hidden />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-64 p-0 bg-sidebar text-sidebar-foreground border-sidebar-border"
        >
          <SheetHeader className="h-14 px-4 border-b border-sidebar-border flex-row items-center gap-3 space-y-0">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-2xs font-bold">
              SV
            </div>
            <SheetTitle className="text-sm font-semibold text-sidebar-foreground">
              SureVax
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-col flex-1 overflow-y-auto py-1">
            {visibleGroups.map((g) => (
              <NavGroupBlock
                key={g.id}
                group={g}
                open={!!openGroups[g.id]}
                onToggle={() => toggleGroup(g.id)}
                pathname={location.pathname}
                onItemClick={() => setMobileOpen(false)}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <main id="main-content" className="flex-1 overflow-hidden flex flex-col min-w-0">
        {/* Topbar — white card surface so it reads as chrome above the
            faintly tinted page canvas */}
        <div className="flex items-center gap-3 h-12 bg-card border-b border-border px-4 shrink-0 print:hidden">
          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
            aria-label="Open navigation menu"
          >
            <Menu className="h-4 w-4" aria-hidden />
          </button>

          {/* Breadcrumbs */}
          <Breadcrumbs crumbs={crumbs} />

          <div className="flex-1" />

          {/* Ambient status chips — drawer + unsettled state always visible,
              click-to-act (Branch operator only; reuses the hooks already
              fetched for the sign-out warning, zero extra queries). */}
          {isBranch && drawerIsOpen && (
            <button
              onClick={() => navigate('/day-summary')}
              className="hidden lg:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-triage-ok/35 bg-triage-ok-soft text-triage-ok text-2xs font-mono font-medium hover:opacity-80 transition-opacity"
              aria-label="Cash drawer is open — go to day summary"
            >
              <span className="dot" data-severity="ok" />
              Drawer open
            </button>
          )}
          {isBranch && unsettledCount > 0 && (
            <button
              onClick={() => navigate('/transactions?status=Pending')}
              className="hidden lg:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-triage-due/40 bg-triage-due-soft text-triage-due text-2xs font-mono font-medium hover:opacity-80 transition-opacity"
              aria-label={`${unsettledCount} unsettled transactions — open pending list`}
            >
              <span className="dot" data-severity="due" />
              {unsettledCount} unsettled
            </button>
          )}

          {/* Search */}
          <button
            onClick={() => setCommandOpen(true)}
            className="hidden sm:flex items-center gap-2 h-8 w-64 xl:w-80 px-3 border border-input rounded-md bg-background text-muted-foreground text-xs hover:border-primary/40 transition-colors"
          >
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="flex-1 text-left truncate">Search patients, pages, actions…</span>
            <kbd className="text-2xs font-mono px-1.5 py-0.5 rounded bg-muted border">⌘K</kbd>
          </button>

          {/* Notification bell — admin only (target page is admin-gated) */}
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label="Notifications"
              onClick={() => navigate('/admin/notifications')}
            >
              <Bell className="h-4 w-4" aria-hidden />
            </Button>
          )}

          {/* Settings — admin only */}
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label="Settings"
              onClick={() => navigate('/settings')}
            >
              <Settings className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>

        <BranchDayBanner />
        <ClockInBanner />
        <ConnectivityBanner />
        {/*
          Cap page content at 1536px (max-w-screen-2xl), relaxed to
          1800px (max-w-shell, tailwind.config.ts) at the 2xl breakpoint
          so the 27" front-desk display (2560×1440) isn't 30% dead
          margin. The topbar above stays edge-to-edge intentionally —
          only the route content is constrained. Pages that need a
          different cap (Dashboard, demo surfaces) apply their own
          constraint inside. See PATTERNS.md Pattern 31.
        */}
        <div className="flex-1 overflow-hidden mx-auto w-full max-w-screen-2xl 2xl:max-w-shell">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      {/* Global modals */}
      <ClockInModal />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* Command palette */}
      <CommandDialog
        open={commandOpen}
        onOpenChange={(v) => {
          setCommandOpen(v)
          if (!v) setCommandQuery('')
        }}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <CommandInput
          placeholder="Search patients, pages, actions…"
          value={commandQuery}
          onValueChange={setCommandQuery}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {(patientHits?.data?.length ?? 0) > 0 && (
            <>
              <CommandGroup heading="Patients">
                {patientHits!.data.map((p) => (
                  <CommandItem
                    key={p.id}
                    // Include name + MRN + id in the cmdk filter value so
                    // fetched hits survive the client-side match pass.
                    value={`patient ${p.lastName} ${p.firstName} ${p.mrn ?? ''} ${p.id}`}
                    onSelect={() => {
                      navigate(`/patients/${p.id}`)
                      setCommandOpen(false)
                      setCommandQuery('')
                    }}
                  >
                    <Users className="h-4 w-4" aria-hidden />
                    <span className="truncate">
                      {p.lastName}, {p.firstName}
                    </span>
                    {p.mrn && (
                      <span className="ml-auto font-mono tabular-nums text-2xs text-muted-foreground">
                        {p.mrn}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
          {visibleGroups.map((g) => (
            <Fragment key={g.id}>
              <CommandGroup heading={g.label}>
                {g.items.map(({ to, icon: Icon, label }) => (
                  <CommandItem
                    key={to}
                    onSelect={() => {
                      navigate(to)
                      setCommandOpen(false)
                    }}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    <span>{label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </Fragment>
          ))}
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() => {
                navigate('/arrivals')
                setCommandOpen(false)
              }}
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              <span>New arrival</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                navigate('/transactions/new')
                setCommandOpen(false)
              }}
            >
              <ReceiptText className="h-4 w-4" aria-hidden />
              <span>New transaction</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setCommandOpen(false)
                setShortcutsOpen(true)
              }}
            >
              <Keyboard className="h-4 w-4" aria-hidden />
              <span>Keyboard shortcuts</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Branch day-close warning before logout */}
      <AlertDialog open={signOutWarningOpen} onOpenChange={setSignOutWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out without closing the day?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                {drawerIsOpen && (
                  <p>
                    Drawer is still open · opening float{' '}
                    {drawerForLogout?.openingFloat
                      ? `PHP ${parseFloat(drawerForLogout.openingFloat).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                      : '—'}
                  </p>
                )}
                {unsettledCount > 0 && (
                  <p>
                    {unsettledCount} unsettled transaction{unsettledCount !== 1 ? 's' : ''} today
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  Closing the drawer and reconciling the day before sign-out is recommended.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay signed in</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSignOutWarningOpen(false)
                void doLogout()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sign out anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* top-center keeps transient toasts clear of the bottom-right primary
          actions (cashier Tender rail, arrivals Commit rail). closeButton +
          finite duration guarantee dismissal even when a background tab
          throttles sonner's auto-dismiss timer. */}
      <Toaster richColors closeButton position="top-center" duration={4000} />
    </div>
  )
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1 text-sm text-muted-foreground">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <li key={c.to} className="flex items-center gap-1 min-w-0">
              {i > 0 && (
                <span className="text-muted-foreground/40 mx-0.5 shrink-0" aria-hidden>
                  /
                </span>
              )}
              {isLast ? (
                <span className="font-medium text-foreground truncate" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <NavLink to={c.to} className="hover:text-foreground transition-colors truncate">
                  {c.label}
                </NavLink>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
