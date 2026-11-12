# React Tech Stack for SureVax CMS

Curated libraries for modularity, maintainability, and cohesiveness.

---

## Core Philosophy

**Goals**:

1. **Modularity** - Feature-based architecture, easy to add/remove modules
2. **Maintainability** - Clean code, easy to understand and modify
3. **Cohesiveness** - Libraries work well together, consistent patterns

**Anti-Goals**:

- ❌ Using every trendy library
- ❌ Over-engineering
- ❌ Analysis paralysis

---

## The Stack (Opinionated & Battle-Tested)

### 1. Build Tool: **Vite** ⭐⭐⭐⭐⭐

**Why**: Fast, modern, zero-config

```bash
npm create vite@latest surevax-cms -- --template react-ts
```

**Alternatives**:

- ❌ Create React App (deprecated, slow)
- ⚠️ Next.js (overkill for this use case)
- ⚠️ Webpack (too complex)

**Verdict**: Vite is the clear winner

---

### 2. Language: **TypeScript** ⭐⭐⭐⭐⭐

**Why**: Type safety, better IDE support, fewer bugs

**Configuration** (`tsconfig.json`):

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitAny": true
  }
}
```

**Verdict**: Non-negotiable for maintainability

---

### 3. Routing: **TanStack Router** ⭐⭐⭐⭐⭐

**Why**: Type-safe, modern, better than React Router

```tsx
import { createRoute } from '@tanstack/react-router'

const patientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients',
  component: PatientsPage,
})
```

**Benefits**:

- ✅ Type-safe routes
- ✅ Built-in data loading
- ✅ Better performance
- ✅ Modern API

**Alternative**: React Router v6 (if you prefer familiarity)

**Verdict**: TanStack Router for new projects

---

### 4. State Management: **Zustand** ⭐⭐⭐⭐⭐

**Why**: Simple, minimal boilerplate, perfect for modular architecture

````tsx
import { create } from 'zustand'

interface PatientStore {
  patients: Patient[]
  addPatient: (patient: Patient) => void
}

export const usePatientStore = create<PatientStore>((set) => ({
  patients: [],
  addPatient: (patient) => set((state) => ({
    patients: [...state.patients, patient]
  })),
}))
```/Applications/Proton Pass.app/Contents/Resources/app-arm64.asar/.webpack/renderer/main_window/index.html

**Benefits**:
- ✅ No providers needed
- ✅ Minimal boilerplate
- ✅ Works great with TypeScript
- ✅ Easy to split stores by feature

**Alternatives**:
- ⚠️ Redux Toolkit (too much boilerplate)
- ⚠️ Jotai/Recoil (atomic state - overkill)
- ✅ Context API (for simple cases)

**Verdict**: Zustand for global state, Context for local state

---

### 5. Data Fetching: **TanStack Query** ⭐⭐⭐⭐⭐

**Why**: Industry standard, handles caching, loading, errors

```tsx
import { useQuery } from '@tanstack/react-query'

function PatientList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['patients'],
    queryFn: fetchPatients,
  })

  if (isLoading) return <Spinner />
  if (error) return <ErrorMessage error={error} />

  return <PatientTable data={data} />
}
````

**Benefits**:

- ✅ Automatic caching
- ✅ Background refetching
- ✅ Optimistic updates
- ✅ Pagination/infinite scroll support

**Verdict**: Essential for any data-driven app

---

### 6. Forms: **React Hook Form** ⭐⭐⭐⭐⭐

**Why**: Performant, minimal re-renders, great DX

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const patientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthDate: z.date(),
})

function PatientForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(patientSchema),
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('firstName')} />
      {errors.firstName && <span>{errors.firstName.message}</span>}
    </form>
  )
}
```

**Alternatives**:

- ❌ Formik (slower, more re-renders)
- ⚠️ Manual state (too much work)

**Verdict**: React Hook Form + Zod for validation

---

### 7. Validation: **Zod** ⭐⭐⭐⭐⭐

**Why**: Type-safe, composable, works everywhere

