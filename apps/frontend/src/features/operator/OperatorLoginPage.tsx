import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, Eye, EyeOff, Loader2, Shield } from 'lucide-react'
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
import { useAuth } from '@/features/auth/context'
import { operatorLogin, OperatorLoginErr } from './operatorApi'
import { useSafeForm } from '@/lib/useSafeForm'

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
  mfaToken: z.string().optional(),
})
type LoginFields = z.infer<typeof loginSchema>

export default function OperatorLoginPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [mfaStep, setMfaStep] = useState(false)

  const form = useSafeForm<LoginFields>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', mfaToken: '' },
  })

  const { isSubmitting } = form.formState

  async function onSubmit(values: LoginFields) {
    setServerError(null)
    try {
      const payload = {
        email: values.email,
        password: values.password,
        ...(values.mfaToken ? { mfaToken: values.mfaToken } : {}),
      }
      const data = await operatorLogin(payload)
      setUser({
        id: data.user.id,
        email: data.user.email,
        firstName: data.user.displayName,
        lastName: '',
        role: 'PlatformAdmin',
        branchId: null,
        isPlatformAdmin: true,
      })
      navigate('/operator', { replace: true })
    } catch (err) {
      if (err instanceof OperatorLoginErr) {
        if (err.code === 'MFA_REQUIRED') {
          setMfaStep(true)
          setServerError(null)
          return
        }
        if (err.code === 'MFA_INVALID') {
          setMfaStep(true)
          setServerError('Invalid MFA code. Try again with a fresh code from your authenticator.')
          form.setValue('mfaToken', '')
          return
        }
        setServerError('Invalid email or password.')
        return
      }
      setServerError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    }
  }

  return (
    <div className="absolute inset-0 grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] bg-background">
      {/* Brand panel */}
      <div
        className="hidden lg:flex flex-col items-center justify-center bg-foreground text-primary-foreground relative overflow-hidden"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,hsl(var(--foreground))_100%)]" />
        <div className="relative flex flex-col items-center gap-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-foreground text-foreground shadow-lg">
            <Shield size={28} aria-hidden="true" />
          </div>
          <span className="font-semibold text-lg tracking-tight opacity-90">
            SureVax Operator Console
          </span>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-8 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-[23.75rem]">
          <div className="mb-8">
            {/* Mobile logo */}
            <div className="flex items-center gap-2 mb-6 lg:hidden">
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary text-primary-foreground">
                <Shield size={14} aria-hidden="true" />
              </div>
              <span className="font-semibold text-sm tracking-tight">SureVax Operator</span>
            </div>

            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Operator sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Platform administration console</p>
          </div>

          {/* MFA banner */}
          <div className="mb-6 flex items-start gap-2.5 rounded-md border border-yellow-500/30 bg-yellow-500/8 px-3 py-2.5">
            <AlertCircle
              size={15}
              className="mt-[1px] shrink-0 text-yellow-600"
              aria-hidden="true"
            />
            <p className="text-sm text-yellow-700 leading-snug">
              MFA required before production use — currently development only.
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Email <span className="text-destructive">*</span>
                    </FormLabel>
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
                    <FormLabel>
                      Password <span className="text-destructive">*</span>
                    </FormLabel>
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
                    <FormMessage />
                  </FormItem>
                )}
              />

              {mfaStep && (
                <FormField
                  control={form.control}
                  name="mfaToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Authenticator code <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          placeholder="6-digit code"
                          autoFocus
                          className="font-mono tabular-nums tracking-widest"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e.target.value.replace(/\D/g, ''))
                            setServerError(null)
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                      <p className="text-xs text-muted-foreground">
                        Enter the code from your authenticator app.
                      </p>
                    </FormItem>
                  )}
                />
              )}

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
                {isSubmitting
                  ? mfaStep
                    ? 'Verifying…'
                    : 'Signing in…'
                  : mfaStep
                    ? 'Verify code'
                    : 'Sign in'}
              </Button>
            </form>
          </Form>

          <p className="mt-8 text-center text-xs text-muted-foreground/60">
            © {new Date().getFullYear()} SureVax
          </p>
        </div>
      </div>
    </div>
  )
}
