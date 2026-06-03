// Server component — force-dynamic prevents static prerender
// Supabase keys are only available at request time, not build time
export const dynamic = 'force-dynamic'

import AppPage from '@/components/AppPage'

export default function Page() {
  return <AppPage />
}
