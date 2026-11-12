# SureVax CMS v2.0 - UI Design Guide

Based on healthcare UI/UX best practices and clinic workflow research.

---

## Design Philosophy

**Core Principles:**

1. **Speed over aesthetics** - Nurses need to process patients quickly
2. **Reduce cognitive load** - High-stress environment requires clarity
3. **Desktop-first, keyboard-optimized** - Primary access via desktop PC with keyboard/mouse
4. **Role-specific interfaces** - Different views for different roles
5. **Minimize clicks** - Every click costs time in a busy clinic
6. **Keyboard shortcuts** - Power users need fast navigation

---

## Recommended Tech Stack

### UI Framework: **Vue 3 + Tailwind CSS + Headless Components**

**Why this combination:**

- ✅ Vue 3 is simpler and more maintainable than React
- ✅ Tailwind provides utility-first styling for rapid development
- ✅ Headless components avoid CSS conflicts and give full styling control
- ✅ Both are lightweight and performant
- ✅ Desktop-optimized with excellent keyboard support
- ✅ AI-friendly: Well-documented patterns with extensive training data

### Component Library: **Radix-Vue** (Recommended)

- **URL**: https://www.radix-vue.com/
- **Why**: Unstyled, accessible components designed for Vue 3
- **Features**:
  - Headless architecture (no CSS conflicts with Tailwind)
  - WCAG 2.1 AA compliant out of the box
  - Full keyboard navigation support
  - Composable primitives
  - TypeScript support
  - Well-documented API
- **Benefits for AI Development**:
  - Clear, predictable component APIs
  - No opinionated styling to fight against
  - Tailwind handles all visual styling
  - Extensive documentation for AI training data

**Alternative**: **NuxtUI** (if using Nuxt framework)

- Built on Radix-Vue and Tailwind
- Pre-styled components that can be customized
- Excellent for rapid prototyping

**Why NOT Infermedica/Element Plus/Vuetify:**

- Infermedica is too niche (limited AI training data, beta status)
- Element Plus and Vuetify have heavy CSS engines that conflict with Tailwind
- Mixing component library CSS with Tailwind causes specificity wars
- Headless components give you speed without the styling baggage

---

## Layout Patterns

### 1. Split-Screen Layout (Primary Pattern)

**Based on**: Gregory Schmidt's EHR multi-screen design principles ([source](https://www.gregoryschmidt.ca/writing/ehr-design-multi-screen-multi-tasking))

