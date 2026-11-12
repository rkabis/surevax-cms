# SureVax CMS Tech Stack (Maintainability-First)

**Philosophy**: Boring, stable, replaceable, consistent

**Last Updated**: March 14, 2026

---

## Core Principles

1. **Boring Technology** - Choose proven over trendy
2. **Minimal Dependencies** - Every dependency is a liability
3. **Easy to Replace** - No vendor lock-in
4. **Consistency** - One way to do things
5. **Monolith First** - Microservices only when needed

---

## Architecture Decision: Monolith vs Microservices

### ❌ DON'T Start with Microservices

**Why not?**

- You don't have the scale problems yet
- Adds massive complexity (networking, deployment, monitoring)
- Harder to debug and develop
- Premature optimization

**When to consider microservices:**

- 10+ developers working on the codebase
- Clear bounded contexts that change independently
- Different scaling needs per service
- You have DevOps expertise

### ✅ Start with Modular Monolith

**Structure:**

```
backend/
├── modules/
│   ├── patients/      # Self-contained module
│   ├── vaccinations/  # Self-contained module
│   └── appointments/  # Self-contained module
└── shared/            # Shared utilities
```

**Benefits:**

- Easy to develop and debug
- Can extract to microservices later if needed
- Simpler deployment
- Faster development

**Future-proofing:**

- Keep modules loosely coupled
- Use clear interfaces between modules
- Each module has its own database tables
- Easy to extract later if needed

---

## Full Stack Overview

```
┌─────────────────────────────────────────┐
│           FRONTEND (React)              │
│  Vite + TypeScript + Tailwind + Zod     │
└─────────────────────────────────────────┘
                    ↓ HTTP/REST
┌─────────────────────────────────────────┐
│         API LAYER (Node.js)             │
│    Express + TypeScript + Zod           │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│       DATABASE (PostgreSQL)             │
│         + Drizzle ORM                   │
└─────────────────────────────────────────┘
```

---

## Frontend Stack

### 1. Build Tool: **Vite** ✅

- **Why**: Fast, standard, well-maintained
- **Alternatives considered**: Webpack (too complex), Next.js (overkill)
- **Risk**: Low - backed by huge community

### 2. Language: **TypeScript (Strict)** ✅

- **Why**: Catch bugs at compile time
- **Config**: Strict mode, no implicit any
- **Risk**: Zero - industry standard

### 3. Framework: **React 18** ✅

- **Why**: Stable, huge ecosystem, backed by Meta
- **Risk**: Zero - not going anywhere

### 4. Routing: **React Router v6** ✅

- **Why**: Battle-tested, 10M+ weekly downloads
- **NOT TanStack Router**: Too new, React Router is proven
- **Risk**: Very low - industry standard

### 5. Data Fetching: **TanStack Query v5** ✅

- **Why**: Solves hard caching problems, 3M+ downloads
- **Alternative**: Build yourself (3+ weeks of work)
- **Risk**: Low - too popular to die

```tsx
// Consistent pattern everywhere
const { data, isLoading, error } = useQuery({
  queryKey: ['patients'],
  queryFn: fetchPatients,
})
```

### 6. Forms: **React Hook Form** ✅

- **Why**: Performance, 4M+ downloads
- **Alternative**: Build yourself (2+ weeks)
- **Risk**: Low - industry standard

```tsx
// Consistent pattern everywhere
const { register, handleSubmit, formState } = useForm({
  resolver: zodResolver(schema),
})
```

### 7. Validation: **Zod** ✅

- **Why**: Single source of truth, 10M+ downloads
- **Used**: Frontend + Backend (consistency!)
- **Risk**: Very low - TypeScript standard

```tsx
// Define once, use everywhere
const patientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
})

// Frontend validation
useForm({ resolver: zodResolver(patientSchema) })

// Backend validation
app.post('/patients', validate(patientSchema), handler)
```

### 8. Styling: **Tailwind CSS** ✅

- **Why**: Consistency, no CSS files to maintain
- **Design System**: Define in tailwind.config.js
- **Risk**: Low - industry standard

```js
// tailwind.config.js - Single source of truth
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: '#3B82F6', // One place to change
        secondary: '#10B981',
      },
      spacing: {
        18: '4.5rem', // Consistent spacing
      },
    },
  },
}
```

