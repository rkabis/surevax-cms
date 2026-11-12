# SureVax CMS Quick Start Guide

**For**: Single clinic, <100 users, ship fast with AI
**Goal**: Production-ready in 8 weeks

---

## TL;DR

**Now (Phase 1):**

- React + TypeScript + Tailwind (frontend)
- Express + PostgreSQL + Drizzle (backend)
- Deploy: Vercel (free) + Hetzner VPS ($10/month)
- 13 dependencies total
- AI-friendly, maintainable, fast to ship

**Future (Phase 2):**

- Add multi-tenancy (tenant_id to all tables)
- 10% code changes, 90% stays the same
- Scale to unlimited clinics
- Cost: $50-150/month for 100+ tenants

---

## Installation (5 minutes)

```bash
# 1. Create project
mkdir surevax-cms && cd surevax-cms

# 2. Create frontend
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install react-router-dom @tanstack/react-query react-hook-form zod date-fns
npm install -D tailwindcss @heroicons/react
npx tailwindcss init -p
cd ..

# 3. Create backend
mkdir backend && cd backend
npm init -y
npm install express drizzle-orm postgres zod jsonwebtoken bcrypt pino cors helmet
npm install -D typescript tsx drizzle-kit @types/node @types/express
cd ..

# 4. Create shared schemas
mkdir shared && cd shared
npm init -y
npm install zod
cd ..

# Done!
```

---

## Project Structure

```
surevax-cms/
├── frontend/          # React app
│   └── src/
│       ├── features/  # patients, vaccinations, appointments
│       └── shared/    # components, lib, types
│
├── backend/           # Express API
│   └── src/
│       ├── modules/   # patients, vaccinations, appointments
│       └── shared/    # db, middleware, utils
│
├── shared/            # Shared Zod schemas
│   └── schemas/
│
└── docker-compose.yml # Deployment
```

---

## Development Workflow (AI-Assisted)

### 1. Define Schema (Zod)

```ts
// shared/schemas/patient.ts
import { z } from 'zod'

export const patientSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthDate: z.date(),
})

export type Patient = z.infer<typeof patientSchema>
```

### 2. Create Database Table (Drizzle)

```ts
// backend/src/shared/db/schema.ts
import { pgTable, uuid, varchar, date } from 'drizzle-orm/pg-core'

export const patients = pgTable('patients', {
  id: uuid('id').primaryKey().defaultRandom(),
  firstName: varchar('first_name', { length: 255 }).notNull(),
  lastName: varchar('last_name', { length: 255 }).notNull(),
  birthDate: date('birth_date').notNull(),
})
```

### 3. Create API (Express)

```ts
// backend/src/modules/patients/routes.ts
import { Router } from 'express'

const router = Router()

router.get('/', async (req, res) => {
  const patients = await db.query.patients.findMany()
  res.json({ data: patients })
})

router.post('/', async (req, res) => {
  const patient = await db.insert(patients).values(req.body).returning()
  res.json({ data: patient })
})

export default router
```

### 4. Create Frontend Hook (React Query)

```ts
// frontend/src/features/patients/api.ts
import { useQuery } from '@tanstack/react-query'

export function usePatients() {
  return useQuery({
    queryKey: ['patients'],
    queryFn: async () => {
      const res = await fetch('/api/patients')
      return res.json()
    },
  })
}
```

### 5. Create UI Component

```tsx
// frontend/src/features/patients/components/PatientList.tsx
import { usePatients } from '../api'

export function PatientList() {
  const { data, isLoading } = usePatients()

  if (isLoading) return <div>Loading...</div>

  return (
    <div>
      {data?.data.map((patient) => (
        <div key={patient.id}>
          {patient.firstName} {patient.lastName}
        </div>
      ))}
    </div>
  )
}
```

**Time per feature: 10-15 minutes with AI**

---

## Deployment (1 hour)

### Frontend (Vercel - Free)

```bash
# 1. Push to GitHub
git push origin main

# 2. Go to vercel.com
# 3. Import repository
# 4. Deploy (automatic)

# Done!
```

### Backend (Hetzner VPS - $10/month)

```bash
# 1. Create VPS at hetzner.com
# Choose: CPX21 (3 vCPU, 4GB RAM) - €8.50/month

# 2. SSH into server
ssh root@your-ip

# 3. Install Docker
curl -fsSL https://get.docker.com | sh

# 4. Clone and deploy
git clone https://github.com/your-org/surevax-cms.git
cd surevax-cms
docker-compose up -d

# Done!
```

---

## Tech Stack (13 Dependencies)

### Frontend (7)

- react, react-dom
- react-router-dom
- @tanstack/react-query
- react-hook-form
- zod
- date-fns

### Backend (6)

- express
- drizzle-orm, postgres
- zod
- jsonwebtoken, bcrypt
- pino

**Why so few?**

- Less maintenance
- Faster to learn
- AI knows them well
- Easy to upgrade

---

## Key Patterns

### 1. Feature-Based Structure

```
✅ features/patients/
✅ features/vaccinations/
❌ controllers/
❌ models/
```

### 2. Shared Schemas

