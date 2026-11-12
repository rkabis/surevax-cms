import { Thermometer } from 'lucide-react'
import ComingSoon from '@/components/ComingSoon'

export default function ColdChainPage() {
  return (
    <ComingSoon
      title="Cold chain"
      description="Temperature monitoring for vaccine storage"
      icon={Thermometer}
      phase="Phase 3"
    />
  )
}