### 9. State Management: **Context API** ✅

- **Why**: Built-in, zero dependencies
- **NOT Zustand**: One less dependency
- **When to add Zustand**: If Context causes performance issues

```tsx
// Simple, built-in, no dependencies
const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState<User | null>(null)
  return <AuthContext.Provider value={{ user, setUser }}>{children}</AuthContext.Provider>
}
```

### 10. UI Components: **Build Your Own** ✅

- **Why**: Full control, no dependency risk
- **Base**: Headless UI (by Tailwind team) for accessibility
- **NOT shadcn/ui**: Too new, build what you need

```tsx
// Own your components
// components/Button.tsx
export function Button({ variant = 'primary', ...props }) {
  const baseStyles = 'px-4 py-2 rounded font-medium'
  const variants = {
    primary: 'bg-primary text-white hover:bg-primary-dark',
    secondary: 'bg-secondary text-white hover:bg-secondary-dark',
  }

  return <button className={`${baseStyles} ${variants[variant]}`} {...props} />
}
```

### 11. Icons: **Heroicons** ✅

- **Why**: By Tailwind team, consistent with design
- **Alternative**: Lucide (also good)
- **Risk**: Low - maintained by Tailwind Labs

### 12. Dates: **date-fns** ✅

- **Why**: Lightweight, tree-shakeable
- **Risk**: Low - stable, popular

### 13. HTTP Client: **Native Fetch** ✅

- **Why**: Built-in, zero dependencies
- **NOT Axios**: One less dependency
- **Wrapper**: Create thin wrapper for consistency

```tsx
// lib/api.ts - Consistent API calls
export async function apiCall<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token')

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`)
  }

  return response.json()
}
```

### 14. Testing: **Vitest + Testing Library** ✅

- **Why**: Fast, Vite-native
- **Risk**: Low - modern standard

---

## Backend Stack

### 1. Runtime: **Node.js 20 LTS** ✅

- **Why**: LTS = long-term support
- **Risk**: Zero - industry standard

### 2. Language: **TypeScript (Strict)** ✅

- **Why**: Same as frontend = consistency
- **Shared Types**: Share Zod schemas between frontend/backend

### 3. Framework: **Express.js** ✅

- **Why**: Battle-tested, 20M+ weekly downloads
- **NOT Fastify/Hono**: Express is boring and stable
- **Risk**: Very low - been around 10+ years

```ts
// Simple, proven, everyone knows it
import express from 'express'

const app = express()
app.use(express.json())

app.get('/api/patients', async (req, res) => {
  const patients = await db.query.patients.findMany()
  res.json(patients)
})
```

### 4. Database: **PostgreSQL 15+** ✅

- **Why**: Rock solid, ACID compliant, JSON support
- **NOT MongoDB**: Relational data needs relational DB
- **Risk**: Zero - will outlive us all

### 5. ORM: **Drizzle ORM** ✅

- **Why**: TypeScript-first, lightweight, SQL-like
- **NOT Prisma**: Drizzle is lighter, more control
- **NOT TypeORM**: Drizzle is more modern

```ts
// Type-safe, SQL-like, lightweight
const patients = await db.select().from(patientsTable).where(eq(patientsTable.clinicId, clinicId))
```

### 6. Validation: **Zod** ✅

- **Why**: Same as frontend = consistency
- **Shared Schemas**: Import same schemas in frontend/backend

```ts
// backend/modules/patients/schema.ts
export const createPatientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
})

// backend/modules/patients/routes.ts
app.post('/patients', validate(createPatientSchema), createPatient)

// frontend/features/patients/api.ts
import { createPatientSchema } from '@backend/modules/patients/schema'
// Use same schema for form validation
```

### 7. Authentication: **JWT + bcrypt** ✅

- **Why**: Simple, stateless, standard
- **Library**: jsonwebtoken (20M+ downloads)
- **Risk**: Low - industry standard

```ts
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'