```
✅ Define once in shared/schemas
✅ Use in frontend + backend
❌ Duplicate validation
```

### 3. Consistent API Responses

```ts
// Success
{ data: T }

// Error
{ error: { message: string, code: string } }
```

### 4. Type Safety Everywhere

```ts
✅ TypeScript strict mode
✅ Zod for runtime validation
❌ No 'any' types
```

---

## Migration to Multi-Tenant (Future)

### When to Migrate

- You have 2+ clinics interested
- Revenue justifies the work
- ~12-24 months from now

### What Changes (10% of code)

**1. Add tenant_id to tables**

```sql
ALTER TABLE patients ADD COLUMN tenant_id UUID;
ALTER TABLE vaccinations ADD COLUMN tenant_id UUID;
```

**2. Add tenant middleware**

```ts
app.use((req, res, next) => {
  req.tenant = getTenantFromRequest(req)
  next()
})
```

**3. Update queries**

```ts
// Before
const patients = await db.query.patients.findMany()

// After
const patients = await db.query.patients.findMany({
  where: eq(patients.tenantId, req.tenant.id),
})
```

**Time to migrate: 1-2 weeks**

---

## Cost Breakdown

### Phase 1 (Now)

```
Hetzner VPS: $10/month
Vercel: Free
Domain: $10/year
Total: ~$11/month
```

### Phase 2 (Multi-Tenant, 10 Clinics)

```
Hetzner VPS: $17/month
Vercel Pro: $20/month
Monitoring: $10/month
Total: ~$47/month

Revenue: $500/month (10 × $50)
Profit: $453/month
```

### Phase 2 (Multi-Tenant, 100 Clinics)

```
Infrastructure: $150/month
Revenue: $5,000/month (100 × $50)
Profit: $4,850/month
```

---

## Working with AI

### Effective Prompts

**Good:**

```
"Create a vaccination schema with patient reference, vaccine name,
date administered, and dose number. Use Zod."
```

**Bad:**

```
"Make a vaccination thing"
```

### AI Can Generate:

- ✅ Zod schemas
- ✅ Database schemas
- ✅ API endpoints
- ✅ React hooks
- ✅ Form components
- ✅ Tests

### AI Cannot:

- ❌ Understand your business logic
- ❌ Make product decisions
- ❌ Design UX flows

**Use AI for boilerplate, you focus on business logic**

---

## 8-Week Timeline

### Week 1-2: Setup

- Project structure
- Authentication
- Database setup

### Week 3-4: Core Features

- Patient management
- Vaccination records
- Appointment scheduling

### Week 5-6: Additional Features

- Inventory management
- Reports
- User management

### Week 7: Polish

- UI refinement
- Testing
- Bug fixes

### Week 8: Launch

- Deploy to production
- User training
- Documentation

---

## Common Questions

### Q: Why not use Supabase?

**A**: Vendor lock-in, costs explode at scale ($600+/month vs $10/month)

### Q: Why not use Next.js?

**A**: Don't need SSR for a CMS, adds complexity

### Q: Why not use Redux?

**A**: Context API is enough for this scale

### Q: Why not use GraphQL?

**A**: REST is simpler, AI knows it better

### Q: Why not use microservices?

**A**: Premature optimization, adds complexity

### Q: Can I add [library X]?

**A**: Check DEPENDENCY-POLICY.md first

---

## Resources

- **Full Tech Stack**: See TECH-STACK-ROADMAP.md
- **Deployment Guide**: See DEPLOYMENT-STRATEGY.md
- **Dependency Policy**: See DEPENDENCY-POLICY.md
- **Database Schema**: See database-schema-v4.md

---

## Getting Help

### From AI (like me):

```
"Generate a [feature] following the patterns in [existing feature]"
"Add validation to [schema] for [requirement]"
"Create tests for [module]"
```

### From Documentation:

- React Query: tanstack.com/query
- Drizzle ORM: orm.drizzle.team
- React Hook Form: react-hook-form.com

---

## Success Metrics

### Phase 1 (First 6 months)

- ✅ Ship MVP in 8 weeks
- ✅ <100 users running smoothly
- ✅ <$20/month infrastructure cost
- ✅ Code is maintainable and documented

### Phase 2 (12-24 months)

- ✅ 10+ clinics using the system
- ✅ $500+/month revenue
- ✅ Multi-tenant architecture
- ✅ <$100/month infrastructure cost

---

## Final Checklist

**Before Starting:**

- [ ] Read TECH-STACK-ROADMAP.md
- [ ] Understand the architecture
- [ ] Set up development environment
- [ ] Create GitHub repository

**During Development:**

- [ ] Follow feature-based structure
- [ ] Use shared Zod schemas
- [ ] Write TypeScript strictly
- [ ] Test with real data
- [ ] Document as you go

**Before Launch:**

- [ ] Set up production VPS
- [ ] Configure domain and SSL
- [ ] Set up backups
- [ ] Test with users
- [ ] Create user documentation

---

**Remember**: Start simple, ship fast, maintain quality, prepare for growth.

The stack is designed to work perfectly with AI while staying maintainable and scalable.
