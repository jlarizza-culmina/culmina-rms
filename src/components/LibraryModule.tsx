'use client'
import { useState } from 'react'
import type { Location } from '@/lib/types'
import IngredientLibrary from './IngredientLibrary'
import ServiceWareLibrary from './ServiceWareLibrary'

interface Props {
  userId: string
  restaurantId?: string
  locations: Location[]
}

type LibTab = 'ingredients' | 'serviceware'

export default function LibraryModule({ userId, restaurantId, locations }: Props) {
  const [tab, setTab] = useState<LibTab>('ingredients')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top-level tab bar */}
      <div className="bg-white border-b border-[--border] px-6 flex gap-0 flex-shrink-0">
        <button onClick={() => setTab('ingredients')}
          className={`px-4 py-3 text-xs font-medium border-b-2 transition-colors ${tab === 'ingredients' ? 'border-[--accent] text-[--accent]' : 'border-transparent text-[--muted] hover:text-[--text]'}`}>
          📦 Ingredients & Vendors
        </button>
        <button onClick={() => setTab('serviceware')}
          className={`px-4 py-3 text-xs font-medium border-b-2 transition-colors ${tab === 'serviceware' ? 'border-[--accent] text-[--accent]' : 'border-transparent text-[--muted] hover:text-[--text]'}`}>
          🍽 Service Ware
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'ingredients' && (
          <IngredientLibrary userId={userId} />
        )}
        {tab === 'serviceware' && (
          <ServiceWareLibrary userId={userId} restaurantId={restaurantId} locations={locations} />
        )}
      </div>
    </div>
  )
}
