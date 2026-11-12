import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCreateBiteIncident } from '../api'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import PatientPicker from '@/components/forms/PatientPicker'
import { useSafeForm } from '@/lib/useSafeForm'

const SPECIES = ['Dog', 'Cat', 'Bat', 'Monkey', 'Other'] as const
const VACCINATION_STATUS = ['Vaccinated', 'NotVaccinated', 'Unknown'] as const
const EXPOSURE_CATEGORIES = ['I', 'II', 'III'] as const

const schema = z.object({
  patientId: z.string().min(1, 'Patient is required'),
  incidentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .min(1, 'Incident date is required'),
  species: z.enum(SPECIES),
  animalVaccinationStatus: z.enum(VACCINATION_STATUS),
  exposureCategory: z.enum(EXPOSURE_CATEGORIES),
  biteSite: z.string().min(1, 'Bite site is required'),
  animalAgeMonths: z.coerce.number().int().min(0).max(600).optional().nullable(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultPatientId?: string
}

export default function CaptureIncidentDialog({ open, onOpenChange, defaultPatientId }: Props) {
  const createMutation = useCreateBiteIncident()

  const form = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      patientId: defaultPatientId ?? '',
      incidentDate: new Date().toISOString().slice(0, 10),
      species: 'Dog',
      animalVaccinationStatus: 'Unknown',
      exposureCategory: 'III',
      biteSite: '',
      animalAgeMonths: null,
    },
  })

  function onSubmit(values: FormValues) {
    createMutation.mutate(
      {
        patientId: values.patientId,
        incidentDate: values.incidentDate,
        species: values.species,
        animalVaccinationStatus: values.animalVaccinationStatus,
        exposureCategory: values.exposureCategory,
        biteSite: values.biteSite,
        animalAgeMonths: values.animalAgeMonths ?? null,
      },
      {
        onSuccess: () => {
          form.reset()
          onOpenChange(false)
          toast.success('Bite incident recorded', {
            description: 'Day-14 observation followup has been auto-created.',
          })
        },
        onError: (err) => {
          toast.error('Failed to capture bite incident', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[35rem] xl:max-w-[42.5rem]">
        <DialogHeader>
          <DialogTitle>Record bite incident</DialogTitle>
          <DialogDescription>
            Log a new animal bite incident and select the exposure category. A Day-14 observation
            followup will be auto-created.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="patientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Patient <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <PatientPicker value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="incidentDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Incident date <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="species"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Species <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select species" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SPECIES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="exposureCategory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Exposure category <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {EXPOSURE_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            Category {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="animalVaccinationStatus"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Animal vaccination status <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Vaccinated">Vaccinated</SelectItem>
                      <SelectItem value="NotVaccinated">Not vaccinated</SelectItem>
                      <SelectItem value="Unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="biteSite"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Bite site <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Right forearm, Left hand" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="animalAgeMonths"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Animal age (months)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      placeholder="Optional"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value === '' ? null : Number(e.target.value))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving…' : 'Record incident'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
