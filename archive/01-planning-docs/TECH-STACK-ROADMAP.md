# SureVax CMS Tech Stack Roadmap

**Current Situation**: Single clinic, multiple branches, <100 users
**Goal**: Ship fast with AI, maintain code quality, prepare for future SaaS

**Last Updated**: March 21, 2026

---

## 🎯 Executive Summary

This roadmap avoids the five most common technical debt traps in SaaS development:

1. **Multi-tenancy retrofit trap** → Build with `tenant_id` from Day 1 (hardcode in Phase 1)
2. **Application-level security vulnerability** → Use PostgreSQL Row Level Security (RLS) for automatic tenant isolation
3. **Monorepo build context issues** → Use pnpm workspaces, not sibling folders
4. **Missing audit trails** → Include `created_by`, `updated_by`, `updated_at` from Day 1
5. **Vercel commercial use violation** → Self-host frontend or use Cloudflare Pages

**Result**: Phase 1 → Phase 2 migration requires changing ~2% of code (not 10%), takes 2 hours (not 1 week), and has zero risk of cross-tenant data leaks.

---

## ⚠️ Critical Architecture Decisions (Read First)

### 1. Multi-Tenancy from Day 1

**Decision**: Include `tenant_id` in database schema from the start, even though Phase 1 is single-tenant.

**Why**: Retrofitting multi-tenancy into a live production database is one of the most painful migrations you can undertake. Adding `tenant_id` now costs zero engineering overhead (just hardcode a single tenant), but saves weeks of migration agony later.

**Implementation**: All core tables include `tenant_id`, but Phase 1 application code uses a hardcoded constant like `"main-clinic"`.

### 2. Database-Level Tenant Isolation (PostgreSQL RLS)

**Decision**: Use PostgreSQL Row Level Security (RLS) for tenant isolation, not just application-level filtering.

**Why**: In healthcare applications, relying on developers to remember `where: eq(patients.tenantId, req.tenant.id)` in every query is a massive security vulnerability. One forgotten filter = cross-tenant data leak. RLS enforces isolation at the database level automatically.

**Implementation**: Define RLS policies that automatically scope queries to the current tenant using session variables.

### 3. Proper Monorepo from Day 1

**Decision**: Use pnpm workspaces to manage `frontend/`, `backend/`, and `shared/` as a proper monorepo.

**Why**: A sibling `shared/` folder breaks in practice. TypeScript compilers and Docker build contexts struggle with `../shared` imports. A proper monorepo treats `shared` as a local package (`@surevax/shared`) that both frontend and backend can import cleanly.

**Implementation**: Initialize with `pnpm init` and configure workspaces in root `package.json`.

### 4. Audit Trails from Day 1

**Decision**: Include `created_at`, `updated_at`, `created_by`, and `updated_by` on all core entities.

**Why**: In healthcare settings, knowing who changed a patient's vaccination record and when is often a legal requirement. Adding these fields now takes minutes; backfilling them later is incredibly tedious.

**Implementation**: Add to Zod schemas and Drizzle models immediately.

### 5. Self-Hosted Frontend (Not Vercel Free Tier)

**Decision**: Host frontend on the same Hetzner VPS using Nginx, or use Cloudflare Pages.

**Why**: Vercel's Hobby tier explicitly forbids commercial use. If SureVax generates revenue or is used by a for-profit clinic, you risk having your frontend suspended without warning.

**Implementation**: Containerize Vite build with Nginx and serve from VPS, or deploy to Cloudflare Pages (free tier allows commercial use).

---

## Phase 1: NOW (Single Tenant, <100 Users)

**Timeline**: 0-6 months
**Goal**: Ship fast, validate product, maintain quality

### Architecture: Simple Monolith (Multi-Tenancy Ready)

