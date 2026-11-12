// M7 from the 2026-05-23 360 codebase review: every RHF form was calling
// `useForm()` with the default `mode: 'onSubmit'`, so users had to submit
// before seeing per-field errors. `'onTouched'` validates after the user
// blurs each field — friendlier for clinical workflows where staff blur
// through 10+ fields per encounter form.
//
// Drop-in replacement: `import { useSafeForm } from '@/lib/useSafeForm'`
// and pass the same options as `useForm`. Override `mode` per-call if a
// surface genuinely needs onSubmit semantics (e.g. dry-run preview forms
// where touching a field shouldn't immediately surface errors).

import { useForm, type FieldValues, type UseFormProps, type UseFormReturn } from 'react-hook-form'

export function useSafeForm<TFieldValues extends FieldValues = FieldValues, TContext = unknown>(
  props?: UseFormProps<TFieldValues, TContext>,
): UseFormReturn<TFieldValues, TContext> {
  return useForm<TFieldValues, TContext>({
    mode: 'onTouched',
    ...props,
  })
}
