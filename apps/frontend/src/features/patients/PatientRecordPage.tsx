import { useParams } from 'react-router-dom'
import PatientDetailHeader from './components/PatientDetailHeader'
import PatientDetail from './components/PatientDetail'

/**
 * Full-page patient record reached via search (`/patients/:id`). The URL is the
 * single source of truth for "which patient". Renders the record header
 * (persistent search switcher + Edit + next-dose banner) above the unchanged
 * `PatientDetail` body. No `onBack` prop — PatientDetail's internal navigate
 * fallback handles back.
 */
export default function PatientRecordPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="h-full flex flex-col">
      <PatientDetailHeader patientId={id!} />
      <PatientDetail patientId={id!} />
    </div>
  )
}