```
┌─────────────────────────────────────────┐
│     Frontend (React SPA)                │
│     Deployed: Hetzner VPS (Nginx)       │
│     OR: Cloudflare Pages (free)         │
└─────────────────────────────────────────┘
                    ↓ REST API
┌─────────────────────────────────────────┐
│     Backend (Node.js/Express)           │
│     Deployed: Hetzner VPS €8.50/month   │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│     Database (PostgreSQL + RLS)         │
│     Same VPS (multi-tenant ready)       │
│     tenant_id in schema, RLS enabled    │
└─────────────────────────────────────────┘
```

**Total Cost**: ~$10/month (all on one VPS)

---

## Phase 1 Tech Stack (Ship Fast + AI-Friendly)

### Frontend (React)

```json
{
  "dependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "react-router-dom": "^6.0.0",
    "@tanstack/react-query": "^5.0.0",
    "react-hook-form": "^7.0.0",
    "zod": "^3.0.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.0.0",
    "tailwindcss": "^3.0.0",
    "@heroicons/react": "^2.0.0"
  }
}
```

**Why these choices:**

- ✅ AI (like me) knows these libraries extremely well
- ✅ Minimal dependencies (7 core packages)
- ✅ Easy to read and modify
- ✅ TypeScript = self-documenting code
- ✅ Zod schemas = single source of truth

### Backend (Node.js)

```json
{
  "dependencies": {
    "express": "^4.0.0",
    "drizzle-orm": "^0.29.0",
    "postgres": "^3.0.0",
    "zod": "^3.0.0",
    "jsonwebtoken": "^9.0.0",
    "bcrypt": "^5.0.0",
    "pino": "^8.0.0",
    "cors": "^2.8.5",
    "helmet": "^7.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "drizzle-kit": "^0.20.0",
    "tsx": "^4.0.0"
  }
}
```

**Why these choices:**

- ✅ Express = AI knows it perfectly
- ✅ Drizzle = Type-safe SQL, easy to read
- ✅ Standard patterns = AI can help debug
- ✅ Minimal abstraction = easy to understand

### Database Schema (Multi-Tenancy Ready from Day 1)

```sql
-- Multi-tenant schema with RLS
-- Phase 1: Use hardcoded tenant_id = 'main-clinic'
-- Phase 2: Enable multiple tenants without migration pain

-- Tenants table (even if only one tenant in Phase 1)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default tenant for Phase 1
INSERT INTO tenants (id, name, subdomain)
VALUES ('00000000-0000-0000-0000-000000000001', 'Main Clinic', 'main');

-- Users table with tenant_id and audit fields
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL, -- 'admin', 'doctor', 'nurse', 'staff'
  branch_id UUID REFERENCES branches(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  UNIQUE(tenant_id, email) -- Email unique per tenant
);

-- Enable RLS on users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own tenant's data
CREATE POLICY tenant_isolation_policy ON users
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Branches table with tenant_id and audit fields
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  address TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON branches
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Patients table with tenant_id and audit fields
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  birth_date DATE NOT NULL,
  branch_id UUID REFERENCES branches(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON patients
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Indexes for performance
CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_branches_tenant_id ON branches(tenant_id);
CREATE INDEX idx_patients_tenant_id ON patients(tenant_id);

-- Other tables: vaccinations, appointments, inventory, etc.
-- ALL follow the same pattern: tenant_id + audit fields + RLS
```

**Key Points:**

- ✅ `tenant_id` on all tables (future-proof)
- ✅ Row Level Security (automatic tenant isolation)
- ✅ Audit fields (`created_by`, `updated_by`, `updated_at`)
- ✅ Phase 1: Hardcode tenant_id = '00000000-0000-0000-0000-000000000001'
- ✅ Phase 2: Just add more tenants, no schema migration needed
- ✅ Security: Database enforces isolation, not application code

---

## Phase 1 Project Structure (Proper Monorepo)

