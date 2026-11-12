import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Checkbox } from '@/components/ui/checkbox'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ComingSoonButton } from '@/components/layout'
import { useAuth } from '../context'
import { useState } from 'react'
import { AlertCircle, Eye, EyeOff, Loader2, TriangleAlert } from 'lucide-react'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'
import { useSafeForm } from '@/lib/useSafeForm'

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})
type LoginFields = z.infer<typeof loginSchema>

/**
 * Validates a returnTo value against open-redirect attacks.
 * Only accepts paths that start with "/" and do NOT start with "//"
 * (which would resolve as a protocol-relative URL to an external host).
 */
function safeReturnTo(value: string | null): string | null {
  if (!value) return null
  if (value.startsWith('/') && !value.startsWith('//')) return value
  return null
}

export default function LoginPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)

  const form = useSafeForm<LoginFields>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const { isSubmitting } = form.formState

  async function onSubmit(values: LoginFields) {
    setServerError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          ...STANDARD_API_HEADERS,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ ...values, rememberMe }),
      })
      const data = await res.json()
      if (!res.ok) {
        setServerError(data.error ?? 'Incorrect email or password.')
        return
      }
      setUser(data.user)
      const roleDest = data.user?.role === 'Branch' ? '/branch/kiosk' : '/patients'
      const returnTo = safeReturnTo(searchParams.get('returnTo'))
      const dest = returnTo ?? roleDest
      setFadeOut(true)
      setTimeout(() => navigate(dest, { replace: true }), 200)
    } catch (err) {
      setServerError(
        err instanceof TypeError
          ? 'Unable to reach the server. Check your connection and try again.'
          : 'Something went wrong. Please try again.',
      )
    }
  }

  return (
    <div
      className={`absolute inset-0 grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] bg-background transition-opacity duration-200 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
    >
      {/* Skip nav */}
      <a
        href="#login-form"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-primary text-primary-foreground px-4 py-2 rounded z-50"
      >
        Skip to login form
      </a>

      {/* Brand panel — dark */}
      <div
        className="hidden lg:flex flex-col items-center justify-center bg-foreground text-primary-foreground relative overflow-hidden"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      >
        {/* Fade vignette so dots recede toward the edges */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,hsl(var(--foreground))_100%)]" />

        {/* Logo mark */}
        <div className="relative flex flex-col items-center gap-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-foreground text-foreground text-xl font-bold shadow-lg">
            SV
          </div>
          <span className="font-semibold text-lg tracking-tight opacity-90">SureVax</span>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-8 lg:p-12 overflow-y-auto">
        <TooltipProvider>
          <div className="w-full max-w-[23.75rem]" id="login-form" tabIndex={-1}>
            <div className="mb-8">
              {/* Mobile logo — visible only on small screens */}
              <div className="flex items-center gap-2 mb-6 lg:hidden">
                <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary text-primary-foreground text-2xs font-bold">
                  SV
                </div>
                <span className="font-semibold text-sm tracking-tight">SureVax</span>
              </div>

              <h1 className="text-2xl font-semibold tracking-[-0.02em]">Sign in</h1>
              <p className="mt-1 text-sm text-muted-foreground">to your SureVax account</p>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          autoFocus
                          {...field}
                          onChange={(e) => {
                            field.onChange(e)
                            setServerError(null)
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Password</FormLabel>
                        <ComingSoonButton
                          size="sm"
                          className="h-auto px-0 py-0 text-xs border-0 shadow-none bg-transparent hover:bg-transparent"
                        >
                          Forgot password?
                        </ComingSoonButton>
                      </div>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="current-password"
                            className="pr-9"
                            {...field}
                            onChange={(e) => {
                              field.onChange(e)
                              setServerError(null)
                            }}
                            onKeyDown={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                            onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-r-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </FormControl>
                      {capsLock && (
                        <p className="flex items-center gap-1.5 text-xs text-triage-due mt-1">
                          <TriangleAlert size={12} aria-hidden="true" />
                          Caps Lock is on
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember-me"
                    checked={rememberMe}
                    onCheckedChange={(v) => setRememberMe(v === true)}
                  />
                  <label
                    htmlFor="remember-me"
                    className="text-sm text-muted-foreground select-none cursor-pointer"
                  >
                    Remember me
                  </label>
                </div>

                {serverError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2.5"
                  >
                    <AlertCircle
                      size={15}
                      className="mt-[1px] shrink-0 text-destructive"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-destructive leading-snug">{serverError}</p>
                  </div>
                )}

                <Button type="submit" className="w-full h-10 gap-2 mt-6" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 size={15} className="animate-spin" />}
                  {isSubmitting ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>
            </Form>

            {/*
              Google SSO stub — deliberately BELOW the email form.
              It used to be the first, full-width, visually dominant control on
              the screen, with the only working path ("or continue with email")
              framed as the fallback beneath it. Nothing here is wired, so the
              hierarchy pointed every new user at a dead end.
            */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <div>
              <ComingSoonButton
                className="w-full h-10"
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                }
              >
                Sign in with Google
              </ComingSoonButton>
            </div>

            <p className="mt-8 text-center text-xs text-muted-foreground/60">
              © {new Date().getFullYear()} SureVax
            </p>
          </div>
        </TooltipProvider>
      </div>
    </div>
  )
}
