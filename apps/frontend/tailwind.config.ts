import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        // Typography identity (2026-06-12): Inter Variable for UI text,
        // JetBrains Mono Variable for facts (IDs, money, doses, times,
        // eyebrows). Both self-hosted via @fontsource-variable imports in
        // main.tsx. `font-mono` everywhere automatically picks this up —
        // don't hand-roll font-family in components.
        sans: ['Inter Variable', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: [
          'JetBrains Mono Variable',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      // ── Type scale, retuned 2026-07-26 for the 27" clinic display ──────
      //
      // A 2560-wide logical desktop across a 27" panel is ~109 CSS px per
      // inch, against the 96 px/inch the CSS pixel is defined at — so every
      // size rendered ~12% smaller than "standard", before accounting for
      // front-desk viewing distance being longer than a laptop's. And
      // `text-xs` is this app's dominant body size, not an accent: 796 uses
      // vs 537 for `text-sm`. Most text sat at the 12px floor on a display
      // that renders that floor at roughly a 10.6px equivalent.
      //
      // So the three dense steps move up ~1px each, line-heights with them
      // (leading matters as much as size for scanning). Deliberately scoped
      // to the dense end: `base` and the heading steps were already fine, and
      // leaving them stock keeps the scale recognisable.
      //
      // NOTE: `text-sm` no longer means Tailwind's stock 14px. That is the
      // intended trade — redefining the tokens moves all 1,333 call sites at
      // once without touching padding, so row density mostly survives. Do NOT
      // "fix" these back to stock values.
      fontSize: {
        // Sub-xs label size for kbd hints, badge micro-text, and dense
        // mono labels. The audit (2026-05-16) found 50+ instances of
        // `text-[10px]` and `text-[11px]` drifting across the codebase
        // — this token replaces them with a single canonical size.
        // Use ONLY for sub-body contexts. Don't reach for `text-2xs`
        // in body copy: `text-xs` is the floor for human-readable text.
        '2xs': ['0.6875rem', { lineHeight: '0.9375rem' }], // 11 / 15
        xs: ['0.8125rem', { lineHeight: '1.125rem' }], //     13 / 18
        sm: ['0.9375rem', { lineHeight: '1.375rem' }], //     15 / 22
      },
      maxWidth: {
        // AppShell content cap on very wide displays (27" 2560×1440 is the
        // primary clinic device). Pages get `max-w-screen-2xl 2xl:max-w-shell`
        // from the AppShell <Outlet> wrapper — don't re-cap per page.
        shell: '112.5rem',
      },
      colors: {
        // Brand hue comes from --primary in index.css — never hex here.
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        // Shadcn/ui CSS variable tokens
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
        // Clinical extensions — severity colors decoupled from --primary/--accent.
        // Use as `text-triage-overdue`, `bg-triage-due-soft`, `border-triage-ok/35`.
        triage: {
          overdue: 'hsl(var(--triage-overdue))',
          'overdue-soft': 'hsl(var(--triage-overdue-soft))',
          due: 'hsl(var(--triage-due))',
          'due-soft': 'hsl(var(--triage-due-soft))',
          ok: 'hsl(var(--triage-ok))',
          'ok-soft': 'hsl(var(--triage-ok-soft))',
          info: 'hsl(var(--triage-info))',
          'info-soft': 'hsl(var(--triage-info-soft))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
} satisfies Config