```
surevax-cms/
├── package.json               # Root package.json with workspaces
├── pnpm-workspace.yaml        # pnpm workspace config
├── tsconfig.json              # Shared TypeScript config
├── docker-compose.yml
├── .env.example
│
├── packages/
│   └── shared/                # Shared package (@surevax/shared)
│       ├── package.json       # name: "@surevax/shared"
│       ├── tsconfig.json
│       └── src/
│           ├── schemas/       # Zod schemas
│           │   ├── patient.ts
│           │   ├── vaccination.ts
│           │   └── appointment.ts
│           ├── types/         # Shared TypeScript types
│           └── utils/         # Shared utilities
│
├── apps/
│   ├── frontend/
│   │   ├── package.json       # depends on "@surevax/shared"
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── features/      # Feature modules
│   │       │   ├── patients/
│   │       │   │   ├── api.ts
│   │       │   │   ├── hooks.ts
│   │       │   │   └── components/
│   │       │   ├── vaccinations/
│   │       │   ├── appointments/
│   │       │   └── inventory/
│   │       ├── shared/
│   │       │   ├── components/ # Reusable UI
│   │       │   └── lib/       # Frontend utilities
│   │       └── main.tsx
│   │
│   └── backend/
│       ├── package.json       # depends on "@surevax/shared"
│       ├── tsconfig.json
│       ├── Dockerfile
│       └── src/
│           ├── modules/       # Feature modules
│           │   ├── patients/
│           │   │   ├── routes.ts
│           │   │   ├── service.ts
│           │   │   └── db.ts
│           │   ├── vaccinations/
│           │   ├── appointments/
│           │   └── inventory/
│           ├── shared/
│           │   ├── db/        # Database setup + RLS
│           │   ├── middleware/ # Tenant middleware
│           │   └── utils/
│           └── index.ts
│
└── README.md
```

**Root package.json:**

```json
{
  "name": "surevax-cms",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "pnpm --parallel -r dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

**pnpm-workspace.yaml:**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**Why this structure:**

- ✅ Proper monorepo (not sibling folders)
- ✅ `@surevax/shared` is a real package
- ✅ TypeScript imports work cleanly
- ✅ Docker build contexts work correctly
- ✅ Easy to add more packages later
- ✅ AI can navigate and understand structure

---

## Phase 1 Development Workflow (AI-Assisted)

### 1. Define Schema First (Zod with Audit Fields)

```ts
// packages/shared/src/schemas/patient.ts
import { z } from 'zod'

// Base audit fields (included in all entities)
export const auditFieldsSchema = z.object({
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string().uuid().nullable(),
  updatedBy: z.string().uuid().nullable(),
})

export const patientSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    birthDate: z.date(),
    branchId: z.string().uuid(),
  })
  .merge(auditFieldsSchema)

export const createPatientSchema = patientSchema.omit({
  id: true,
  tenantId: true, // Injected by backend
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
})

export const updatePatientSchema = createPatientSchema.partial()

export type Patient = z.infer<typeof patientSchema>
export type CreatePatient = z.infer<typeof createPatientSchema>
export type UpdatePatient = z.infer<typeof updatePatientSchema>
```

**AI Benefit**: Schema includes audit fields from Day 1, AI can generate compliant forms/API/DB code

### 2. Generate Database Schema (Drizzle with RLS)

```ts
// apps/backend/src/shared/db/schema.ts
import { pgTable, uuid, varchar, date, timestamp } from 'drizzle-orm/pg-core'