```tsx
import { z } from 'zod'

// Define schema once, use everywhere
export const patientSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  birthDate: z.date(),
  email: z.string().email().optional(),
})

// Infer TypeScript type
export type Patient = z.infer<typeof patientSchema>

// Use in forms, API validation, etc.
```

**Benefits**:

- ✅ Single source of truth
- ✅ Runtime + compile-time safety
- ✅ Great error messages
- ✅ Composable schemas

**Verdict**: Essential for TypeScript projects

---

### 8. UI Components: **shadcn/ui** ⭐⭐⭐⭐⭐

**Why**: Copy-paste components, full control, built on Radix UI

```bash
npx shadcn-ui@latest init
npx shadcn-ui@latest add button
npx shadcn-ui@latest add table
npx shadcn-ui@latest add dialog
```

**Benefits**:

- ✅ Own the code (not a dependency)
- ✅ Accessible by default (Radix UI)
- ✅ Customizable with Tailwind
- ✅ Beautiful defaults

**Alternatives**:

- ⚠️ Material UI (heavy, opinionated)
- ⚠️ Ant Design (good but less flexible)
- ⚠️ Chakra UI (good alternative)

**Verdict**: shadcn/ui for maximum flexibility

---

### 9. Styling: **Tailwind CSS** ⭐⭐⭐⭐⭐

**Why**: Utility-first, fast, consistent

```tsx
function PatientCard({ patient }: { patient: Patient }) {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{patient.name}</h3>
      <p className="text-sm text-muted-foreground">{patient.email}</p>
    </div>
  )
}
```

**Configuration**:

```js
// tailwind.config.js
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'hsl(var(--primary))',
        secondary: 'hsl(var(--secondary))',
      },
    },
  },
}
```

**Verdict**: Perfect match with shadcn/ui

---

### 10. Date Handling: **date-fns** ⭐⭐⭐⭐⭐

**Why**: Lightweight, tree-shakeable, simple API

```tsx
import { format, addDays, differenceInYears } from 'date-fns'

// Format dates
format(new Date(), 'MMM dd, yyyy') // "Mar 12, 2026"

// Calculate age
const age = differenceInYears(new Date(), patient.birthDate)

// Add days to vaccination date
const nextDose = addDays(firstDose, 28)
```

**Alternatives**:

- ❌ Moment.js (deprecated, huge)
- ⚠️ Day.js (smaller but less features)
- ⚠️ Luxon (good but heavier)

**Verdict**: date-fns is the sweet spot

---

### 11. Tables: **TanStack Table** ⭐⭐⭐⭐⭐

**Why**: Headless, powerful, flexible

```tsx
import { useReactTable, getCoreRowModel } from '@tanstack/react-table'

function PatientTable({ data }: { data: Patient[] }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <table>
      {table.getHeaderGroups().map((headerGroup) => (
        <tr key={headerGroup.id}>
          {headerGroup.headers.map((header) => (
            <th key={header.id}>{header.column.columnDef.header}</th>
          ))}
        </tr>
      ))}
    </table>
  )
}
```

**Benefits**:

- ✅ Sorting, filtering, pagination
- ✅ Bring your own UI
- ✅ TypeScript support
- ✅ Virtual scrolling support

**Verdict**: Best table library for React

---

### 12. Icons: **Lucide React** ⭐⭐⭐⭐⭐

**Why**: Beautiful, consistent, tree-shakeable

```tsx
import { User, Calendar, Syringe } from 'lucide-react'

function Navigation() {
  return (
    <nav>
      <NavItem icon={<User />} label="Patients" />
      <NavItem icon={<Calendar />} label="Appointments" />
      <NavItem icon={<Syringe />} label="Vaccinations" />
    </nav>
  )
}
```

**Verdict**: Perfect match with shadcn/ui

---

### 13. Testing: **Vitest + Testing Library** ⭐⭐⭐⭐⭐

**Why**: Fast, Vite-native, familiar API

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

