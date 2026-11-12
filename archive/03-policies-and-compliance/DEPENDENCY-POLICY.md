# Dependency Policy

**Purpose**: Prevent dependency bloat and tech debt

**Last Updated**: March 14, 2026

---

## The Rule: Every Dependency is a Liability

Before adding ANY npm package, it must pass ALL these checks:

---

## The 5-Question Test

### 1. Can we build this ourselves in < 1 week?

**If YES → Build it yourself**

Examples:

- ✅ Simple utilities (array helpers, string formatters)
- ✅ Basic HTTP wrappers
- ✅ Simple state management

**If NO → Consider using a library**

Examples:

- ❌ Data caching layer (TanStack Query)
- ❌ Form performance optimization (React Hook Form)
- ❌ Runtime validation (Zod)
- ❌ Database ORM (Drizzle)
- ❌ Accessible UI components (Headless UI, Radix)
- ❌ Complex keyboard navigation and focus management

---

### 2. Is it actively maintained?

**Check these metrics:**

```
✅ GOOD:
- Last commit: < 3 months ago
- Issues responded to: < 1 week
- Contributors: 10+
- Backed by company: Yes

❌ BAD:
- Last commit: > 6 months ago
- Issues ignored: > 1 month
- Contributors: 1-2
- Backed by company: No
```

**How to check:**

```bash
# Check npm page
npm view <package-name>

# Check GitHub
# Look at: commits, issues, pull requests
```

---

### 3. Does it have > 1M weekly downloads?

**Why this matters:**

- Popular = more eyes on bugs
- Popular = more likely to be maintained
- Popular = easier to find help

**Exceptions:**

- New libraries by trusted teams (Vercel, Meta, etc.)
- Niche but essential tools

**Check:**

```bash
npm view <package-name> | grep "weekly downloads"
```

---

### 4. Can we replace it in < 1 week?

**Low Risk (Easy to Replace):**

- ✅ HTTP clients (fetch, axios)
- ✅ Date libraries (date-fns, day.js)
- ✅ Icon libraries (heroicons, lucide)
- ✅ Validation (zod, yup)

**High Risk (Hard to Replace):**

- ❌ Frameworks (Next.js, Remix)
- ❌ ORMs (Prisma, TypeORM)
- ❌ State management (Redux, MobX)

**Strategy**: Prefer low-risk dependencies

---

### 5. Does it fit our consistency patterns?

**Questions:**

- Does it use TypeScript?
- Does it follow our naming conventions?
- Does it work with our existing stack?
- Will it confuse new developers?

**Example:**

```tsx
// ❌ BAD: Different pattern from rest of codebase
import { useStore } from 'some-state-lib'
const state = useStore(selector)

// ✅ GOOD: Consistent with React patterns
const [state, setState] = useState()
```

---

## Approved Dependencies

### Core (Never Remove)

```json
{
  "react": "^18.0.0",
  "typescript": "^5.0.0",
  "vite": "^5.0.0"
}
```

### Data Layer (Hard Problems)

```json
{
  "@tanstack/react-query": "^5.0.0", // Caching is hard
  "zod": "^3.0.0", // Validation everywhere
  "drizzle-orm": "^0.29.0" // Type-safe SQL
}
```

### Forms (Performance)

```json
{
  "react-hook-form": "^7.0.0" // Forms are painful
}
```

### Routing (Standard)

```json
{
  "react-router-dom": "^6.0.0" // Industry standard
}
```

### Backend (Proven)

```json
{
  "express": "^4.0.0", // Battle-tested
  "jsonwebtoken": "^9.0.0", // Auth standard
  "bcrypt": "^5.0.0", // Password hashing
  "pino": "^8.0.0" // Fast logging
}
```

### Utilities (Tiny)

```json
{
  "date-fns": "^3.0.0" // Date handling
}
```

---

## Banned Dependencies

### ❌ Never Use These

**Reason: Deprecated**

- `create-react-app` → Use Vite
- `moment.js` → Use date-fns

**Reason: Too Heavy**

- `lodash` → Use native JS
- `axios` → Use native fetch

**Reason: Too Complex**

- `redux` → Use Context API
- `nest.js` → Use Express

**Reason: Vendor Lock-in**

- `firebase` → Use PostgreSQL
- `amplify` → Use standard tools

---

## Review Process

### Before Adding a Dependency:

