import PatientList from './components/PatientList'

/**
 * Patient list page (`/patients`) — secondary surface. The URL is the single
 * source of truth for "which patient": clicking a row navigates to the record
 * (`/patients/:id`) and "Register" navigates to `/patients/new`. No in-page
 * detail split or embedded form lives here anymore.
 */
export default function PatientsPage() {
  return (
    <div className="h-full">
      <PatientList />
    </div>
  )
}
