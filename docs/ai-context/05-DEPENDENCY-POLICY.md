# 05 — Dependency Policy

> **Last Synthesized**: 2026-03-22 | **Self-contained** — synthesized from now-archived source docs

## Golden Rule

- **Every dependency is a liability** — add only when benefit clearly outweighs cost.

---

## The 5-Question Test

**ALL five must pass** before adding a package:

| #     | Question                                     | **Pass** =                                                                                |
| ----- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **1** | **Can we build this ourselves in < 1 week?** | **NO** (if **YES** → **build in-house**, do not add)                                      |
| **2** | **Is it actively maintained?**               | Last commit **< 3 months**, **10+** contributors, **company-backed** preferred            |
| **3** | **Does it have > 1M weekly downloads?**      | **YES** — popularity = more eyes on bugs (exceptions: trusted teams, niche essentials)    |
| **4** | **Can we replace it in < 1 week?**           | **YES** — prefer **low-risk**, swappable deps                                             |
| **5** | **Does it fit our consistency patterns?**    | **TypeScript**, **React hooks**, **existing conventions** (Tailwind, REST, Drizzle, etc.) |

**Exception to Question 1 (strict)**: **NEVER** build security, cryptography, session management, or core authentication utilities in-house, even if build time is **< 1 hour**. Always use standard, audited libraries (e.g., **bcrypt**, **helmet**, trusted auth/session packages).

---

## Approved Dependencies

| **Category**  | **Package**              | **Version** | **Justification**              |
| ------------- | ------------------------ | ----------- | ------------------------------ |
| **Core**      | `react`, `react-dom`     | ^19.0.0     | Framework                      |
| **Core**      | `typescript`             | ^5.0.0      | Type safety                    |
| **Core**      | `vite`                   | ^6.0.0      | Build tool                     |
| **Data**      | `@tanstack/react-query`  | ^5.0.0      | Caching is hard                |
| **Data**      | `zod`                    | ^3.0.0      | Validation everywhere          |
| **Data**      | `drizzle-orm`            | ^0.29.0     | Type-safe SQL                  |
| **Forms**     | `react-hook-form`        | ^7.0.0      | Forms are painful              |
| **Routing**   | `react-router-dom`       | ^6.0.0      | Industry standard              |
| **Backend**   | `express`                | ^5.1.0      | Battle-tested                  |
| **Backend**   | `jsonwebtoken`           | ^9.0.0      | Auth standard                  |
| **Backend**   | `bcrypt`                 | ^5.0.0      | Password hashing               |
| **Backend**   | `pino`                   | ^8.0.0      | Fast structured logging        |
| **Utilities** | `date-fns`               | ^3.0.0      | Date handling                  |
| **UI**        | `tailwindcss`            | ^3.0.0      | Utility-first CSS              |
| **UI**        | **shadcn/ui** components | latest      | Accessible headless components |
| **Security**  | `cors`                   | ^2.8.5      | CORS handling                  |
| **Security**  | `helmet`                 | ^7.0.0      | Security headers               |

---

## Banned Dependencies

| **Package**           | **Reason**                             |
| --------------------- | -------------------------------------- |
| `create-react-app`    | Deprecated — use **Vite**              |
| `moment.js`           | Effectively dead — use **date-fns**    |
| `lodash`              | Prefer **native JS**                   |
| `axios`               | Prefer **native `fetch`**              |
| `redux`               | Use **Context API** / **React Query**  |
| `nest.js`             | Use **Express** (simpler, AI-friendly) |
| `firebase`, `amplify` | **Vendor lock-in**                     |
| `styled-components`   | **Tailwind** is the styling layer      |
| `prisma`, `typeorm`   | **Drizzle** is the ORM                 |

---

## Abstraction Inversion Rule

**CRITICAL**: **Never wrap framework-level dependencies** — this is **Abstraction Inversion** (anti-pattern).

### Do **NOT** wrap

- **React Query** / **TanStack Query**
- **React Hook Form**
- **React Router**
- **Shadcn/ui** (and similar headless UI)

**Why**: Breaks **TypeScript inference**, cuts off **DevTools** / ecosystem, forces constant proxy updates, **does not** simplify real migration.

### **DO** wrap (thin adapters)

- **HTTP** — **`fetch`** (or a small internal client)
- **Logging** — **pino**
- **Analytics** — e.g. **PostHog**
- **Payments** — **Stripe**
- **Email** — **SendGrid** / **Resend**

**AI Import Directive**: When using wrapped infrastructure (logging, HTTP clients, analytics, etc.), AI code **MUST** import only from internal shared-library paths (for example, `import { logger } from '@surevax/shared/utils'`) and **MUST NEVER** import directly from the underlying `node_modules` package in feature code.

**Why**: Simple interfaces, real swap need, wrappers stay thin.

### Examples

**BAD** — wrapping React Query:

```tsx
// ❌ BAD: Wrapping React Query
export function useQuery(options) {
  return useTanStackQuery(options)
}
// Breaks types, cuts off DevTools, useless
```

**GOOD** — wrapping infrastructure:

```tsx
// ✅ GOOD: Wrapping infrastructure
import { logger } from '@surevax/shared/utils'
export function log(message: string, data?: any) {
  logger.info({ data }, message)
}
// Feature code imports the wrapper, not the underlying package
```

---

## Audit Schedule

| **Cadence**   | **Actions**                                                              |
| ------------- | ------------------------------------------------------------------------ |
| **Monthly**   | `npm outdated`, `npm audit`, `npx depcheck`                              |
| **Quarterly** | Deep review: each dep’s **GitHub** activity, **alternatives** assessment |

**Targets**: **< 20** total production deps (policy-aligned), **< 500kb** gzipped client bundle, **0** critical vulnerabilities.

---

## Dependency Invariants

- **No new dep** without **5-Question Test** — **all** pass.
- **Prefer boring, stable** packages; **build** trivial utilities **in-house**.
- **Drizzle** for ORM; **no** Prisma / TypeORM for new work.
- **Express** for API; **no** Nest for this codebase.
- **Tailwind** + **shadcn/ui**; **no** styled-components / parallel CSS-in-JS stacks.
- **fetch** over axios; **date-fns** over Moment.
- **Do not** abstract **React Query**, **RHF**, **Router**, **Shadcn** — **do** abstract **infra** (HTTP wrapper, logger, analytics, payments, email).
- **Audit monthly**, **deep-review quarterly**; track **count**, **bundle size**, **CVEs**.