1. **Create a GitHub Issue**

   ```markdown
   ## Dependency Request: [package-name]

   **Problem**: What problem does this solve?
   **Alternative**: Can we build it ourselves?
   **Metrics**:

   - Weekly downloads: X
   - Last commit: X days ago
   - Contributors: X
   - Replace time: X days

   **5-Question Test**:

   - [ ] Can't build in < 1 week
   - [ ] Actively maintained
   - [ ] > 1M weekly downloads
   - [ ] Can replace in < 1 week
   - [ ] Fits our patterns
   ```

2. **Team Review**
   - At least 2 developers must approve
   - Senior developer must approve

3. **Add to Approved List**
   - Update this document
   - Document why we chose it

---

## Dependency Audit Schedule

### Monthly Review

**Check all dependencies:**

```bash
# Check for outdated packages
npm outdated

# Check for security issues
npm audit

# Check for unused dependencies
npx depcheck
```

**Questions:**

- Are we still using this?
- Is it still maintained?
- Should we replace it?

### Quarterly Deep Dive

**For each dependency:**

1. Check GitHub activity
2. Check issue response time
3. Check for alternatives
4. Decide: Keep, Replace, or Remove

**Document decisions:**

```markdown
## Q1 2026 Dependency Audit

### @tanstack/react-query

- Status: ✅ Keep
- Activity: Very active
- Alternatives: None better
- Action: None

### some-old-package

- Status: ❌ Remove
- Activity: No commits in 6 months
- Alternatives: Build ourselves
- Action: Remove by end of Q2
```

---

## Abstraction Strategy

### Only Wrap Infrastructure Dependencies

**CRITICAL: Do NOT wrap framework-level libraries**

**❌ NEVER Wrap These (Abstraction Inversion Anti-Pattern):**

- React Query / TanStack Query
- React Hook Form
- React Router
- UI component libraries (Headless UI, Radix)

**Why wrapping these is bad:**

- Breaks TypeScript inference
- Cuts you off from ecosystem tools (DevTools, plugins)
- Requires constant updates to support new features
- Doesn't actually make migration easier

**✅ DO Wrap These (Infrastructure):**

- HTTP clients (fetch, axios)
- Logging libraries (pino, winston)
- Analytics (PostHog, Mixpanel)
- Payment providers (Stripe)
- Email services (SendGrid, Resend)

**Example of GOOD abstraction:**

```tsx
// ✅ GOOD: Wrap infrastructure
// lib/logger.ts
import pino from 'pino'

const logger = pino()

export function log(message: string, data?: any) {
  logger.info({ data }, message)
}

// Easy to swap pino for winston later
```

**Example of BAD abstraction:**

```tsx
// ❌ BAD: Wrapping React Query
// lib/data.ts
import { useQuery as useTanStackQuery } from '@tanstack/react-query'

export function useQuery(options) {
  return useTanStackQuery(options)
}

// Problems:
// - TypeScript inference broken
// - Can't use React Query DevTools
// - Have to manually add support for every new option
// - Doesn't make migration easier anyway
```

**Benefits of selective wrapping:**

- Maintain full TypeScript support
- Keep ecosystem compatibility
- Focus abstraction where it matters
- Easier maintenance

---

## Migration Plan Template

### When a Dependency Needs Replacement

**1. Identify the Problem**

- Why are we replacing it?
- What's the alternative?

**2. Create Abstraction (if not exists)**

```tsx
// Wrap the old dependency
export function useOldLibrary() {
  return oldLibrary()
}
```

**3. Implement New Solution**

```tsx
// Add new implementation
export function useNewLibrary() {
  return newLibrary()
}
```

**4. Feature Flag**

```tsx
export function useLibrary() {
  const useNew = process.env.USE_NEW_LIBRARY === 'true'
  return useNew ? useNewLibrary() : useOldLibrary()
}
```

**5. Gradual Migration**

- Test new implementation
- Roll out to 10% of users
- Monitor for issues
- Roll out to 100%

**6. Remove Old Dependency**

```bash
npm uninstall old-library
```

---

## Real-World Examples

### Example 1: Should we add `lodash`?

**Problem**: Need utility functions

**5-Question Test:**

1. Can we build in < 1 week? ✅ YES (most utils are 1-liners)
2. Actively maintained? ✅ YES
3. > 1M downloads? ✅ YES (40M+)
4. Can replace in < 1 week? ✅ YES
5. Fits our patterns? ❌ NO (we prefer native JS)