// Tenants table
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  subdomain: varchar('subdomain', { length: 100 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// Patients table with tenant_id and audit fields
export const patients = pgTable('patients', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  firstName: varchar('first_name', { length: 255 }).notNull(),
  lastName: varchar('last_name', { length: 255 }).notNull(),
  birthDate: date('birth_date').notNull(),
  branchId: uuid('branch_id').references(() => branches.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdBy: uuid('created_by').references(() => users.id),
  updatedBy: uuid('updated_by').references(() => users.id),
})

// RLS is enabled via SQL migrations (see database-schema-v4.md)
```

**AI Benefit**: Type-safe queries with automatic tenant isolation via RLS

### 3. Create API Endpoint (Express with Tenant Context)

```ts
// apps/backend/src/modules/patients/routes.ts
import { Router } from 'express'
import { validate } from '../../shared/middleware/validate'
import { createPatientSchema } from '@surevax/shared/schemas/patient'
import { createPatient, getPatients } from './service'

const router = Router()

// Tenant middleware sets req.tenant and configures RLS
// No need to manually filter by tenant_id - RLS handles it!
router.get('/', async (req, res) => {
  // RLS automatically filters to current tenant
  const patients = await getPatients()
  res.json({ data: patients })
})

router.post('/', validate(createPatientSchema), async (req, res) => {
  // Service automatically injects tenant_id and user_id
  const patient = await createPatient(req.body, req.user.id)
  res.json({ data: patient })
})

export default router
```

**Tenant Middleware (sets RLS context):**

```ts
// apps/backend/src/shared/middleware/tenant.ts
import { Request, Response, NextFunction } from 'express'
import { db } from '../db'

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  // Phase 1: Hardcoded tenant
  const tenantId = '00000000-0000-0000-0000-000000000001'

  // Phase 2: Get from subdomain or JWT
  // const tenantId = req.user.tenantId

  // Set PostgreSQL session variable for RLS
  await db.execute(`SET LOCAL app.current_tenant_id = '${tenantId}'`)

  req.tenant = { id: tenantId }
  next()
}
```

**AI Benefit**: RLS eliminates manual tenant filtering, reducing security vulnerabilities

### 4. Create Frontend Hook (React Query)

```ts
// apps/frontend/src/features/patients/api.ts
import { useQuery, useMutation } from '@tanstack/react-query'
import { type CreatePatient } from '@surevax/shared/schemas/patient'

export function usePatients() {
  return useQuery({
    queryKey: ['patients'],
    queryFn: async () => {
      const res = await fetch('/api/patients')
      return res.json()
    },
  })
}

export function useCreatePatient() {
  return useMutation({
    mutationFn: async (data: CreatePatient) => {
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      return res.json()
    },
  })
}
```

**AI Benefit**: Imports from `@surevax/shared` work cleanly in monorepo

### 5. Create Form Component (React Hook Form)

```tsx
// apps/frontend/src/features/patients/components/PatientForm.tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createPatientSchema } from '@surevax/shared/schemas/patient'
import { useCreatePatient } from '../api'

export function PatientForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createPatientSchema),
  })

  const createPatient = useCreatePatient()

  const onSubmit = (data) => {
    createPatient.mutate(data)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('firstName')} placeholder="First Name" />
      {errors.firstName && <span>{errors.firstName.message}</span>}

      <input {...register('lastName')} placeholder="Last Name" />
      {errors.lastName && <span>{errors.lastName.message}</span>}

      <input type="date" {...register('birthDate')} />
      {errors.birthDate && <span>{errors.birthDate.message}</span>}

      <button type="submit">Create Patient</button>
    </form>
  )
}
```

**AI Benefit**: AI generates forms from shared schemas, no duplication

---

## Phase 1 Deployment (Self-Hosted)

### Option A: All-in-One VPS (Recommended for Phase 1)

**Frontend + Backend on Hetzner VPS (€8.50/month)**

```bash
# 1. Create VPS at hetzner.com
# Choose: CPX21 (3 vCPU, 4GB RAM, 80GB SSD)

# 2. SSH into server
ssh root@your-ip

# 3. Install Docker
curl -fsSL https://get.docker.com | sh

# 4. Clone repo
git clone https://github.com/your-org/surevax-cms.git
cd surevax-cms

# 5. Set up environment
cp .env.example .env
nano .env  # Edit with your values

# 6. Run with Docker Compose
docker-compose up -d

