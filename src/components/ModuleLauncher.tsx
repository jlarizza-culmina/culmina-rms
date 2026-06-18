'use client'
import type { AppModule } from '@/lib/types'
import type { AppContext } from './AppShell'

interface Props {
  ctx: AppContext
  onNavigate: (module: AppModule, title?: string) => void
  canSeeCosting: boolean
  isAdmin: boolean
}

interface ModuleCard {
  module: AppModule
  icon: string
  label: string
  description: string
  color: string
  stat?: string
  requiresAdmin?: boolean
  requiresCosting?: boolean
  requiresSuperAdmin?: boolean
}

const MODULES: ModuleCard[] = [
  {
    module: 'recipes',
    icon: '🍳',
    label: 'Recipes',
    description: 'Your full recipe library',
    color: '#C05A2A',
  },
  {
    module: 'menus',
    icon: '📄',
    label: 'Menus',
    description: 'Manage menu versions',
    color: '#7A4F6D',
  },
  {
    module: 'production',
    icon: '📋',
    label: 'Production',
    description: 'Planning, schedule, tasks & labels',
    color: '#2E6B25',
  },
  {
    module: 'queue',
    icon: '🪑',
    label: 'Queue',
    description: 'Waitlist & guests',
    color: '#C05A2A',
  },
  {
    module: 'library',
    icon: '📦',
    label: 'Library',
    description: 'Ingredients & vendors',
    color: '#8B6914',
  },
  {
    module: 'analytics',
    icon: '📊',
    label: 'Analytics',
    description: 'Costs & margins',
    color: '#5C3A6B',
    requiresCosting: true,
  },
  {
    module: 'haccp',
    icon: '🌡',
    label: 'HACCP',
    description: 'Temperature logs & compliance',
    color: '#2E6B25',
  },
  {
    module: 'inventory',
    icon: '📦',
    label: 'Inventory',
    description: 'Par levels, receiving & batches',
    color: '#8B6914',
  },
  {
    module: 'settings',
    icon: '⚙️',
    label: 'Settings',
    description: 'Restaurant, staff & roles',
    color: '#7A7568',
    requiresAdmin: true,
  },
  {
    module: 'superadmin',
    icon: '🛡',
    label: 'Admin',
    description: 'Manage all clients',
    color: '#C03030',
    requiresSuperAdmin: true,
  },
]

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  chef: 'Chef',
  manager: 'Manager',
  foh: 'Front of House',
}

const DISH_MODE_LABELS: Record<string, string> = {
  single: 'Single-recipe dishes',
  composed: 'Composed dishes',
}

export default function ModuleLauncher({ ctx, onNavigate, canSeeCosting, isAdmin }: Props) {
  const greeting = getGreeting()
  const name = ctx.currentUser.display_name || 'Chef'

  const visibleModules = MODULES.filter(m => {
    if (m.requiresSuperAdmin && !ctx.isSuperAdmin) return false
    if (m.requiresAdmin && !isAdmin) return false
    if (m.requiresCosting && !canSeeCosting) return false
    return true
  })

  return (
    <div className="min-h-full px-6 py-8 max-w-4xl mx-auto">

      {/* Greeting */}
      <div className="mb-8">
        <h1 className="font-serif text-2xl font-medium text-[--text] mb-1">
          {greeting}, {name}.
        </h1>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-[--muted]">
            {ctx.restaurant.name}
            {ctx.location && ` · ${ctx.location.name}`}
          </span>
          <span className="text-[11px] text-[--hint] bg-[--surface-2] px-2 py-0.5 rounded-full border border-[--border]">
            {ROLE_LABELS[ctx.role] ?? ctx.role}
          </span>
          <span className="text-[11px] text-[--hint] bg-[--surface-2] px-2 py-0.5 rounded-full border border-[--border]">
            {DISH_MODE_LABELS[ctx.restaurant.dish_mode] ?? ctx.restaurant.dish_mode}
          </span>
        </div>
      </div>

      {/* Module grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {visibleModules.map(m => (
          <button
            key={m.module}
            onClick={() => onNavigate(m.module, m.label)}
            disabled={false}
            className="group relative bg-white rounded-2xl border border-[--border] p-5 text-left transition-all hover:border-[--border-2] hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
          >
            {/* Coming soon badge removed - menus now live */}

            {/* Icon */}
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl mb-3 transition-transform group-hover:scale-105"
              style={{ background: `${m.color}18`, border: `1px solid ${m.color}30` }}
            >
              {m.icon}
            </div>

            {/* Label */}
            <div className="font-medium text-sm text-[--text] mb-0.5">{m.label}</div>
            <div className="text-[11px] text-[--muted] leading-snug">{m.description}</div>

            {/* Stat */}
            {m.stat && (
              <div className="mt-2 text-[11px] font-medium" style={{ color: m.color }}>{m.stat}</div>
            )}
          </button>
        ))}
      </div>

      {/* Powered by footer */}
      <div className="mt-10 text-center text-[10px] text-[--hint]">
        Powered by <span className="font-medium">CulminaRMS</span>
      </div>
    </div>
  )
}

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 10) return 'Good morning'
  if (h < 14) return 'Good afternoon'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
