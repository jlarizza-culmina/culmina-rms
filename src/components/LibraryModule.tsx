'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Location, LibraryIngredient, Vendor } from '@/lib/types'
import IngredientLibrary from './IngredientLibrary'
import ServiceWareLibrary from './ServiceWareLibrary'

interface Props {
  userId: string
  restaurantId?: string
  locations: Location[]
}

type LibTab = 'ingredients' | 'serviceware'

export default function LibraryModule({ userId, restaurantId, locations }: Props) {
  const supabase = createClient()
  const [tab,      setTab]     = useState<LibTab>('ingredients')
  const [library,  setLibrary] = useState<LibraryIngredient[]>([])
  const [vendors,  setVendors] = useState<Vendor[]>([])

  const loadLibraryData = useCallback(async () => {
    const [{ data: lib }, { data: ven }] = await Promise.all([
      supabase.from('ingredient_library').select('*').eq('user_id', userId).eq('is_active', true).order('name'),
      supabase.from('vendors').select('*').eq('user_id', userId).eq('is_active', true).order('name'),
    ])
    setLibrary(lib ?? [])
    setVendors(ven ?? [])
  }, [userId, supabase])

  useEffect(() => { loadLibraryData() }, [loadLibraryData])

  return (
    <div className="flex flex-col h-full overflow-hidden">
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
          <IngredientLibrary
            userId={userId}
            vendors={vendors}
            library={library}
            onLibraryChange={loadLibraryData}
            onVendorsChange={loadLibraryData}
          />
        )}
        {tab === 'serviceware' && (
          <ServiceWareLibrary userId={userId} restaurantId={restaurantId} locations={locations} />
        )}
      </div>
    </div>
  )
}
