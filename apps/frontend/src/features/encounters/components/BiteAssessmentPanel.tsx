/**
 * BiteAssessmentPanel — RHF panel that captures rabies bite-exposure data
 * into a JSONB-shaped object (target: `encounters.specialtyData`).
 *
 * Conditional rendering note: the parent encounter form should render this
 * panel only when `specialty === 'Rabies'`. The panel itself does not enforce
 * that — render it under the right branch in the parent.
 */

import { useFormContext, useWatch, type FieldPath, type FieldValues } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { AcronymHint } from '@/components/ui/acronym-hint'
import { cn } from '@/lib/utils'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { biteAssessmentSchema, type BiteAssessment } from '@surevax/shared'

// ── Re-exported constants (backward-compat for existing callers) ─────────────
export const WHO_CATEGORY_VALUES = ['I', 'II', 'III'] as const
export const ANIMAL_TYPE_VALUES = ['Dog', 'Cat', 'Bat', 'Monkey', 'Other'] as const
export const ANIMAL_STATUS_VALUES = ['Healthy', 'Sick', 'Dead', 'Unknown', 'Vaccinated'] as const
export const ARV_STATUS_VALUES = ['Vaccinated', 'NotVaccinated', 'Unknown'] as const
export const BRAIN_EXAM_VALUES = ['Positive', 'Negative', 'Pending', 'NotDone'] as const
export const ANIMAL_DISPOSITION_VALUES = [
  'Died',
  'UnderObservation',
  'Escaped',
  'Euthanized',
  'Released',
  'Unknown',
] as const
export const CIRCUMSTANCES_VALUES = ['Provoked', 'Unprovoked', 'Unknown'] as const

// Re-export under the same name so existing callers don't need updating.
export { biteAssessmentSchema }
export type { BiteAssessment }

const WHO_CATEGORY_DETAIL: Record<
  (typeof WHO_CATEGORY_VALUES)[number],
  { title: string; exposure: string; action: string }
> = {
  I: {
    title: 'Category I',
    exposure: 'Touching or feeding animals · licks on intact skin',
    action: 'No PEP required — wound care only',
  },
  II: {
    title: 'Category II',
    exposure: 'Nibbling of uncovered skin · minor scratches/abrasions without bleeding',
    action: 'ARV (active immunization) required',
  },
  III: {
    title: 'Category III',
    exposure:
      'Transdermal bites/scratches · contamination of mucous membrane or broken skin · contact with bats',
    action: 'ARV + RIG (rabies immunoglobulin) required',
  },
}

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

type Props<TFieldValues extends FieldValues = FieldValues> = {
  /**
   * Path within the parent form where this panel writes its values.
   * Defaults to `'specialtyData'` to match the `encounters.specialtyData` JSONB
   * column. Pass a nested path (e.g. `'encounter.specialtyData'`) when the
   * parent form nests the encounter under another key.
   */
  path?: FieldPath<TFieldValues>
}