// Simple, proven patterns
const token = jwt.sign({ userId }, SECRET, { expiresIn: '7d' })
const isValid = await bcrypt.compare(password, hashedPassword)
```

### 8. API Design: **REST** ✅

- **Why**: Simple, everyone knows it
- **NOT GraphQL**: Adds complexity, not needed
- **NOT tRPC**: Couples frontend/backend

```
GET    /api/patients           # List
GET    /api/patients/:id       # Get one
POST   /api/patients           # Create
PUT    /api/patients/:id       # Update
DELETE /api/patients/:id       # Delete
```

---

## Logging & Monitoring

### 1. Logging: **Pino** ✅

- **Why**: Fast, structured JSON logs
- **Alternative**: Winston (also good, but slower)

```ts
import pino from 'pino'

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
})

// Structured logging
logger.info({ userId, action: 'login' }, 'User logged in')
logger.error({ err, patientId }, 'Failed to create patient')
```

### 2. Error Tracking: **Sentry** ✅

- **Why**: Industry standard, free tier
- **Risk**: Low - huge company backing it

```ts
import * as Sentry from '@sentry/node'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
})

// Automatic error tracking
app.use(Sentry.Handlers.errorHandler())
```

### 3. Application Monitoring: **Start Simple** ✅

- **Phase 1**: Console logs + Sentry
- **Phase 2**: Add Prometheus + Grafana (if needed)
- **NOT NOW**: Don't over-engineer monitoring

```ts
// Simple health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})
```

---

## Development Tools

### 1. Linting: **ESLint** ✅

```json
{
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"]
}
```

### 2. Formatting: **Prettier** ✅

```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5"
}
```

### 3. Git Hooks: **Husky + lint-staged** ✅

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"]
  }
}
```

### 4. Package Manager: **pnpm** ✅

- **Why**: Faster, saves disk space, strict
- **Alternative**: npm (also fine)

---

## Deployment & Infrastructure

### 1. Containerization: **Docker** ✅

```dockerfile
# Simple, standard Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "dist/index.js"]
```

### 2. Hosting: **Start Simple** ✅

- **Phase 1**: Single VPS (DigitalOcean/Hetzner)
- **Phase 2**: Add load balancer if needed
- **NOT NOW**: Don't start with Kubernetes

### 3. Database Hosting: **Managed PostgreSQL** ✅

- **Why**: Let experts handle backups/scaling
- **Options**: DigitalOcean, AWS RDS, Supabase

### 4. CI/CD: **GitHub Actions** ✅

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: ./deploy.sh
```

---

## Consistency Patterns

### 1. File Structure (Consistent Everywhere)

```
src/
├── features/              # Feature modules
│   ├── patients/
│   │   ├── api.ts        # API calls
│   │   ├── types.ts      # TypeScript types
│   │   ├── schema.ts     # Zod schemas
│   │   ├── hooks.ts      # React hooks
│   │   ├── components/   # UI components
│   │   └── index.ts      # Public exports
│   └── vaccinations/
│       └── (same structure)
├── shared/
│   ├── components/       # Reusable UI
│   ├── hooks/           # Reusable hooks
│   ├── lib/             # Utilities
│   └── types/           # Shared types
└── main.tsx
```

### 2. Naming Conventions (Consistent Everywhere)

```
Files:       PascalCase for components, camelCase for utilities
Components:  PascalCase (PatientCard.tsx)
Functions:   camelCase (fetchPatients)
Constants:   UPPER_SNAKE_CASE (API_URL)
Types:       PascalCase (Patient, PatientFormData)
```

### 3. API Response Format (Consistent Everywhere)

```ts
// Success response
{
  data: T,
  meta?: {
    page: number,
    total: number,
  }
}

// Error response
{
  error: {
    message: string,
    code: string,
    details?: unknown
  }
}
```

### 4. Error Handling (Consistent Everywhere)

```tsx
// Frontend
const { data, isLoading, error } = useQuery({
  queryKey: ['patients'],
  queryFn: fetchPatients,
})

if (isLoading) return <Spinner />
if (error) return <ErrorMessage error={error} />
return <PatientList data={data} />