**Desktop Layout (1920x1080 or 1366x768):**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Top Navigation Bar (Branch, User, Quick Actions, Notifications)    │
├──────────────────────┬──────────────────────────────────────────────┤
│                      │                                              │
│  Left Panel (30%)    │  Right Panel (70%)                           │
│  (List/Index)        │  (Detail/Form)                               │
│  [Resizable ↔]       │                                              │
│                      │                                              │
│  🔍 Search           │  ┌────────────────────────────────────────┐ │
│  [____________]      │  │ PATIENT DETAILS                        │ │
│                      │  │                                        │ │
│  ┌────────────────┐  │  │ Name: Juan Dela Cruz                  │ │
│  │ Juan Dela Cruz │◄─┼──┤ Contact: 09171234567                  │ │
│  │ 09171234567    │  │  │ Status: 🟡 Active PEP (Day 3 due)     │ │
│  │ 🟡 Day 3 due   │  │  │                                        │ │
│  └────────────────┘  │  │ [Quick Actions: Administer | Pay]     │ │
│                      │  │                                        │ │
│  ┌────────────────┐  │  │ STANDING ORDER PROGRESS               │ │
│  │ Maria Santos   │  │  │ Day 0 ✓ | Day 3 ⏱ | Day 7 ⏳ | Day 14 ⏳│ │
│  │ 09189876543    │  │  │                                        │ │
│  │ ✅ Completed   │  │  │ HISTORY                                │ │
│  └────────────────┘  │  │ • Mar 9: Day 0 services completed      │ │
│                      │  │ • Mar 9: Prepaid ₱11,500               │ │
│  [Scrollable List]   │  │                                        │ │
│                      │  └────────────────────────────────────────┘ │
│                      │                                              │
│  Keyboard:           │  Keyboard:                                   │
│  ↑↓ Navigate         │  Tab: Next field                             │
│  Enter: Select       │  Shift+Tab: Previous field                   │
│  / Focus search      │  Esc: Cancel                                 │
└──────────────────────┴──────────────────────────────────────────────┘
```

**Key Improvements:**

- ✅ Resizable left panel (draggable splitter) for different monitor sizes
- ✅ Icon-only status badges on smaller screens (with tooltips)
- ✅ Optimized for 1366x768 minimum resolution
- ✅ Status text converts to icons when space is tight

**Key Benefits:**

- ✅ Reduces navigation clicks (no back/forward)
- ✅ Context always visible (patient list + details)
- ✅ Faster workflow (select patient → see details immediately)
- ✅ Optimized for 1920x1080 and 1366x768 monitors
- ✅ Keyboard navigation between panels (Tab/Shift+Tab)
- ✅ Mouse-friendly with large click targets

**Tablet/Mobile Layout (Optional - for management access):**

```
┌─────────────────────────┐
│ Top Navigation          │
├─────────────────────────┤
│                         │
│  Main Panel             │
│  (Full width)           │
│                         │
│  Tap to expand details  │
│                         │
└─────────────────────────┘
```

**Note**: Mobile/tablet support is secondary. Primary focus is desktop experience.

---

## Keyboard Navigation (Essential)

**Basic Navigation:**

- `↑` `↓` - Navigate patient list
- `Enter` - Select patient/submit form
- `Tab` - Next field
- `Shift + Tab` - Previous field
- `Esc` - Close modal/cancel action
- `/` - Focus search bar

**Why Limited Shortcuts:**
Browser shortcuts (Ctrl+N, Ctrl+T, Ctrl+D) conflict with native browser functions and behave inconsistently across browsers and operating systems. For now, we focus on basic keyboard navigation that works reliably everywhere.

**Future Enhancement:**
See FUTURE-IMPROVEMENTS.md for advanced keyboard shortcut system using Command Palette (Ctrl+K) or sequence-based shortcuts (e.g., "g then p" for "go to patients").

---

## Key UI Patterns for SureVax

### 1. Patient Search & Selection

**Pattern**: Instant search with keyboard navigation

```
┌─────────────────────────────────────────────────────┐
│ 🔍 Search patient (name, phone) [/]                 │
│ [Juan________________________________]               │
├─────────────────────────────────────────────────────┤
│ ► Juan Dela Cruz - 09171234567          [Selected]  │
│   Last visit: Mar 8, 2026                           │
│   Status: 🟡 Active PEP (Day 3 due)                 │
├─────────────────────────────────────────────────────┤
│   Juan Santos - 09189876543                         │
│   Last visit: Feb 15, 2026                          │
│   Status: ✅ Completed                               │
├─────────────────────────────────────────────────────┤
│   Juana Garcia - 09171112222                        │
│   Last visit: Jan 10, 2026                          │
│   Status: ⚠️ Overdue (Day 7)                        │
└─────────────────────────────────────────────────────┘