export default function BiteAssessmentPanel<TFieldValues extends FieldValues = FieldValues>({
  path = 'specialtyData' as FieldPath<TFieldValues>,
}: Props<TFieldValues>) {
  const { control } = useFormContext<TFieldValues>()
  const base = path as string

  const animalType = useWatch({ control, name: `${base}.animalType` as FieldPath<TFieldValues> })
  const priorPep = useWatch({ control, name: `${base}.priorPep` as FieldPath<TFieldValues> })

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Bite assessment</h3>
        <p className="text-xs text-muted-foreground">
          Select the WHO exposure category to continue. The remaining details are optional at intake
          and can be completed when known.
        </p>
      </div>

      <section aria-labelledby="required-exposure-fields" className="space-y-3">
        <div>
          <h4
            id="required-exposure-fields"
            className="text-xs font-semibold uppercase tracking-wider"
          >
            Required to continue
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Classification determines the clinical pathway and whether RIG is indicated.
          </p>
        </div>

        {/* WHO exposure category — radio cards with full WHO copy.
            Cat III triggers RIG; UI nudges the clinician via the "action" line. */}
        <FormField
          control={control}
          name={`${base}.whoCategory` as FieldPath<TFieldValues>}
          render={({ field }) => {
            const current = field.value as string | undefined
            return (
              <FormItem>
                <FormLabel>
                  WHO exposure category <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <div role="radiogroup" aria-label="WHO exposure category" className="grid gap-2">
                    {WHO_CATEGORY_VALUES.map((c) => {
                      const detail = WHO_CATEGORY_DETAIL[c]
                      const selected = current === c
                      return (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => field.onChange(selected ? undefined : c)}
                          className={cn(
                            'rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            selected
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-border bg-card hover:bg-accent/40',
                          )}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold">{detail.title}</span>
                            <span
                              className={cn(
                                'text-xs font-medium',
                                c === 'III'
                                  ? 'text-destructive'
                                  : c === 'II'
                                    ? 'text-triage-due'
                                    : 'text-muted-foreground',
                              )}
                            >
                              {detail.action}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{detail.exposure}</p>
                        </button>
                      )
                    })}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )
          }}
        />
      </section>

      <section
        aria-labelledby="optional-exposure-fields"
        className="space-y-3 border-t border-border pt-4"
      >
        <div>
          <h4
            id="optional-exposure-fields"
            className="text-xs font-semibold uppercase tracking-wider"
          >
            Optional intake details
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Record what is available now; these details can be added later without interrupting
            care.
          </p>
        </div>

        {/* Animal type */}
        <FormField
          control={control}
          name={`${base}.animalType` as FieldPath<TFieldValues>}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Animal type</FormLabel>
              <FormControl>
                <select
                  className={SELECT_CLASS}
                  value={(field.value as string | undefined) ?? ''}
                  onChange={(e) => field.onChange(e.target.value || undefined)}
                >
                  <option value="">Select…</option>
                  {ANIMAL_TYPE_VALUES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Animal type — Other free text */}
        {animalType === 'Other' && (
          <FormField
            control={control}
            name={`${base}.animalTypeOther` as FieldPath<TFieldValues>}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Animal type (specify)</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. Mongoose"
                    value={(field.value as string | undefined) ?? ''}
                    onChange={(e) => field.onChange(e.target.value || undefined)}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    name={field.name}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Animal status + Exposure date */}
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={control}
            name={`${base}.animalStatus` as FieldPath<TFieldValues>}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Animal status</FormLabel>
                <FormControl>
                  <select
                    className={SELECT_CLASS}
                    value={(field.value as string | undefined) ?? ''}
                    onChange={(e) => field.onChange(e.target.value || undefined)}
                  >
                    <option value="">Select…</option>
                    {ANIMAL_STATUS_VALUES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name={`${base}.exposureDate` as FieldPath<TFieldValues>}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Exposure date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    value={(field.value as string | undefined) ?? ''}
                    onChange={(e) => field.onChange(e.target.value || undefined)}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    name={field.name}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <details className="rounded-md border border-border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Add animal and exposure details
          </summary>
          <p className="mt-1 text-xs text-muted-foreground">
            Animal history, wound details and prior PEP are optional at intake.
          </p>

          <div className="mt-4 space-y-4">
            {/* Animal Profile */}
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Animal profile
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={control}
                name={`${base}.animalArvStatus` as FieldPath<TFieldValues>}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ARV status</FormLabel>
                    <FormControl>
                      <select
                        className={SELECT_CLASS}
                        value={(field.value as string | undefined) ?? ''}
                        onChange={(e) => field.onChange(e.target.value || undefined)}
                      >
                        <option value="">Select…</option>
                        {ARV_STATUS_VALUES.map((s) => (
                          <option key={s} value={s}>
                            {s === 'NotVaccinated' ? 'Not vaccinated' : s}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name={`${base}.brainExamResult` as FieldPath<TFieldValues>}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brain exam</FormLabel>
                    <FormControl>
                      <select
                        className={SELECT_CLASS}
                        value={(field.value as string | undefined) ?? ''}
                        onChange={(e) => field.onChange(e.target.value || undefined)}
                      >
                        <option value="">Select…</option>
                        {BRAIN_EXAM_VALUES.map((s) => (
                          <option key={s} value={s}>
                            {s === 'NotDone' ? 'Not done' : s}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={control}
              name={`${base}.animalOwnerName` as FieldPath<TFieldValues>}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Owner name"
                      value={(field.value as string | undefined) ?? ''}
                      onChange={(e) => field.onChange(e.target.value || undefined)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      name={field.name}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name={`${base}.animalDisposition` as FieldPath<TFieldValues>}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Disposition</FormLabel>
                  <FormControl>
                    <select
                      className={SELECT_CLASS}
                      value={(field.value as string | undefined) ?? ''}
                      onChange={(e) => field.onChange(e.target.value || undefined)}
                    >
                      <option value="">Select…</option>
                      {ANIMAL_DISPOSITION_VALUES.map((s) => (
                        <option key={s} value={s}>
                          {s === 'UnderObservation' ? 'Under observation' : s}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Wound site */}
            <FormField
              control={control}
              name={`${base}.woundSite` as FieldPath<TFieldValues>}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Wound site</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. right forearm"
                      value={(field.value as string | undefined) ?? ''}
                      onChange={(e) => field.onChange(e.target.value || undefined)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      name={field.name}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Exposure time + Circumstances */}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={control}
                name={`${base}.exposureTime` as FieldPath<TFieldValues>}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Exposure time</FormLabel>
                    <FormControl>
                      <Input
                        type="time"
                        value={(field.value as string | undefined) ?? ''}
                        onChange={(e) => field.onChange(e.target.value || undefined)}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name={`${base}.circumstances` as FieldPath<TFieldValues>}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Circumstances</FormLabel>
                    <FormControl>
                      <select
                        className={SELECT_CLASS}
                        value={(field.value as string | undefined) ?? ''}
                        onChange={(e) => field.onChange(e.target.value || undefined)}
                      >
                        <option value="">Select…</option>
                        {CIRCUMSTANCES_VALUES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Checkboxes */}
            <div className="flex flex-col gap-2 pt-1">
              <FormField
                control={control}
                name={`${base}.washedWithSoap` as FieldPath<TFieldValues>}
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={Boolean(field.value)}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                    </FormControl>
                    <Label className="cursor-pointer text-sm font-normal">
                      Washed with soap and water
                    </Label>
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name={`${base}.priorPep` as FieldPath<TFieldValues>}
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={Boolean(field.value)}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                    </FormControl>
                    <Label className="cursor-pointer text-sm font-normal">
                      Prior post-exposure prophylaxis (<AcronymHint term="PEP">PEP</AcronymHint>)
                    </Label>
                  </FormItem>
                )}
              />
            </div>

            {/* Conditional prior PEP details */}
            {priorPep === true && (
              <FormField
                control={control}
                name={`${base}.priorPepDetails` as FieldPath<TFieldValues>}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Prior <AcronymHint term="PEP">PEP</AcronymHint> details
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Vaccine brand, doses given, dates, completing facility…"
                        rows={3}
                        value={(field.value as string | undefined) ?? ''}
                        onChange={(e) => field.onChange(e.target.value || undefined)}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>
        </details>
      </section>
    </div>
  )
}