# 7. Set up domain and SSL
# Point DNS to VPS IP
certbot --nginx -d surevax.com -d api.surevax.com
```

### Option B: Cloudflare Pages + VPS

**Frontend: Cloudflare Pages (Free, Commercial Use Allowed)**

```bash
# 1. Push to GitHub
git push origin main

# 2. Connect to Cloudflare Pages
# - Go to Cloudflare Dashboard > Pages
# - Connect GitHub repo
# - Build command: cd apps/frontend && pnpm build
# - Output directory: apps/frontend/dist

# 3. Set environment variables
# VITE_API_URL=https://api.surevax.com

# Done! Auto-deploys on every push
```

**Backend: Hetzner VPS (€8.50/month)** (same as Option A)

---

### Docker Compose (All-in-One VPS)

```yaml
# docker-compose.yml
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: surevax
      POSTGRES_USER: surevax
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  api:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://surevax:${DB_PASSWORD}@db:5432/surevax
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      - db
    restart: unless-stopped

  frontend:
    build:
      context: .
      dockerfile: apps/frontend/Dockerfile
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - api
    restart: unless-stopped

volumes:
  postgres_data:
```

**Frontend Dockerfile (Nginx):**

```dockerfile
# apps/frontend/Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/frontend ./apps/frontend

RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @surevax/frontend build

FROM nginx:alpine
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Backend Dockerfile:**

```dockerfile
# apps/backend/Dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/backend ./apps/backend

RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile --prod
RUN pnpm --filter @surevax/backend build

WORKDIR /app/apps/backend
CMD ["node", "dist/index.js"]
```

**Total Setup Time**: 1-2 hours
**Total Cost**: ~$10/month (Option A) or ~$10/month (Option B)

---

## Phase 2: FUTURE (Multi-Tenant SaaS)

**Timeline**: 12-24 months
**Trigger**: When you decide to sell to other clinics

### What Changes: Enable Multiple Tenants

```
┌─────────────────────────────────────────┐
│     Frontend (React SPA)                │
│     Deployed: Cloudflare Pages or VPS   │
└─────────────────────────────────────────┘
                    ↓ REST API
┌─────────────────────────────────────────┐
│     Backend (Node.js/Express)           │
│     Deployed: Multiple VPS + LB         │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│     Database (PostgreSQL + RLS)         │
│     Multi-tenant (already has tenant_id)│
│     RLS enforces isolation              │
└─────────────────────────────────────────┘
```

**Total Cost**: ~$50-100/month (for 10+ tenants)

---

## Phase 2 Migration Path (Minimal Changes)

### Step 1: Enable Dynamic Tenant Selection

**No database migration needed!** Schema already has `tenant_id` and RLS.

**Update tenant middleware to read from JWT:**

```ts
// apps/backend/src/shared/middleware/tenant.ts
import { Request, Response, NextFunction } from 'express'
import { db } from '../db'

export async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  // Phase 1: Hardcoded tenant
  // const tenantId = '00000000-0000-0000-0000-000000000001'

  // Phase 2: Get from JWT or subdomain
  const subdomain = req.hostname.split('.')[0]
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.subdomain, subdomain),
  })

  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found' })
  }

  // Set PostgreSQL session variable for RLS
  await db.execute(`SET LOCAL app.current_tenant_id = '${tenant.id}'`)

  req.tenant = tenant
  next()
}
```

**That's it!** No query refactoring needed because RLS handles isolation.

### Step 2: Add Tenant Onboarding