Keyboard: ↑↓ Navigate | Enter: Select | Esc: Clear
```

**Features:**

- Real-time search (no submit button)
- Keyboard navigation (↑↓ arrows)
- Show recent patients first
- Display status badges with icons
- Click or Enter to open in right panel
- Highlight selected row
- Auto-focus search on page load

---

### 2. Bundle Intake Form (Day 0)

**Pattern**: Single form that creates multiple records

**Design Principles:**

- ✅ One screen, no tabs
- ✅ Logical flow (top to bottom)
- ✅ Auto-calculate totals
- ✅ Show what will be created

```
┌─────────────────────────────────────────────────┐
│ NEW PATIENT - DAY 0 INTAKE                      │
├─────────────────────────────────────────────────┤
│                                                 │
│ PATIENT INFO                                    │
│ Name: [________________]  DOB: [__________]     │
│ Contact: [_____________]  Sex: [M] [F]          │
│                                                 │
│ BITE INCIDENT                                   │
│ Animal: [Dog ▼]  Category: [III ▼]             │
│ Date: [__________]  Location: [____________]    │
│                                                 │
│ SERVICES (Auto-selected for Category III)      │
│ ☑ Consultation                    ₱500.00      │
│ ☑ Wound Cleaning                  ₱300.00      │
│ ☑ ARV Dose 1 (Abhayrab)          ₱2,500.00    │
│ ☑ ERIG (Weight-based)             ₱8,000.00    │
│ ☑ Tetanus Toxoid                  ₱200.00      │
│                                                 │
│ FUTURE APPOINTMENTS (Auto-created)             │
│ • Day 3 (Mar 12): ARV Dose 2                   │
│ • Day 7 (Mar 16): ARV Dose 3                   │
│ • Day 14 (Mar 23): ARV Dose 4                  │
│                                                 │
│ PAYMENT                                         │
│ Total: ₱11,500.00                               │
│ Payment: [Prepay All ▼] [Cash ▼]               │
│                                                 │
│ [Cancel]              [Save & Print Receipt]    │
└─────────────────────────────────────────────────┘
```

**Key Features:**

- Auto-populate services based on bite category
- Show future appointments that will be created
- Prepayment option visible
- **Single UI form, atomic backend transaction**: Creates 1 patient + 1 encounter + 5 clinical orders + 1 transaction as one atomic operation
- **Tab order optimized** for fast data entry
- **Auto-calculate** totals as you type
- **Graceful error handling**: If payment fails, entire transaction rolls back

**Technical Note for AI:**
Build this as a single multi-step UI that submits one atomic JSON payload. Backend must handle as a strict database transaction - if any step fails, everything rolls back.

---

### 3. Daily Recall List

**Pattern**: Dashboard with actionable items

```
┌─────────────────────────────────────────────────┐
│ TODAY'S APPOINTMENTS - March 9, 2026            │
├─────────────────────────────────────────────────┤
│                                                 │
│ DUE TODAY (3)                                   │
│ ┌─────────────────────────────────────────────┐ │
│ │ Juan Dela Cruz - 09171234567                │ │
│ │ ARV Dose 2 (Day 3) - Prepaid ✓              │ │
│ │ [Mark Complete]                              │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ OVERDUE (1)                                     │
│ ┌─────────────────────────────────────────────┐ │
│ │ ⚠️ Maria Santos - 09189876543               │ │
│ │ ARV Dose 3 (Day 7) - Due: Mar 7             │ │
│ │ [Contact Patient] [Reschedule]              │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ UPCOMING (5)                                    │
│ • Pedro Garcia - ARV Dose 4 (Mar 10)           │
│ • Ana Lopez - ARV Dose 2 (Mar 11)              │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Key Features:**

- Color-coded status (🟢 green = due, 🔴 red = overdue, 🔵 blue = upcoming)
- Quick actions (mark complete, reschedule)
- Show payment status (prepaid vs. unpaid)
- SMS reminder button
- **Keyboard navigation**: ↑↓ to navigate, Enter to select
- **Click anywhere on row** to open patient details

---

### 4. Standing Order Progress View

**Pattern**: Visual timeline with status

