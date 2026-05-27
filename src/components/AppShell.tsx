'use client'
import { useEffect, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'
import type { AppUser, Restaurant, Location, RestaurantMember, AppModule, UserRole } from '@/lib/types'
import OnboardingWizard from './OnboardingWizard'
import ModuleLauncher from './ModuleLauncher'
import RecipeApp from './RecipeApp'
import IngredientLibrary from './IngredientLibrary'
import ProductionPlanner from './ProductionPlanner'
import TMinusSchedule from './TMinusSchedule'
import AnalyticsModule from './AnalyticsModule'
import SettingsPage from './SettingsPage'
import SuperAdmin from './SuperAdmin'

interface Props { user: User }

export interface AppContext {
  restaurant: Restaurant
  location: Location | null
  locations: Location[]
  currentUser: AppUser
  role: UserRole
  isSuperAdmin: boolean
}

export default function AppShell({ user }: Props) {
  const supabase = createClient()

  // ── Context state ──────────────────────────────────────────
  const [appUser,     setAppUser]     = useState<AppUser | null>(null)
  const [restaurant,  setRestaurant]  = useState<Restaurant | null>(null)
  const [locations,   setLocations]   = useState<Location[]>([])
  const [member,      setMember]      = useState<RestaurantMember | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [module,      setModule]      = useState<AppModule>('home')
  const [moduleTitle,  setModuleTitle]  = useState('')
  const [subPageTitle, setSubPageTitle] = useState('')

  // ── Load context ───────────────────────────────────────────
  const loadContext = useCallback(async () => {
    setLoading(true)

    // Load app_user profile
    const { data: userData } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', user.id)
      .single()

    // Upsert if missing (first login)
    if (!userData) {
      const { data: newUser } = await supabase
        .from('app_users')
        .upsert({ id: user.id, display_name: user.email?.split('@')[0] ?? '' })
        .select()
        .single()
      if (newUser) setAppUser(newUser)
    } else {
      setAppUser(userData)
    }

    // Load restaurant membership
    const { data: memberData } = await supabase
      .from('restaurant_members')
      .select('*, restaurants(*)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (memberData?.restaurants) {
      setMember(memberData)
      setRestaurant(memberData.restaurants as unknown as Restaurant)

      // Load locations
      const { data: locData } = await supabase
        .from('locations')
        .select('*')
        .eq('restaurant_id', memberData.restaurant_id)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })

      setLocations(locData ?? [])
    }

    setLoading(false)
  }, [user.id, supabase])

  useEffect(() => { loadContext() }, [loadContext])

  // ── After onboarding completes ─────────────────────────────
  // RPC already created the member row and migrated recipes
  const handleOnboardingComplete = useCallback(async (
    newRestaurant: Restaurant,
    newLocation: Location
  ) => {
    setRestaurant(newRestaurant)
    setLocations([newLocation])
    setMember({ id: '', restaurant_id: newRestaurant.id, user_id: user.id, role: 'admin', is_active: true })
    setModule('home')
  }, [user.id])

  // ── Navigate to a module ───────────────────────────────────
  function navigate(m: AppModule, title = '') {
    setModule(m)
    setModuleTitle(title)
    setSubPageTitle('')
    window.scrollTo(0, 0)
  }

  const signOut = () => supabase.auth.signOut()

  // ── Loading ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[--bg]">
        <div className="text-center">
          <div className="spinner mx-auto mb-3"
            style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-2)', width: 20, height: 20 }} />
          <p className="text-xs text-[--hint]">Loading your kitchen…</p>
        </div>
      </div>
    )
  }

  // ── Onboarding ─────────────────────────────────────────────
  if (!restaurant) {
    return (
      <OnboardingWizard
        user={user}
        appUser={appUser}
        onComplete={handleOnboardingComplete}
      />
    )
  }

  // ── Apply branding CSS variables ────────────────────────────
  const brandColor = restaurant.branding?.primaryColor ?? '#C05A2A'
  function darken(hex: string): string {
    const n = parseInt(hex.slice(1), 16)
    const f = (v: number) => Math.max(0, v - 26).toString(16).padStart(2,'0')
    return '#' + f(n>>16) + f((n>>8)&0xff) + f(n&0xff)
  }

  // ── Build context object ───────────────────────────────────
  const ctx: AppContext = {
    restaurant,
    location: locations.find(l => l.is_primary) ?? locations[0] ?? null,
    locations,
    currentUser: appUser ?? { id: user.id, display_name: user.email ?? '', avatar_url: '', is_super_admin: false },
    role: (member?.role ?? 'chef') as UserRole,
    isSuperAdmin: appUser?.is_super_admin ?? false,
  }

  // Role helpers
  const canSeeCosting = ['super_admin','admin','chef','manager'].includes(ctx.role)
  const isAdmin       = ['super_admin','admin'].includes(ctx.role)

  // ── Top bar ────────────────────────────────────────────────
  const BrandStyle = () => restaurant.branding?.primaryColor ? (
    <style>{`
      :root {
        --accent: ${brandColor};
        --accent-dark: ${darken(brandColor)};
        --accent-light: ${brandColor}18;
      }
    `}</style>
  ) : null

  const TopBar = () => (
    <header className="h-12 bg-white border-b border-[--border] flex items-center px-4 gap-2 flex-shrink-0 z-10">
      {module === 'home' ? (
        <div className="flex items-center gap-2">
          {restaurant.branding?.logoUrl ? (
            <img src={restaurant.branding.logoUrl} alt="Logo" className="h-6 w-auto" />
          ) : (
            <div className="w-6 h-6 rounded bg-[--accent] flex items-center justify-center text-white text-[10px] font-bold">
              {restaurant.name.charAt(0)}
            </div>
          )}
          <span className="font-serif text-sm font-medium text-[--text]">
            {restaurant.branding?.displayName ?? restaurant.name}
          </span>
        </div>
      ) : (
        <nav className="flex items-center gap-1.5 text-xs min-w-0">
          <button onClick={() => navigate('home')}
            className="text-[--muted] hover:text-[--text] transition-colors flex-shrink-0 flex items-center gap-1">
            <span>⌂</span><span className="hidden sm:inline">Home</span>
          </button>
          {moduleTitle && (<>
            <span className="text-[--hint]">›</span>
            {subPageTitle ? (
              <button onClick={() => setSubPageTitle('')}
                className="text-[--muted] hover:text-[--text] transition-colors truncate max-w-[120px]">
                {moduleTitle}
              </button>
            ) : (
              <span className="text-[--text] font-medium truncate max-w-[200px]">{moduleTitle}</span>
            )}
          </>)}
          {subPageTitle && (<>
            <span className="text-[--hint] flex-shrink-0">›</span>
            <span className="text-[--text] font-medium truncate max-w-[200px]">{subPageTitle}</span>
          </>)}
        </nav>
      )}

      <div className="ml-auto flex items-center gap-3">
        {locations.length > 1 && (
          <select className="text-xs border border-[--border-2] rounded-lg px-2 py-1 bg-white text-[--text] outline-none">
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <span className="text-xs text-[--muted] hidden sm:inline">
          {ctx.currentUser.display_name || user.email}
        </span>
        <button onClick={signOut} className="text-[11px] text-[--hint] hover:text-[--muted] underline">
          Sign out
        </button>
      </div>
    </header>
  )

  // ── Super admin ────────────────────────────────────────────
  if (module === 'superadmin' && ctx.isSuperAdmin) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <BrandStyle />
        <TopBar />
        <div className="flex-1 overflow-hidden">
          <SuperAdmin onBack={() => navigate('home')} />
        </div>
      </div>
    )
  }

  // ── Settings ───────────────────────────────────────────────
  if (module === 'settings') {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <BrandStyle />
        <TopBar />
        <div className="flex-1 overflow-hidden">
          <SettingsPage
            ctx={ctx}
            userId={user.id}
            onRestaurantUpdate={r => setRestaurant(r)}
            onLocationsUpdate={l => setLocations(l)}
          />
        </div>
      </div>
    )
  }

  // ── Module launcher (home) ─────────────────────────────────
  if (module === 'home') {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-[--bg]">
        <BrandStyle />
        <TopBar />
        <div className="flex-1 overflow-auto">
          <ModuleLauncher
            ctx={ctx}
            onNavigate={navigate}
            canSeeCosting={canSeeCosting}
            isAdmin={isAdmin}
          />
        </div>
      </div>
    )
  }

  // ── Recipe module ──────────────────────────────────────────
  if (module === 'recipes') {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <BrandStyle />
        <TopBar />
        <div className="flex-1 overflow-hidden">
          <RecipeApp
            user={user}
            restaurantId={restaurant.id}
            ctx={ctx}
          />
        </div>
      </div>
    )
  }

  // ── Library ────────────────────────────────────────────────
  if (module === 'library') {
    // Library needs vendors + library data — pass userId for now (legacy compat)
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <TopBar />
        <div className="flex-1 overflow-hidden flex flex-col">
          <IngredientLibrary
            userId={user.id}
            vendors={[]}
            library={[]}
            onLibraryChange={() => {}}
            onVendorsChange={() => {}}
          />
        </div>
      </div>
    )
  }

  // ── Production ─────────────────────────────────────────────
  if (module === 'production') {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <TopBar />
        <div className="flex-1 overflow-hidden flex flex-col">
          <ProductionPlanner recipes={[]} library={[]} vendors={[]} userId={user.id} />
        </div>
      </div>
    )
  }

  // ── Schedule ───────────────────────────────────────────────
  if (module === 'schedule') {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <TopBar />
        <div className="flex-1 overflow-hidden flex flex-col">
          <TMinusSchedule recipes={[]} userId={user.id} />
        </div>
      </div>
    )
  }

  // ── Analytics ──────────────────────────────────────────────
  if (module === 'analytics') {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <BrandStyle />
        <TopBar />
        <div className="flex-1 overflow-hidden flex flex-col">
          <AnalyticsModule userId={user.id} restaurantId={restaurant.id} />
        </div>
      </div>
    )
  }

  return null
}
