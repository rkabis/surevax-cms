import { Settings } from 'lucide-react'
import ComingSoon from '@/components/ComingSoon'

export default function SettingsPage() {
  return (
    <ComingSoon
      title="Settings"
      description="Clinic configuration, branch management, roles, and integrations"
      icon={Settings}
      phase="Phase 2"
    />
  )
}