**Decision**: ❌ DON'T ADD
**Reason**: Modern JS has most utilities built-in

```tsx
// ❌ Don't do this
import { map, filter } from 'lodash'

// ✅ Do this
array.map(...)
array.filter(...)
```

---

### Example 4: Should we add `Headless UI` or `Radix UI`?

**Problem**: Need accessible Button, Modal, Dropdown components with proper keyboard navigation

**5-Question Test:**

1. Can we build in < 1 week? ❌ NO (accessibility is complex)
2. Actively maintained? ✅ YES
3. > 1M downloads? ✅ YES
4. Can replace in < 1 week? ✅ YES (with abstraction)
5. Fits our patterns? ✅ YES (unstyled, use with Tailwind)

**Decision**: ✅ ADD
**Reason**: Production-ready accessibility (ARIA, focus management, keyboard nav) takes weeks to build correctly. Medical systems need power-user keyboard support.

**Why you can't build this in a week:**

- Proper ARIA attributes
- Focus trapping in modals
- Keyboard navigation (Tab, Escape, Arrow keys)
- Screen reader announcements
- Touch device support
- Browser compatibility quirks

```tsx
// ❌ Don't do this (missing accessibility)
;<button onClick={onClick}>Click me</button>

// ✅ Do this (full accessibility built-in)
import { Button } from '@headlessui/react'
;<Button onClick={onClick}>Click me</Button>
```

---

### Example 2: Should we add `TanStack Query`?

**Problem**: Need data caching and state management

**5-Question Test:**

1. Can we build in < 1 week? ❌ NO (caching is complex)
2. Actively maintained? ✅ YES
3. > 1M downloads? ✅ YES (3M+)
4. Can replace in < 1 week? ✅ YES (with abstraction)
5. Fits our patterns? ✅ YES (React hooks)

**Decision**: ✅ ADD
**Reason**: Solves hard problem, well-maintained, easy to replace

---

### Example 3: Should we add `styled-components`?

**Problem**: Need styling solution

**5-Question Test:**

1. Can we build in < 1 week? ✅ YES (CSS is built-in)
2. Actively maintained? ✅ YES
3. > 1M downloads? ✅ YES (3M+)
4. Can replace in < 1 week? ❌ NO (would need to rewrite all styles)
5. Fits our patterns? ❌ NO (we use Tailwind)

**Decision**: ❌ DON'T ADD
**Reason**: We already have Tailwind, adding another styling solution creates inconsistency

---

## Metrics to Track

### Dependency Health Dashboard

```markdown
## Current Dependencies: 13

### By Risk Level:

- Low Risk (easy to replace): 8
- Medium Risk: 3
- High Risk: 2

### By Maintenance:

- Excellent (< 1 month since update): 10
- Good (< 3 months): 2
- Warning (< 6 months): 1
- Critical (> 6 months): 0

### By Size:

- Tiny (< 100kb): 6
- Small (< 500kb): 4
- Medium (< 1MB): 2
- Large (> 1MB): 1

### Total Bundle Size: 450kb (gzipped)
```

---

## Emergency Procedures

### If a Dependency is Compromised

**1. Immediate Action**

```bash
# Remove the package
npm uninstall compromised-package

# Check for alternatives
npm search alternative-package

# Or build yourself
```

**2. Assess Impact**

- Where is it used?
- Can we replace it quickly?
- Do we need it?

**3. Implement Fix**

- Use alternative
- Build ourselves
- Remove feature (if not critical)

**4. Document**

- What happened?
- How did we fix it?
- How do we prevent this?

---

## Success Metrics

### Goals

**Dependency Count:**

- Target: < 20 total dependencies
- Current: 13
- Status: ✅ Good

**Bundle Size:**

- Target: < 500kb (gzipped)
- Current: 450kb
- Status: ✅ Good

**Maintenance:**

- Target: All dependencies updated < 3 months
- Current: 92% (12/13)
- Status: ✅ Good

**Security:**

- Target: 0 critical vulnerabilities
- Current: 0
- Status: ✅ Good

---

## Summary

**The Golden Rule**: Every dependency is a liability. Add dependencies only when the benefit clearly outweighs the cost.

**Remember:**

- 🎯 Prefer boring, stable technology
- 🎯 Build simple things yourself
- 🎯 Use libraries for hard problems
- 🎯 Wrap dependencies in abstractions
- 🎯 Review regularly
- 🎯 Remove aggressively

**When in doubt, don't add it.**