// Backend
try {
  const patient = await createPatient(data)
  res.json({ data: patient })
} catch (error) {
  logger.error({ err: error }, 'Failed to create patient')
  res.status(500).json({
    error: {
      message: 'Failed to create patient',
      code: 'PATIENT_CREATE_ERROR',
    },
  })
}
```

---

## Dependency Policy

### Before Adding ANY Dependency:

1. **Can we build it in < 1 week?**
   - Yes → Build it
   - No → Consider library

2. **Is it actively maintained?**
   - Check last commit date
   - Check issue response time
   - Check number of contributors

3. **Does it have > 1M weekly downloads?**
   - Yes → Probably safe
   - No → Risky

4. **Can we replace it in < 1 week?**
   - Yes → Low risk
   - No → High risk

5. **Does it fit our consistency patterns?**
   - Yes → Good fit
   - No → Will cause confusion

### Current Dependencies Audit

| Dependency      | Weekly DL | Maintainers | Replace Time | Verdict    |
| --------------- | --------- | ----------- | ------------ | ---------- |
| React           | 20M+      | Meta        | N/A          | ✅ Core    |
| TypeScript      | 40M+      | Microsoft   | N/A          | ✅ Core    |
| TanStack Query  | 3M+       | 200+        | 1 week       | ✅ Keep    |
| React Hook Form | 4M+       | 100+        | 3 days       | ✅ Keep    |
| Zod             | 10M+      | 50+         | 2 days       | ✅ Keep    |
| React Router    | 10M+      | 100+        | 2 days       | ✅ Keep    |
| Express         | 20M+      | 100+        | 1 week       | ✅ Keep    |
| Drizzle         | 200k+     | 20+         | 3 days       | ⚠️ Monitor |

---

## What We're NOT Using (And Why)

### Frontend

- ❌ **Next.js** - Don't need SSR for a CMS
- ❌ **Redux** - Context API is enough
- ❌ **Styled Components** - Tailwind is more consistent
- ❌ **GraphQL** - REST is simpler
- ❌ **Axios** - Fetch is built-in
- ❌ **TanStack Router** - React Router is more stable
- ❌ **shadcn/ui** - Build our own for control

### Backend

- ❌ **NestJS** - Too much abstraction
- ❌ **Fastify** - Express is more proven
- ❌ **Prisma** - Drizzle is lighter
- ❌ **TypeORM** - Drizzle is more modern
- ❌ **GraphQL** - REST is simpler
- ❌ **Microservices** - Monolith first

### Infrastructure

- ❌ **Kubernetes** - Overkill for now
- ❌ **Serverless** - Need consistent performance
- ❌ **MongoDB** - Need relational DB

---

## Migration Path (If Needed)

### If TanStack Query Dies:

```tsx
// Abstraction layer makes it easy
// lib/useQuery.ts
export function useQuery(options) {
  // Can swap implementation here
  return tanstackQuery(options)
}

// All code uses our wrapper
import { useQuery } from '@/lib/useQuery'
```

### If React Router Dies:

- Routes are declarative
- Easy to migrate to any router
- 1-2 days of work

### If Drizzle Dies:

- SQL-like syntax
- Easy to migrate to raw SQL or another ORM
- 1 week of work

---

## The 10-Year Test

**Will this stack work in 10 years?**

✅ **Yes:**

- React (backed by Meta)
- TypeScript (backed by Microsoft)
- PostgreSQL (been around 30+ years)
- Express (been around 10+ years)
- REST APIs (universal standard)

⚠️ **Maybe:**

- TanStack Query (but easy to replace)
- Drizzle (newer, but SQL-like)

❌ **No:**

- Specific UI libraries (but we build our own)

**Strategy**: Use stable core, build abstractions for newer libraries

---

## Summary: The Stack

### Frontend (7 dependencies)

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
    "@headlessui/react": "^1.0.0",
    "@heroicons/react": "^2.0.0"
  }
}
```

### Backend (6 dependencies)

```json
{
  "dependencies": {
    "express": "^4.0.0",
    "drizzle-orm": "^0.29.0",
    "postgres": "^3.0.0",
    "zod": "^3.0.0",
    "jsonwebtoken": "^9.0.0",
    "bcrypt": "^5.0.0",
    "pino": "^8.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "drizzle-kit": "^0.20.0"
  }
}
```

**Total: 13 core dependencies**

---

## Next Steps

1. ✅ Set up monorepo structure
2. ✅ Configure TypeScript (strict mode)
3. ✅ Set up Tailwind design system
4. ✅ Create shared Zod schemas
5. ✅ Build component library
6. ✅ Set up database with Drizzle
7. ✅ Create first feature module
8. ✅ Set up logging and error tracking

---

**Philosophy**: Start simple, add complexity only when needed, choose boring technology, own your code.