describe('PatientCard', () => {
  it('renders patient name', () => {
    render(<PatientCard patient={mockPatient} />)
    expect(screen.getByText('John Doe')).toBeInTheDocument()
  })
})
```

**Configuration**:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
```

**Verdict**: Vitest is the modern choice

---

### 14. Linting & Formatting: **ESLint + Prettier** ⭐⭐⭐⭐⭐

**Why**: Catch bugs, consistent code style

```json
// .eslintrc.json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended"
  ]
}
```

```json
// .prettierrc
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5"
}
```

**Verdict**: Essential for team projects

---

### 15. API Client: **Axios** ⭐⭐⭐⭐

**Why**: Interceptors, better error handling than fetch

```tsx
import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
})

// Add auth token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle errors globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Redirect to login
    }
    return Promise.reject(error)
  },
)
```

**Alternative**: Native fetch (simpler but less features)

**Verdict**: Axios for complex apps, fetch for simple ones

---

## Project Structure

```
src/
├── features/           # Feature-based modules
│   ├── patients/
│   │   ├── api/       # API calls
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── stores/    # Zustand stores
│   │   ├── types/
│   │   └── utils/
│   ├── vaccinations/
│   └── appointments/
├── shared/            # Shared utilities
│   ├── components/    # Reusable UI components
│   ├── hooks/
│   ├── lib/          # Third-party lib configs
│   └── utils/
├── routes/           # TanStack Router routes
└── main.tsx
```

---

## Installation Commands

```bash
# Create project
npm create vite@latest surevax-cms -- --template react-ts
cd surevax-cms

# Core dependencies
npm install @tanstack/react-router @tanstack/react-query
npm install zustand react-hook-form @hookform/resolvers/zod zod
npm install axios date-fns

# UI dependencies
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npx shadcn-ui@latest init

# Table & Icons
npm install @tanstack/react-table lucide-react

# Dev dependencies
npm install -D vitest @testing-library/react @testing-library/jest-dom
npm install -D eslint prettier eslint-config-prettier
npm install -D @typescript-eslint/eslint-plugin @typescript-eslint/parser
```

---

## Key Principles

1. **Feature-First Architecture**: Group by feature, not by type
2. **Type Safety**: Use TypeScript strictly, Zod for runtime validation
3. **Composition**: Small, reusable components
4. **Separation of Concerns**: Logic in hooks, UI in components
5. **Performance**: React Query for caching, Zustand for minimal re-renders
6. **Accessibility**: shadcn/ui (Radix) provides accessible primitives
7. **Testing**: Test user behavior, not implementation details

---

## What We're NOT Using (And Why)

- ❌ **Redux**: Too much boilerplate, Zustand is simpler
- ❌ **Styled Components**: Tailwind is faster and more maintainable
- ❌ **GraphQL**: REST is simpler for this use case
- ❌ **Next.js**: Don't need SSR for a CMS
- ❌ **Storybook**: Nice to have, but not essential for MVP
- ❌ **Cypress**: Vitest + Testing Library is enough

---

## Decision Matrix

| Need          | Library         | Why          |
| ------------- | --------------- | ------------ |
| Build         | Vite            | Fast, modern |
| Routing       | TanStack Router | Type-safe    |
| State         | Zustand         | Simple       |
| Data Fetching | TanStack Query  | Caching      |
| Forms         | React Hook Form | Performance  |
| Validation    | Zod             | Type-safe    |
| UI            | shadcn/ui       | Flexible     |
| Styling       | Tailwind        | Fast         |
| Dates         | date-fns        | Lightweight  |
| Tables        | TanStack Table  | Powerful     |
| Icons         | Lucide          | Beautiful    |
| Testing       | Vitest          | Fast         |

---

## Next Steps

1. ✅ Set up Vite project
2. ✅ Configure TypeScript
3. ✅ Install and configure Tailwind + shadcn/ui
4. ✅ Set up TanStack Router
5. ✅ Configure TanStack Query
6. ✅ Create feature folders
7. ✅ Build first feature (Patients module)

---

**Last Updated**: March 12, 2026