```
┌─────────────────────────────────────────────────┐
│ RABIES PEP - CATEGORY III                       │
│ Patient: Juan Dela Cruz                         │
├─────────────────────────────────────────────────┤
│                                                 │
│ Day 0 (Mar 9) ✓ COMPLETED                       │
│ ├─ Consultation ✓                               │
│ ├─ Wound Cleaning ✓                             │
│ ├─ ARV Dose 1 ✓                                 │
│ ├─ ERIG ✓                                       │
│ └─ Tetanus Toxoid ✓                             │
│                                                 │
│ Day 3 (Mar 12) ⏱ DUE TODAY                      │
│ └─ ARV Dose 2 (Prepaid ✓)                      │
│    [Administer Now]                             │
│                                                 │
│ Day 7 (Mar 16) ⏳ UPCOMING                       │
│ └─ ARV Dose 3 (Prepaid ✓)                      │
│                                                 │
│ Day 14 (Mar 23) ⏳ UPCOMING                      │
│ └─ ARV Dose 4 (Prepaid ✓)                      │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Key Features:**

- Visual timeline (easy to scan)
- Status icons (✓ = done, ⏱ = due, ⏳ = upcoming, ⚠️ = overdue)
- Payment status visible
- Quick action buttons

---

### 5. Transaction Form

**Pattern**: Split payment support

```
┌─────────────────────────────────────────────────┐
│ NEW TRANSACTION                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│ SERVICES                                        │
│ ☑ ARV Dose 2                      ₱2,500.00    │
│ ☐ Consultation                    ₱500.00      │
│                                                 │
│ Subtotal:                         ₱2,500.00    │
│ Discount: [Senior Citizen ▼]     -₱500.00     │
│ VAT (12%):                        ₱240.00      │
│ Total:                            ₱2,240.00    │
│                                                 │
│ PAYMENT                                         │
│ Cash:        [₱2,000.00]                        │
│ GCash:       [₱240.00]                          │
│ Total Paid:  ₱2,240.00 ✓                        │
│                                                 │
│ [Cancel]              [Save & Print Receipt]    │
└─────────────────────────────────────────────────┘
```

**Key Features:**

- Multiple payment methods in one transaction
- Auto-calculate VAT and discounts
- Show running total
- Validate total paid = total amount

---

## Color Scheme (Healthcare-Appropriate)

**Primary Colors:**

- **Primary Blue**: `#2563EB` - Trust, professionalism
- **Success Green**: `#10B981` - Completed, healthy
- **Warning Orange**: `#F59E0B` - Due, attention needed
- **Danger Red**: `#EF4444` - Overdue, critical
- **Neutral Gray**: `#6B7280` - Secondary text

**Background:**

- **White**: `#FFFFFF` - Main background
- **Light Gray**: `#F9FAFB` - Panel backgrounds
- **Border Gray**: `#E5E7EB` - Borders, dividers

**Status Colors:**

- **Active**: Green badge
- **Due**: Orange badge
- **Overdue**: Red badge
- **Completed**: Gray badge
- **Prepaid**: Blue badge

---

## Typography

**Font Family**: Inter or System UI Stack

```css
font-family:
  -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
```

**Font Sizes:**

- **Headings**: 24px (bold)
- **Subheadings**: 18px (semibold)
- **Body**: 16px (regular)
- **Small**: 14px (regular)
- **Tiny**: 12px (for labels)

**Line Height**: 1.5 (for readability)

---

## Form Design Best Practices

### Input Fields

**Do:**

- ✅ Single column layout (easier to scan)
- ✅ Clear labels above fields
- ✅ Placeholder text for examples
- ✅ Auto-focus first field
- ✅ Tab order follows visual order
- ✅ Real-time validation
- ✅ Show error messages inline

**Don't:**

- ❌ Multi-column forms (confusing)
- ❌ Labels inside fields (accessibility issue)
- ❌ Too many required fields
- ❌ Validation only on submit

### Buttons

**Primary Action**: Blue, right-aligned

```html
<button class="bg-blue-600 text-white px-6 py-2 rounded">Save & Print Receipt</button>
```

**Secondary Action**: Gray, left-aligned

```html
<button class="bg-gray-200 text-gray-700 px-6 py-2 rounded">Cancel</button>
```

**Destructive Action**: Red

```html
<button class="bg-red-600 text-white px-6 py-2 rounded">Delete</button>
```

---

## Mobile Responsiveness (Secondary Priority)

**Note**: Primary access is desktop. Mobile support is for management/admin access only.

**Breakpoints:**

- **Desktop**: > 1024px (split screen - PRIMARY)
- **Tablet**: 640px - 1024px (single column with drawer)
- **Mobile**: < 640px (full screen, simplified)

**Desktop-Specific Optimizations:**

- Larger click targets not needed (mouse precision)
- Hover states for better feedback
- Tooltips on hover (not on touch)
- Right-click context menus
- Drag-and-drop support (future)
- Multi-select with Ctrl+Click (future)

