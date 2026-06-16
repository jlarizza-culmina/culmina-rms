// src/lib/audit.ts
// Application-layer audit logging. See Culmina Audit Log Spec (Gap 9).
//
// The audit_log table is append-only and INSERT-only at the RLS level, so this
// module uses a SERVICE_ROLE client (server-side only — never import from a
// client component). audit() never throws: a logging failure must never
// interrupt the user's operation.
import { createClient } from '@supabase/supabase-js'

// Sensitive fields that are NEVER written to the audit log, even if passed in.
const REDACTED_FIELDS = ['pin', 'access_token', 'password', 'phone'] as const

export interface AuditParams {
  restaurantId: string
  locationId?: string
  actor: {
    id: string
    name: string
    email?: string
    role: string
    location: string
  }
  action: string // e.g. 'recipe.update'
  resourceType: string // e.g. 'recipe'
  resourceId?: string
  resourceName?: string
  oldValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  metadata?: Record<string, unknown>
  ipAddress?: string
}

// Returns a shallow copy of the object with sensitive keys removed.
// Returns undefined unchanged so we don't write empty {} into nullable columns.
function strip(
  values: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!values) return values
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if ((REDACTED_FIELDS as readonly string[]).includes(key)) continue
    clean[key] = value
  }
  return clean
}

/**
 * Insert one row into audit_log. NEVER throws — failures are logged to
 * console.error and swallowed so logging can't interrupt the caller.
 */
export async function audit(params: AuditParams): Promise<void> {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error } = await supabaseAdmin.from('audit_log').insert({
      restaurant_id: params.restaurantId,
      location_id: params.locationId ?? null,
      actor_id: params.actor.id,
      actor_name: params.actor.name,
      actor_email: params.actor.email ?? null,
      actor_role: params.actor.role,
      actor_location: params.actor.location,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId ?? null,
      resource_name: params.resourceName ?? null,
      old_values: strip(params.oldValues) ?? null,
      new_values: strip(params.newValues) ?? null,
      metadata: strip(params.metadata) ?? null,
      ip_address: params.ipAddress ?? null,
    })

    if (error) throw error
  } catch (err) {
    console.error('audit() failed:', err)
  }
}

/**
 * Identical to audit(), but named to make intent explicit at call sites for
 * security-critical actions (user.login, role.permissions_update,
 * staff.app_revoke, data_deletion.executed) that must be persisted before the
 * response is sent. audit() already awaits its insert internally, so this is a
 * thin pass-through.
 */
export async function auditSync(params: AuditParams): Promise<void> {
  await audit(params)
}