```ts
// apps/backend/src/modules/tenants/service.ts
export async function createTenant(data: CreateTenantInput) {
  // 1. Create tenant
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: data.name,
      subdomain: data.subdomain,
    })
    .returning()

  // 2. Create default admin user
  const hashedPassword = await bcrypt.hash(data.adminPassword, 10)
  await db.insert(users).values({
    tenantId: tenant.id,
    email: data.adminEmail,
    passwordHash: hashedPassword,
    role: 'admin',
  })

  // 3. Create default branch
  await db.insert(branches).values({
    tenantId: tenant.id,
    name: 'Main Branch',
  })

  // 4. Send welcome email
  await sendEmail({
    to: data.adminEmail,
    subject: 'Welcome to SureVax',
    body: `Your clinic is ready at https://${data.subdomain}.surevax.com`,
  })

  return tenant
}
```

### Step 3: No Query Refactoring Needed!

**Before (Phase 1):**

```ts
const patients = await db.query.patients.findMany()
```

**After (Phase 2):**

```ts
// Same code! RLS automatically filters by tenant
const patients = await db.query.patients.findMany()
```

**Why this works**: PostgreSQL RLS policies automatically scope all queries to the current tenant based on the session variable set by the middleware. No manual filtering required.

**Security benefit**: Even if a developer forgets to filter by tenant, the database enforces isolation automatically.

### Step 4: Add Tenant Management UI

```tsx
// apps/frontend/src/features/admin/components/TenantList.tsx
export function TenantList() {
  const { data: tenants } = useTenants()

  return (
    <div>
      <h2>Tenants</h2>
      {tenants?.map((tenant) => (
        <div key={tenant.id}>
          <h3>{tenant.name}</h3>
          <p>Subdomain: {tenant.subdomain}.surevax.com</p>
          <p>Created: {format(tenant.createdAt, 'MMM dd, yyyy')}</p>
        </div>
      ))}
    </div>
  )
}
```

### Step 5: Add Tenant Isolation Tests

```ts
// apps/backend/src/modules/patients/patients.test.ts
import { describe, it, expect } from 'vitest'

describe('Patient API - Multi-tenancy', () => {
  it('should only return patients for current tenant (RLS enforced)', async () => {
    // Create two tenants
    const tenant1 = await createTenant({ name: 'Clinic A', subdomain: 'clinica' })
    const tenant2 = await createTenant({ name: 'Clinic B', subdomain: 'clinicb' })

    // Create patients for each tenant
    await createPatient({ firstName: 'Patient', lastName: 'A' }, tenant1.id)
    await createPatient({ firstName: 'Patient', lastName: 'B' }, tenant2.id)

    // Query as tenant1 (RLS automatically filters)
    const response = await request(app)
      .get('/api/patients')
      .set('host', 'clinica.surevax.com')
      .set('authorization', `Bearer ${tenant1Token}`)

    // Should only see tenant1's patients (RLS enforced)
    expect(response.body.data).toHaveLength(1)
    expect(response.body.data[0].lastName).toBe('A')
  })

  it('should prevent cross-tenant data access even with direct query', async () => {
    // Attempt to query with wrong tenant_id in WHERE clause
    // RLS will still enforce isolation
    const tenant1 = await createTenant({ name: 'Clinic A', subdomain: 'clinica' })
    const tenant2 = await createTenant({ name: 'Clinic B', subdomain: 'clinicb' })

    await createPatient({ firstName: 'Patient', lastName: 'B' }, tenant2.id)

    // Even if code tries to access tenant2's data while authenticated as tenant1
    // RLS will return empty results
    const result = await db.query.patients.findMany({
      where: eq(patients.tenantId, tenant2.id), // Trying to access tenant2
    })

    // RLS blocks this - returns empty
    expect(result).toHaveLength(0)
  })
})
```

---

## Phase 2 Additional Features

### 1. Billing Integration

```ts
// apps/backend/src/modules/billing/service.ts
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