---

## Accessibility (WCAG 2.1 AA)

**Requirements:**

- ✅ Color contrast ratio ≥ 4.5:1 for text
- ✅ Keyboard navigation support (critical for desktop)
- ✅ Screen reader friendly (ARIA labels)
- ✅ Focus indicators visible and clear
- ✅ Error messages descriptive
- ✅ Form labels properly associated
- ✅ Skip navigation links
- ✅ Keyboard shortcuts documented

**Desktop-Specific Accessibility:**

- Tab order follows visual layout
- Focus trap in modals
- Escape key closes modals
- Arrow keys for list navigation
- Enter/Space for activation

**Testing Tools:**

- Lighthouse (Chrome DevTools)
- axe DevTools
- WAVE browser extension
- Keyboard-only navigation testing

---

## Performance Targets

**Load Times:**

- First Contentful Paint: < 1.5s
- Time to Interactive: < 3s
- Largest Contentful Paint: < 2.5s

**Optimization:**

- Lazy load images
- Code splitting by route
- Minimize bundle size
- Use CDN for assets
- Cache API responses

---

## Implementation Roadmap

### Phase 1: Core UI (This Week)

1. Set up Vue 3 + Tailwind CSS
2. Install Radix-Vue (headless components)
3. Create base layout (split screen with resizable panels)
4. Implement patient search with keyboard navigation
5. Build basic CRUD forms with tab order optimization
6. Add icon-only status badges for small screens

### Phase 2: Advanced Features

1. Bundle intake form with auto-calculation and atomic transactions
2. Daily recall dashboard with keyboard navigation
3. Standing order progress view
4. Transaction form with split payment
5. Receipt printing
6. Draggable panel splitter for left/right layout

### Phase 3: Polish

1. Hover states and tooltips
2. Accessibility audit (keyboard-only testing)
3. Performance optimization
4. User testing with nurses
5. Refinements based on feedback
6. Optional: Basic mobile support for management

---

## Resources

**Component Libraries:**

- [Radix-Vue](https://www.radix-vue.com/) - Headless accessible components for Vue 3
- [NuxtUI](https://ui.nuxt.com/) - Pre-styled components built on Radix-Vue + Tailwind
- [Tailwind UI](https://tailwindui.com/) - Pre-built Tailwind components

**Why Headless Components:**

- No CSS conflicts with Tailwind
- Full styling control
- Better AI code generation (clear separation of logic and style)
- Accessibility built-in

**Healthcare UI Research:**

- [Gregory Schmidt - EHR Multi-Screen Design](https://www.gregoryschmidt.ca/writing/ehr-design-multi-screen-multi-tasking)
- [Healthcare UI Best Practices](https://www.eleken.co/blog-posts/user-interface-design-for-healthcare-applications)

**Form Design:**

- [Patient Intake Form Best Practices](https://www.314e.com/blog/patient-form-design-best-practices/)

---

## Next Steps

1. **Review this guide** with the team
2. **Set up Vue 3 + Tailwind + Radix-Vue**
3. **Create design mockups** for key screens
4. **Get nurse feedback** on mockups
5. **Start implementation** with Phase 1

---

## Tech Stack Rationale

**Why Vue 3 + Tailwind + Radix-Vue:**

- Vue 3 is maintainable and has excellent documentation
- Tailwind provides utility-first styling without CSS conflicts
- Radix-Vue gives accessible, headless components that work perfectly with Tailwind
- This combination is AI-friendly: clear patterns, well-documented, no CSS specificity wars
- Avoids niche libraries (Infermedica) with limited AI training data
- Avoids heavy component libraries (Element Plus, Vuetify) that fight with Tailwind

**Why NOT React:**
While React has more AI training data, Vue 3 is simpler to maintain long-term. The trade-off is worth it for a small team. If AI speed is absolutely critical, consider React + Tailwind + Shadcn/ui.

---

**Note**: This guide prioritizes speed and usability for desktop users. In a clinic setting, efficiency saves lives. Every second counts. Optimized tab order and keyboard navigation are critical for nurses who process dozens of patients daily.
