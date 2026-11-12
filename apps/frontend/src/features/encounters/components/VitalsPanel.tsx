import { useFormContext, type FieldValues, type Path } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { encounterVitalsSchema, type EncounterVitals } from '@surevax/shared'

// Re-export under the legacy name so existing callers don't need updating.
export { encounterVitalsSchema as vitalsSchema }
export type VitalsValues = EncounterVitals

/**
 * Compute BMI = weight (kg) / (height (m))²
 * Returns null when weight or height is missing/non-positive.
 */
export function computeBmi(
  weightKg: number | undefined,
  heightCm: number | undefined,
): number | null {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return null
  const heightM = heightCm / 100
  const bmi = weightKg / (heightM * heightM)
  if (!Number.isFinite(bmi)) return null
  return bmi
}

type Props<TForm extends FieldValues> = {
  /**
   * Dotted path into the parent form where vitals live.
   * Defaults to `clinicalNotes.vitals`.
   *
   * The parent form must be wrapped in `<Form {...form}>` (FormProvider) so
   * this panel can read context — no `control` prop is required.
   */
  fieldPath?: Path<TForm>
}

const FIELDS: ReadonlyArray<{
  key: keyof VitalsValues
  label: string
  unit: string
  step: string
}> = [
  { key: 'bpSystolic', label: 'BP systolic', unit: 'mmHg', step: '1' },
  { key: 'bpDiastolic', label: 'BP diastolic', unit: 'mmHg', step: '1' },
  { key: 'heartRate', label: 'Heart rate', unit: 'bpm', step: '1' },
  { key: 'respiratoryRate', label: 'Respiratory rate', unit: 'rpm', step: '1' },
  { key: 'temperatureC', label: 'Temperature', unit: '°C', step: '0.1' },
  { key: 'spo2', label: 'SpO₂', unit: '%', step: '1' },
  { key: 'weightKg', label: 'Weight', unit: 'kg', step: '0.1' },
  { key: 'heightCm', label: 'Height', unit: 'cm', step: '0.1' },
]

/**
 * Reusable vitals capture panel. Reads/writes via the parent RHF context.
 *
 * Numeric inputs round-trip through `valueAsNumber` so Zod sees real numbers
 * (not strings). Empty input becomes `undefined`.
 */
export default function VitalsPanel<TForm extends FieldValues = FieldValues>({
  fieldPath = 'clinicalNotes.vitals' as Path<TForm>,
}: Props<TForm>) {
  const form = useFormContext<TForm>()

  // Watch weight/height to derive live BMI display.
  const weightPath = `${fieldPath}.weightKg` as Path<TForm>
  const heightPath = `${fieldPath}.heightCm` as Path<TForm>
  const weight = form.watch(weightPath) as number | undefined
  const height = form.watch(heightPath) as number | undefined

  const bmi = computeBmi(weight, height)
  const bmiDisplay = bmi === null ? '—' : bmi.toFixed(1)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {FIELDS.map(({ key, label, unit, step }) => {
        const name = `${fieldPath}.${key}` as Path<TForm>
        return (
          <FormField
            key={key}
            control={form.control}
            name={name}
            render={({ field }) => {
              const raw = field.value as number | undefined
              return (
                <FormItem>
                  <FormLabel>
                    {label} <span className="text-muted-foreground">({unit})</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step={step}
                      value={raw ?? ''}
                      onChange={(e) => {
                        const v = e.target.valueAsNumber
                        field.onChange(Number.isNaN(v) ? undefined : v)
                      }}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )
            }}
          />
        )
      })}

      {/* Computed BMI — read-only, derived from weight + height */}
      <FormItem>
        <FormLabel>
          BMI <span className="text-muted-foreground">(kg/m²)</span>
        </FormLabel>
        <FormControl>
          <Input value={bmiDisplay} readOnly disabled aria-label="Computed BMI" />
        </FormControl>
      </FormItem>
    </div>
  )
}