export async function createSubscription(tenantId: string, plan: string) {
  const tenant = await getTenant(tenantId)

  // Create Stripe customer
  const customer = await stripe.customers.create({
    email: tenant.adminEmail,
    metadata: { tenantId },
  })

  // Create subscription
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: PLAN_PRICES[plan] }],
  })

  // Update tenant
  await db
    .update(tenants)
    .set({
      stripeCustomerId: customer.id,
      stripeSubscriptionId: subscription.id,
      plan,
    })
    .where(eq(tenants.id, tenantId))
}
```

### 2. Usage Tracking

```ts
// apps/backend/src/modules/analytics/service.ts
export async function trackUsage(tenantId: string, metric: string) {
  await db.insert(usage).values({
    tenantId,
    metric,
    value: 1,
    timestamp: new Date(),
  })
}

// Use in routes
router.post('/patients', async (req, res) => {
  const patient = await createPatient(req.body, req.user.id)

  // Track usage
  await trackUsage(req.tenant.id, 'patients_created')

  res.json({ data: patient })
})
```

---

## Migration Checklist

### Phase 1 → Phase 2 Migration (Minimal Changes)

**Preparation (1-2 days):**

- [ ] Write multi-tenancy tests
- [ ] Set up staging environment
- [ ] Test RLS policies with multiple tenants

**Migration (2 hours):**

- [ ] Update tenant middleware to read from subdomain/JWT
- [ ] Add tenant onboarding API endpoints
- [ ] Add tenant management UI
- [ ] Deploy new backend code
- [ ] Test tenant isolation
- [ ] Monitor for issues

**Post-Migration (1 week):**

- [ ] Monitor performance
- [ ] Verify RLS is working correctly
- [ ] Optimize queries if needed
- [ ] Update documentation

---

## Code Changes Summary

### What Stays the Same (98% of code)

✅ Frontend components
✅ React hooks patterns
✅ Zod schemas
✅ Business logic
✅ UI/UX
✅ Form handling
✅ API structure
✅ Database schema (already has tenant_id)
✅ Database queries (RLS handles filtering)

### What Changes (2% of code)

❌ Tenant middleware (read from subdomain instead of hardcoded)
❌ Add tenant onboarding endpoints
❌ Add tenant management UI

**AI Benefit**: Minimal refactoring needed because multi-tenancy was built in from Day 1

---

## Cost Comparison

### Phase 1 (Single Tenant)

**Option A: All-in-One VPS**

```
VPS (Hetzner CPX21): €8.50/month
Domain: €10/year
SSL: Free (Let's Encrypt)

Total: ~€9/month (~$10/month)
```

**Option B: Cloudflare Pages + VPS**

```
VPS (Hetzner CPX21): €8.50/month
Cloudflare Pages: €0/month (free tier, commercial use allowed)
Domain: €10/year
SSL: Free (Cloudflare)

Total: ~€9/month (~$10/month)
```

### Phase 2 (Multi-Tenant SaaS, 10 Tenants)

```
VPS (Hetzner CPX31): €15.50/month (8 vCPU, 16GB RAM)
Cloudflare Pages: €0/month (or self-hosted on VPS)
Database Backups (S3): $5/month
Monitoring: $10/month
Domain: €10/year

Total: ~€31/month (~$35/month)

Revenue (10 tenants × $50/month): $500/month
Profit: $465/month
```

### Phase 2 (Multi-Tenant SaaS, 100 Tenants)

```
VPS × 2 (Load balanced): €31/month
Load Balancer: €5/month
Database (Managed PostgreSQL): €50/month
Cloudflare Pages: €0/month (or CDN)
Monitoring: $20/month
Backups: $10/month

Total: ~€116/month (~$130/month)

Revenue (100 tenants × $50/month): $5,000/month
Profit: $4,870/month
```

---

## Key Principles for Both Phases

### 1. Feature-Based Architecture

```
✅ Group by feature (patients, vaccinations)
❌ Don't group by type (controllers, models)
```

**Why**: Easy to add/remove features, AI can understand context

### 2. Shared Schemas (Zod)

```
✅ Define schema once, use everywhere
❌ Don't duplicate validation logic
```

**Why**: Single source of truth, AI can generate code from schemas

### 3. Type Safety (TypeScript)

```
✅ Use strict TypeScript everywhere
❌ Don't use 'any' type
```

**Why**: Catch bugs early, AI can provide better suggestions

### 4. Consistent Patterns

```
✅ Same patterns for all features
❌ Don't mix different approaches
```

**Why**: Easy to understand, AI can replicate patterns

### 5. Minimal Dependencies

```
✅ Only 13 core dependencies
❌ Don't add libraries for simple things
```

**Why**: Less maintenance, easier to upgrade

---

## AI Development Workflow

### How to Work with AI (like me) Effectively

**1. Start with Schema**

```
You: "Create a vaccination schema with patient, vaccine, date, and dose"
AI: Generates Zod schema
```

**2. Generate Database Schema**

```
You: "Create Drizzle schema from the Zod schema"
AI: Generates database schema
```

**3. Generate API Endpoints**

```
You: "Create CRUD endpoints for vaccinations"
AI: Generates Express routes
```

**4. Generate Frontend Hooks**

```
You: "Create React Query hooks for vaccinations"
AI: Generates hooks
```

**5. Generate UI Components**

```
You: "Create a vaccination form component"
AI: Generates form with validation
```

**Total Time**: 10-15 minutes per feature (vs 2-3 hours manually)

---

## Summary

### Phase 1: NOW (0-6 months)

**Architecture**: Simple monolith
**Deployment**: Vercel + Hetzner VPS
**Cost**: ~$10/month
**Users**: <100 (single tenant)
**Development**: AI-assisted, ship fast
**Code Quality**: High (TypeScript, Zod, consistent patterns)

**Key Files to Create:**

1. `shared/schemas/*.ts` - Zod schemas
2. `backend/src/modules/*/` - Feature modules
3. `frontend/src/features/*/` - Feature modules
4. `docker-compose.yml` - Deployment config

### Phase 2: FUTURE (12-24 months)

**Architecture**: Multi-tenant monolith
**Deployment**: Multiple VPS + Load Balancer
**Cost**: ~$50-150/month
**Users**: Unlimited (multi-tenant)
**Migration**: Add tenant_id, refactor queries (10% of code)
**Revenue**: $50/tenant/month

**Key Changes:**

1. Add `tenant_id` to all tables
2. Add tenant middleware
3. Update all queries with tenant filter
4. Add tenant management UI
5. Add billing integration

---

## Next Steps

**Week 1: Setup**

- [ ] Create GitHub repo
- [ ] Initialize pnpm monorepo (`pnpm init`, create workspaces)
- [ ] Set up TypeScript configs
- [ ] Create `packages/shared` with Zod schemas (include audit fields)
- [ ] Set up Tailwind in frontend

**Week 2: Database + Auth**

- [ ] Create PostgreSQL database with multi-tenant schema (tenant_id + RLS)
- [ ] Set up Drizzle ORM
- [ ] Implement authentication (JWT)
- [ ] Create tenant middleware (hardcoded tenant for Phase 1)
- [ ] Test RLS policies

**Week 3-4: Core Features**

- [ ] Patient management (CRUD)
- [ ] Vaccination records
- [ ] Appointment scheduling
- [ ] Inventory tracking

**Week 5-6: Polish**

- [ ] UI refinement
- [ ] Form validation
- [ ] Error handling
- [ ] Loading states

**Week 7: Deployment**

- [ ] Set up Hetzner VPS
- [ ] Configure Docker Compose
- [ ] Set up Nginx + SSL
- [ ] Deploy to production

**Week 8: Launch**

- [ ] User training
- [ ] Monitor and fix issues
- [ ] Gather feedback

**Total Time to MVP: 8 weeks**

---

**Philosophy**: Build for tomorrow, ship today.

The tech stack is designed to work perfectly with AI assistance while avoiding technical debt traps. Multi-tenancy, audit trails, and security are built in from Day 1, but complexity is deferred until Phase 2.
