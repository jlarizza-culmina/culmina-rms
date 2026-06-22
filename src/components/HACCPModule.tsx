'use client'
// src/components/HACCPModule.tsx
// HACCP compliance: daily temperature logging + corrective action tracking.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import type { HACCPEquipment, TemperatureLog, CorrectiveAction } from '@/lib/types'

interface Props {
  userId?: string
  restaurantId?: string
  locationId?: string
  locationName?: string
}

type HACCPTab = 'log' | 'corrective' | 'receiving' | 'cooking' | 'plan'
type LogSlot  = 'opening' | 'closing'
type StatusFilter = 'all' | 'open' | 'resolved'
type DeliveryType = 'standard' | 'contract_kitchen'

const SLOT_LABELS: Record<LogSlot, string> = { opening: 'Opening', closing: 'Closing' }

interface ReceivingLog {
  id: string
  location_id: string
  supplier_name: string
  delivery_type: DeliveryType
  received_at: string
  received_by: string
  notes: string
  overall_compliant: boolean | null
  created_at: string
}
interface ReceivingLine {
  id?: string
  receiving_log_id: string
  library_id: string | null
  item_name: string
  temp_checked: boolean
  temp_value: number | null
  temp_unit: string
  critical_limit: number | null
  is_compliant: boolean | null
  accepted: boolean
  rejection_reason: string
  batch_id: string
  expiry_date: string | null
  notes: string
}
interface DeliveryLine {
  item_name: string
  library_id: string | null
  temp_checked: boolean
  temp_value: string
  critical_limit: string
  accepted: boolean
  rejection_reason: string
  batch_id: string
  expiry_date: string
  notes: string
}
interface DeliveryDraft {
  received_by: string
  supplier_name: string
  delivery_type: DeliveryType
  received_at: string
  notes: string
  lines: DeliveryLine[]
}
const blankRecvLine = (): DeliveryLine => ({ item_name: '', library_id: null, temp_checked: true, temp_value: '', critical_limit: '41', accepted: true, rejection_reason: '', batch_id: '', expiry_date: '', notes: '' })

interface CookingLog {
  id: string
  location_id: string
  item_name: string
  recipe_id: string | null
  cook_method: string
  target_temp: number | null
  internal_temp: number
  cook_time_minutes: number | null
  batch_description: string
  recorded_by: string
  is_compliant: boolean
  notes: string
  recorded_at: string
}
const COOK_METHODS: { value: string; label: string; target: number | null }[] = [
  { value: 'reheating',        label: 'Reheating (165°F)', target: 165 },
  { value: 'hot_hold',         label: 'Hot Hold (140°F+)', target: 140 },
  { value: 'sous_vide_verify', label: 'Sous Vide Check',   target: 145 },
  { value: 'stovetop',         label: 'Stovetop',          target: null },
  { value: 'oven',             label: 'Oven',              target: null },
  { value: 'other',            label: 'Other',             target: null },
]
const COOK_METHOD_LABELS: Record<string, string> = { reheating: 'Reheating', hot_hold: 'Hot Hold', sous_vide_verify: 'Sous Vide Check', stovetop: 'Stovetop', oven: 'Oven', other: 'Other' }

function todayStr(): string { return new Date().toISOString().split('T')[0] }
function dateOf(iso: string): string { return iso.split('T')[0] }
function nowLocalDatetime(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
// A line is compliant when its temp is within the critical limit (or no temp was checked).
function recvLineCompliant(l: DeliveryLine): boolean {
  if (!l.temp_checked) return true
  const t = parseFloat(l.temp_value), lim = parseFloat(l.critical_limit)
  if (isNaN(t) || isNaN(lim)) return true
  return t <= lim
}

function printTempLog(
  logs: TemperatureLog[],
  equipment: HACCPEquipment[],
  locationName: string,
  dateFrom: string,
  dateTo: string
) {
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  })

  const rows = logs.map(log => {
    const eq = equipment.find(e => e.id === log.equipment_id)
    const compliant = log.is_compliant
    const tempCell = compliant === false
      ? `<span class="nc">${log.temp_value}°${log.temp_unit} ✗</span>`
      : `<span class="ok">${log.temp_value}°${log.temp_unit} ✓</span>`
    return `<tr>
      <td>${fmtDate(log.recorded_at)}</td>
      <td>${log.log_slot ?? '—'}</td>
      <td>${eq?.name ?? '—'}</td>
      <td>${tempCell}</td>
      <td>${log.recorded_by ?? '—'}</td>
      <td>${log.notes ?? ''}</td>
    </tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head>
    <title>Temperature Log</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 10px; margin: 20px; }
      h2 { font-size: 13px; margin-bottom: 2px; }
      p.meta { font-size: 9px; color: #555; margin-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f0ede8; text-align: left; padding: 3px 6px;
           font-size: 8px; text-transform: uppercase;
           border-bottom: 2px solid #ccc; }
      td { padding: 3px 6px; border-bottom: 1px solid #eee; }
      tr:nth-child(even) { background: #fafafa; }
      .nc { color: #c0392b; font-weight: bold; }
      .ok { color: #27ae60; }
      .footer { font-size: 8px; color: #999; margin-top: 16px; }
      @media print { body { margin: 0; } }
    </style></head><body>
    <h2>Temperature Log</h2>
    <p class="meta">${locationName} · ${dateFrom} – ${dateTo} ·
    Generated ${new Date().toLocaleDateString()}</p>
    <table>
      <thead><tr>
        <th>Date</th><th>Slot</th><th>Equipment</th>
        <th>Temp</th><th>Recorded By</th><th>Notes</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No logs for this period</td></tr>'}</tbody>
    </table>
    <p class="footer">
      CT DPH requirement: temperature logs retained 90 days minimum.<br/>
      Non-compliant readings shown in red. Each requires a corrective action.
    </p>
    </body></html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close(); w.print() }
}

function printReceivingLog(
  logs: ReceivingLog[],
  linesByLog: Record<string, ReceivingLine[]>,
  locationName: string,
  dateFrom: string,
  dateTo: string
) {
  const fmt = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const typeLabel = (t: string) => t === 'contract_kitchen' ? 'Contract Kitchen' : 'Standard'
  const rows = logs.flatMap(log => (linesByLog[log.id] ?? []).map(ln => {
    const bad = ln.is_compliant === false || !ln.accepted
    return `<tr style="${bad ? 'color:#c0392b' : ''}">
      <td>${fmt(log.received_at)}</td><td>${log.supplier_name || '—'}</td><td>${typeLabel(log.delivery_type)}</td>
      <td${!ln.accepted ? ' style="text-decoration:line-through"' : ''}>${ln.item_name}</td>
      <td>${ln.temp_checked && ln.temp_value != null ? `${ln.temp_value}°F` : '—'}</td>
      <td>${ln.critical_limit != null ? `${ln.critical_limit}°F` : '—'}</td>
      <td>${ln.is_compliant === false ? '✗' : '✓'}</td>
      <td>${ln.accepted ? 'Yes' : 'No'}</td>
      <td>${ln.batch_id || '—'}</td>
      <td>${ln.notes || ''}</td>
    </tr>`
  })).join('')
  const html = `<!DOCTYPE html><html><head><title>Receiving Log</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 10px; margin: 20px; }
      h2 { font-size: 13px; margin-bottom: 2px; }
      p.meta { font-size: 9px; color: #555; margin-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f0ede8; text-align: left; padding: 3px 6px; font-size: 8px; text-transform: uppercase; border-bottom: 2px solid #ccc; }
      td { padding: 3px 6px; border-bottom: 1px solid #eee; }
      .footer { font-size: 8px; color: #999; margin-top: 16px; }
      @media print { body { margin: 0; } }
    </style></head><body>
    <h2>Receiving Log</h2>
    <p class="meta">${locationName} · ${dateFrom} – ${dateTo} · Generated ${new Date().toLocaleDateString()}</p>
    <table>
      <thead><tr>
        <th>Date</th><th>Supplier</th><th>Type</th><th>Item</th><th>Temp</th><th>Limit</th><th>Compliant</th><th>Accepted</th><th>Batch ID</th><th>Notes</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="10">No receiving logs for this period</td></tr>'}</tbody>
    </table>
    <p class="footer">HACCP Receiving Log · ${locationName} · ${dateFrom} – ${dateTo}<br/>CT DPH requirement: receiving logs retained 90 days.</p>
    </body></html>`
  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close(); w.print() }
}

function printCookingLog(logs: CookingLog[], locationName: string, dateFrom: string, dateTo: string) {
  const fmt = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const rows = logs.map(l => `<tr style="${l.is_compliant ? '' : 'color:#c0392b'}">
      <td>${fmt(l.recorded_at)}</td><td>${l.item_name}</td><td>${COOK_METHOD_LABELS[l.cook_method] ?? l.cook_method}</td>
      <td>${l.target_temp != null ? `${l.target_temp}°F` : '—'}</td><td>${l.internal_temp}°F</td>
      <td>${l.is_compliant ? '✓' : '✗'}</td><td>${l.batch_description || '—'}</td><td>${l.recorded_by || '—'}</td><td>${l.notes || ''}</td>
    </tr>`).join('')
  const html = `<!DOCTYPE html><html><head><title>Cooking Log</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 10px; margin: 20px; }
      h2 { font-size: 13px; margin-bottom: 2px; }
      p.meta { font-size: 9px; color: #555; margin-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f0ede8; text-align: left; padding: 3px 6px; font-size: 8px; text-transform: uppercase; border-bottom: 2px solid #ccc; }
      td { padding: 3px 6px; border-bottom: 1px solid #eee; }
      .footer { font-size: 8px; color: #999; margin-top: 16px; }
      @media print { body { margin: 0; } }
    </style></head><body>
    <h2>Cooking / Reheating Log</h2>
    <p class="meta">${locationName} · ${dateFrom} – ${dateTo} · Generated ${new Date().toLocaleDateString()}</p>
    <table>
      <thead><tr>
        <th>Date/Time</th><th>Item</th><th>Method</th><th>Target</th><th>Actual</th><th>Compliant</th><th>Batch desc</th><th>By</th><th>Notes</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="9">No cooking logs for this period</td></tr>'}</tbody>
    </table>
    <p class="footer">HACCP Cooking/Reheating Log · ${locationName} · ${dateFrom} – ${dateTo}<br/>Corrective actions required for all non-compliant entries.</p>
    </body></html>`
  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close(); w.print() }
}

// ── HACCP plan types + seed data ──────────────────────────────
// CONFIRMED SCHEMA:
//   haccp_plans: id, location_id, title, effective_date, version, status,
//     plan_data (jsonb — holds the section text), generated_by, reviewed_by,
//     reviewed_at, created_at, updated_at
//   haccp_plan_ccps: id, plan_id, sort_order, step_name, hazard, critical_limits,
//     monitoring_procedure, corrective_actions, verification, records_kept
interface PlanData {
  facility_description: string
  menu_hazard_analysis: string
  monitoring_overview: string
  corrective_action_procedures: string
  verification_procedures: string
  record_keeping: string
}
const EMPTY_PLAN_DATA: PlanData = {
  facility_description: '', menu_hazard_analysis: '', monitoring_overview: '',
  corrective_action_procedures: '', verification_procedures: '', record_keeping: '',
}
interface HaccpPlan {
  id: string
  location_id: string
  title: string
  effective_date: string | null
  version: number
  status: 'draft' | 'active' | 'archived'
  plan_data: PlanData
  generated_by: string
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}
interface HaccpCCP {
  id?: string
  plan_id?: string
  sort_order: number
  step_name: string
  hazard: string
  critical_limits: string
  monitoring_procedure: string
  corrective_actions: string
  verification: string
  records_kept: string
}

const CCP_SEED: HaccpCCP[] = [
  { sort_order: 1, step_name: 'Cold Storage', hazard: 'Bacterial growth in refrigerated storage', critical_limits: 'All refrigerated items maintained at ≤41°F (5°C)', monitoring_procedure: 'Manual temperature check of all refrigeration units twice daily (opening and closing)', corrective_actions: 'Adjust unit, relocate product to compliant unit, discard if held above 41°F for more than 2 hours', verification: 'Review temperature logs weekly. Calibrate thermometers monthly.', records_kept: 'Temperature logs (Culmina) — retained 90 days' },
  { sort_order: 2, step_name: 'Receiving — General Deliveries', hazard: 'Receiving food at unsafe temperature', critical_limits: 'Cold food ≤41°F upon arrival. Frozen food: solid, no visible thaw.', monitoring_procedure: 'Check temperature of each cold delivery with calibrated thermometer before acceptance', corrective_actions: 'Reject delivery if temperature exceeds limit. Document rejection in receiving log.', verification: 'Review receiving logs weekly.', records_kept: 'HACCP receiving log (Culmina) — 90 days' },
  { sort_order: 3, step_name: 'Receiving — Contract Kitchen / Sous Vide', hazard: 'Receiving pre-cooked product at unsafe temp or with missing batch documentation', critical_limits: '≤41°F on arrival. Batch ID present on label.', monitoring_procedure: 'Verify temperature and batch ID for each contract kitchen delivery before acceptance', corrective_actions: 'Reject if temperature non-compliant or batch ID missing. Log rejection.', verification: 'Cross-reference batch IDs with contract kitchen production records monthly.', records_kept: 'HACCP receiving log with batch IDs — 90 days' },
  { sort_order: 4, step_name: 'Hot Holding During Service', hazard: 'Bacterial growth in food held for service', critical_limits: 'All hot-held items maintained at ≥140°F (60°C)', monitoring_procedure: 'Temperature check every 2 hours during service', corrective_actions: 'Reheat to 165°F within 2 hours or discard if held below 140°F', verification: 'Review cooking/hot hold logs weekly.', records_kept: 'HACCP cooking log (Culmina) — 90 days' },
  { sort_order: 5, step_name: 'Cooling of Cooked Items', hazard: 'Pathogen growth during improper cooling', critical_limits: 'Cool from 140°F to 70°F within 2 hours, then from 70°F to 41°F within 4 additional hours', monitoring_procedure: 'Check temperature at 2-hour and 6-hour marks after removing from heat', corrective_actions: 'Discard if cooling rate not achieved. Log discard with reason.', verification: 'Review corrective action logs weekly.', records_kept: 'Temperature logs and corrective actions — 90 days' },
  { sort_order: 6, step_name: 'Prepared Batch Shelf Life Management', hazard: 'Pathogen growth in prepared items held beyond safe shelf life', critical_limits: 'All prepared items consumed or discarded before USE BY date/time on HACCP label', monitoring_procedure: 'Daily review of prepared batch inventory in Culmina. Visual check each shift.', corrective_actions: 'Immediately discard any item past USE BY. Log discard: item, qty, date, who discarded.', verification: 'Batch discard log reviewed weekly by chef.', records_kept: 'Prepared batch log (Culmina) — 90 days. Corrective action log — 1 year.' },
]

const PLAN_MONITORING_OVERVIEW = 'All monitoring is performed by the manager on duty or designated trained staff. Records are maintained in Culmina restaurant management software and available on demand.'
const PLAN_CORRECTIVE_PROCEDURES = 'When a critical limit is not met, the manager on duty takes immediate corrective action, removes the affected product from service if necessary, and documents the action in the Culmina corrective action log.'
const PLAN_VERIFICATION_PROCEDURES = 'The manager reviews all HACCP logs weekly. Thermometers are calibrated monthly. The HACCP plan is reviewed annually or when the menu changes significantly.'
const PLAN_RECORD_KEEPING = 'The following records are maintained in Culmina and available for inspection: temperature logs (90 days), receiving logs (90 days), cooking logs (90 days), corrective action logs (1 year), prepared batch logs (90 days).'
const PLAN_MENU_HAZARD = 'Menu consists of crostini, pasta (reheated), charcuterie, cheese, and bar program. Pre-cooked proteins are received from a licensed contract kitchen. Key biological hazards include temperature abuse during cold storage, receiving, hot holding, and cooling. No raw protein cooking on premises.'
function planFacilityText(restaurant: string, address: string): string {
  return `${restaurant} is an Italian caffetteria and aperitivo bar located at ${address || '[address]'}. The operation does not include on-site cooking of raw proteins (no Type I hood). Primary food handling includes: cold prep, reheating of pre-cooked items, hot holding during service, and prepared batch production.`
}

type PlanSectionKey = keyof PlanData
const PLAN_SECTIONS: { key: PlanSectionKey; label: string }[] = [
  { key: 'facility_description',          label: 'Facility description' },
  { key: 'menu_hazard_analysis',         label: 'Menu & hazard analysis' },
  { key: 'monitoring_overview',          label: 'Monitoring procedures overview' },
  { key: 'corrective_action_procedures', label: 'Corrective action procedures' },
  { key: 'verification_procedures',      label: 'Verification procedures' },
  { key: 'record_keeping',               label: 'Record keeping' },
]
type CcpFieldKey = 'step_name' | 'hazard' | 'critical_limits' | 'monitoring_procedure' | 'corrective_actions' | 'verification' | 'records_kept'
const CCP_FIELDS: { key: CcpFieldKey; label: string }[] = [
  { key: 'hazard',               label: 'Hazard' },
  { key: 'critical_limits',      label: 'Critical limits' },
  { key: 'monitoring_procedure', label: 'Monitoring procedure' },
  { key: 'corrective_actions',   label: 'Corrective actions' },
  { key: 'verification',         label: 'Verification' },
  { key: 'records_kept',         label: 'Records kept' },
]

function printHACCPPlan(plan: HaccpPlan, ccps: HaccpCCP[], locationName: string, restaurantName: string) {
  const d = (s: string | null) => s ? new Date(s + (s.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'
  const esc = (s: string) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const ccpBlocks = ccps.map((c, i) => `
    <div class="ccp">
      <h4>CCP ${i + 1}: ${esc(c.step_name)}</h4>
      <table class="ccp-t"><tbody>
        <tr><th>Hazard</th><td>${esc(c.hazard)}</td></tr>
        <tr><th>Critical limits</th><td>${esc(c.critical_limits)}</td></tr>
        <tr><th>Monitoring procedure</th><td>${esc(c.monitoring_procedure)}</td></tr>
        <tr><th>Corrective actions</th><td>${esc(c.corrective_actions)}</td></tr>
        <tr><th>Verification</th><td>${esc(c.verification)}</td></tr>
        <tr><th>Records kept</th><td>${esc(c.records_kept)}</td></tr>
      </tbody></table>
    </div>`).join('')
  const html = `<!DOCTYPE html><html><head><title>HACCP Plan</title>
    <style>
      @page { size: letter; margin: 0.75in; }
      body { font-family: Georgia, serif; font-size: 11px; color: #1a1a1a; line-height: 1.5; }
      h1 { font-size: 18px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 20px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
      h4 { font-size: 12px; margin: 12px 0 4px; } .meta { font-size: 10px; color: #555; }
      .sig { margin-top: 14px; font-size: 11px; } .sig div { margin-bottom: 8px; }
      table.ccp-t { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
      .ccp-t th { text-align: left; width: 150px; vertical-align: top; padding: 3px 8px; background: #f0ede8; border: 1px solid #ddd; font-size: 10px; }
      .ccp-t td { padding: 3px 8px; border: 1px solid #ddd; }
      .ccp { page-break-inside: avoid; }
      p { white-space: pre-wrap; }
    </style></head><body>
    <h1>${esc(restaurantName)} — HACCP Plan</h1>
    <div class="meta">Location: ${esc(locationName)}</div>
    <div class="meta">Effective date: ${d(plan.effective_date)} · Version: ${plan.version}</div>
    <div class="meta">Prepared by: ${esc(plan.generated_by) || '—'}</div>
    <div class="meta">Reviewed by: ${esc(plan.reviewed_by ?? '') || '—'}${plan.reviewed_at ? ` on ${d(plan.reviewed_at)}` : ''}</div>
    <div class="sig">
      <div>Manager signature: ________________________  Date: __________</div>
      <div>Owner signature:&nbsp;&nbsp;&nbsp;________________________  Date: __________</div>
    </div>
    <h2>Section 1: Facility Description</h2><p>${esc(plan.plan_data.facility_description)}</p>
    <h2>Section 2: Menu and Hazard Analysis</h2><p>${esc(plan.plan_data.menu_hazard_analysis)}</p>
    <h2>Section 3: Critical Control Points</h2>${ccpBlocks}
    <h2>Section 4: Monitoring Procedures</h2><p>${esc(plan.plan_data.monitoring_overview)}</p>
    <h2>Section 5: Corrective Action Procedures</h2><p>${esc(plan.plan_data.corrective_action_procedures)}</p>
    <h2>Section 6: Verification Procedures</h2><p>${esc(plan.plan_data.verification_procedures)}</p>
    <h2>Section 7: Record Keeping</h2><p>${esc(plan.plan_data.record_keeping)}</p>
    </body></html>`
  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close(); w.print() }
}

export default function HACCPModule({ restaurantId, locationId, locationName }: Props) {
  const supabase = createClient()
  const [tab, setTab] = useState<HACCPTab>('log')

  // ── Equipment + log state ─────────────────────────────────────
  const [equipment, setEquipment] = useState<HACCPEquipment[]>([])
  const [loading,   setLoading]   = useState(true)
  const [activeSlot, setActiveSlot] = useState<LogSlot | null>(null)
  const [entries,    setEntries]    = useState<Record<string, { temp: string; notes: string }>>({})
  const [recordedBy, setRecordedBy] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [summary,    setSummary]    = useState<
    { slot: LogSlot; compliant: number; nonCompliant: number; ncNames: string[]; correctiveCount: number } | null
  >(null)
  const [recentLogs, setRecentLogs] = useState<TemperatureLog[]>([])
  const [printFrom, setPrintFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0] })
  const [printTo,   setPrintTo]   = useState(() => todayStr())

  // ── Corrective action state ───────────────────────────────────
  const [actions,    setActions]    = useState<CorrectiveAction[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionDraft, setActionDraft] = useState<Record<string, string>>({})

  // ── Receiving state ───────────────────────────────────────────
  const [receivingLogs,  setReceivingLogs]  = useState<ReceivingLog[]>([])
  const [receivingLines, setReceivingLines] = useState<Record<string, ReceivingLine[]>>({})
  const [expandedRecvId, setExpandedRecvId] = useState<string | null>(null)
  const [delivery,       setDelivery]       = useState<DeliveryDraft | null>(null)
  const [parTemplate,    setParTemplate]    = useState<{ library_id: string; name: string }[]>([])
  const [recvPrintFrom,  setRecvPrintFrom]  = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0] })
  const [recvPrintTo,    setRecvPrintTo]    = useState(() => todayStr())

  // ── Cooking state ─────────────────────────────────────────────
  const [cookingLogs, setCookingLogs] = useState<CookingLog[]>([])
  const [recipes,     setRecipes]     = useState<{ id: string; name: string }[]>([])
  const [cookDraft,   setCookDraft]   = useState<{ item_name: string; recipe_id: string; cook_method: string; target_temp: string; internal_temp: string; cook_time: string; batch_description: string; recorded_by: string; notes: string } | null>(null)
  const [cookMsg,     setCookMsg]     = useState('')
  const [cookPrintFrom, setCookPrintFrom] = useState(() => todayStr())
  const [cookPrintTo,   setCookPrintTo]   = useState(() => todayStr())

  // ── HACCP plan state ──────────────────────────────────────────
  const [plans,        setPlans]        = useState<HaccpPlan[]>([])
  const [planView,     setPlanView]     = useState<'list' | 'generate' | 'edit'>('list')
  const [planDraft,    setPlanDraft]    = useState<HaccpPlan | null>(null)
  const [ccpDraft,     setCcpDraft]     = useState<HaccpCCP[]>([])
  const [expandedCcp,  setExpandedCcp]  = useState<number | null>(null)
  const [showPlanHistory, setShowPlanHistory] = useState(false)
  const [restaurantName, setRestaurantName] = useState('')
  const [locAddress,   setLocAddress]   = useState('')

  const loadEquipment = useCallback(async () => {
    if (!locationId) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('haccp_equipment').select('*')
      .eq('location_id', locationId).eq('is_active', true).order('sort_order')
    setEquipment((data ?? []) as HACCPEquipment[])
    setLoading(false)
  }, [locationId, supabase])

  const loadRecentLogs = useCallback(async () => {
    if (!locationId) return
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data } = await supabase.from('temperature_logs').select('*')
      .eq('location_id', locationId).gte('recorded_at', since)
    setRecentLogs((data ?? []) as TemperatureLog[])
  }, [locationId, supabase])

  const loadActions = useCallback(async () => {
    if (!locationId) return
    const { data } = await supabase.from('corrective_actions').select('*')
      .eq('location_id', locationId).order('created_at', { ascending: false })
    setActions((data ?? []) as CorrectiveAction[])
  }, [locationId, supabase])

  const loadReceiving = useCallback(async () => {
    if (!locationId) return
    const { data: logs } = await supabase.from('haccp_receiving_logs').select('*')
      .eq('location_id', locationId).order('received_at', { ascending: false }).limit(30)
    const rows = (logs ?? []) as ReceivingLog[]
    setReceivingLogs(rows)
    const ids = rows.map(r => r.id)
    if (ids.length) {
      const { data: lines } = await supabase.from('haccp_receiving_log_lines').select('*').in('receiving_log_id', ids)
      const map: Record<string, ReceivingLine[]> = {}
      for (const ln of (lines ?? []) as ReceivingLine[]) { (map[ln.receiving_log_id] ??= []).push(ln) }
      setReceivingLines(map)
    } else { setReceivingLines({}) }
  }, [locationId, supabase])

  const loadTemplate = useCallback(async () => {
    if (!locationId) return
    const { data: pars } = await supabase.from('inventory_par_levels').select('library_id').eq('location_id', locationId)
    const libIds = Array.from(new Set((pars ?? []).map((p: { library_id: string }) => p.library_id)))
    if (!libIds.length) { setParTemplate([]); return }
    const { data: libs } = await supabase.from('ingredient_library').select('id,name').in('id', libIds)
    setParTemplate(((libs ?? []) as { id: string; name: string }[]).map(l => ({ library_id: l.id, name: l.name })))
  }, [locationId, supabase])

  const loadCooking = useCallback(async () => {
    if (!locationId) return
    const { data } = await supabase.from('haccp_cooking_logs').select('*')
      .eq('location_id', locationId).order('recorded_at', { ascending: false }).limit(50)
    setCookingLogs((data ?? []) as CookingLog[])
  }, [locationId, supabase])

  const loadRecipes = useCallback(async () => {
    if (!restaurantId) return
    const { data } = await supabase.from('recipes').select('id,name').eq('restaurant_id', restaurantId).eq('is_deleted', false).order('name')
    setRecipes((data ?? []) as { id: string; name: string }[])
  }, [restaurantId, supabase])

  const loadPlans = useCallback(async () => {
    if (!locationId) return
    const { data } = await supabase.from('haccp_plans').select('*').eq('location_id', locationId).order('created_at', { ascending: false })
    setPlans(((data ?? []) as HaccpPlan[]).map(p => ({ ...p, plan_data: { ...EMPTY_PLAN_DATA, ...(p.plan_data ?? {}) } })))
  }, [locationId, supabase])

  const loadPlanContext = useCallback(async () => {
    if (!locationId) return
    const { data } = await supabase.from('locations').select('address, restaurants(name)').eq('id', locationId).maybeSingle()
    setLocAddress((data as { address?: string } | null)?.address ?? '')
    setRestaurantName(((data as { restaurants?: { name?: string } } | null)?.restaurants?.name) ?? (locationName ?? ''))
  }, [locationId, locationName, supabase])

  useEffect(() => { loadEquipment(); loadRecentLogs(); loadActions(); loadReceiving(); loadTemplate(); loadCooking(); loadRecipes(); loadPlans(); loadPlanContext() }, [loadEquipment, loadRecentLogs, loadActions, loadReceiving, loadTemplate, loadCooking, loadRecipes, loadPlans, loadPlanContext])

  async function fetchCcps(planId: string): Promise<HaccpCCP[]> {
    const { data } = await supabase.from('haccp_plan_ccps').select('*').eq('plan_id', planId).order('sort_order')
    return (data ?? []) as HaccpCCP[]
  }

  function emptyPlanDraft(version: number): HaccpPlan {
    return {
      id: '', location_id: locationId ?? '', title: `${locationName ?? restaurantName} HACCP Plan ${new Date().getFullYear()}`,
      effective_date: todayStr(), version, status: 'draft', generated_by: '', reviewed_by: null, reviewed_at: null,
      plan_data: { ...EMPTY_PLAN_DATA }, created_at: '',
    }
  }

  function openGenerate() {
    const nextVersion = plans.length ? Math.max(...plans.map(p => p.version)) + 1 : 1
    setPlanDraft(emptyPlanDraft(nextVersion))
    setCcpDraft([])
    setExpandedCcp(null)
    setPlanView('generate')
  }

  function autoGenerate() {
    setPlanDraft(d => d ? {
      ...d,
      plan_data: {
        facility_description: planFacilityText(restaurantName, locAddress),
        menu_hazard_analysis: PLAN_MENU_HAZARD,
        monitoring_overview: PLAN_MONITORING_OVERVIEW,
        corrective_action_procedures: PLAN_CORRECTIVE_PROCEDURES,
        verification_procedures: PLAN_VERIFICATION_PROCEDURES,
        record_keeping: PLAN_RECORD_KEEPING,
      },
    } : d)
    setCcpDraft(CCP_SEED.map(c => ({ ...c })))
  }

  async function savePlan() {
    if (!planDraft || !locationId) return
    if (!planDraft.title.trim()) { alert('Title is required'); return }
    setSaving(true)
    const { data: planRow, error } = await supabase.from('haccp_plans').insert({
      location_id: locationId, title: planDraft.title.trim(), effective_date: planDraft.effective_date,
      version: planDraft.version, status: 'draft', generated_by: planDraft.generated_by || '',
      plan_data: planDraft.plan_data,
    }).select().single()
    if (error || !planRow) { setSaving(false); console.error('[haccp plan]', error); alert('Failed to save plan'); return }
    const planId = (planRow as { id: string }).id
    if (ccpDraft.length) {
      await supabase.from('haccp_plan_ccps').insert(ccpDraft.map(c => ({
        plan_id: planId, sort_order: c.sort_order, step_name: c.step_name, hazard: c.hazard,
        critical_limits: c.critical_limits, monitoring_procedure: c.monitoring_procedure,
        corrective_actions: c.corrective_actions, verification: c.verification, records_kept: c.records_kept,
      })))
    }
    setSaving(false)
    await loadPlans()
    const ccps = await fetchCcps(planId)
    setPlanDraft(planRow as HaccpPlan)
    setCcpDraft(ccps)
    setPlanView('edit')
    alert('Plan created.')
  }

  async function openEditPlan(plan: HaccpPlan) {
    setPlanDraft({ ...plan })
    setCcpDraft(await fetchCcps(plan.id))
    setExpandedCcp(null)
    setPlanView('edit')
  }

  function setCcpField(i: number, field: CcpFieldKey, value: string) {
    setCcpDraft(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }

  async function saveEditPlan() {
    if (!planDraft?.id) return
    setSaving(true)
    await supabase.from('haccp_plans').update({
      title: planDraft.title.trim(), effective_date: planDraft.effective_date, generated_by: planDraft.generated_by || '',
      plan_data: planDraft.plan_data,
    }).eq('id', planDraft.id)
    for (const c of ccpDraft) {
      if (c.id) {
        await supabase.from('haccp_plan_ccps').update({
          step_name: c.step_name, hazard: c.hazard, critical_limits: c.critical_limits,
          monitoring_procedure: c.monitoring_procedure, corrective_actions: c.corrective_actions,
          verification: c.verification, records_kept: c.records_kept,
        }).eq('id', c.id)
      } else {
        await supabase.from('haccp_plan_ccps').insert({ ...c, plan_id: planDraft.id })
      }
    }
    setSaving(false)
    setPlanView('list')
    loadPlans()
  }

  async function markReviewed(plan: HaccpPlan) {
    const name = prompt('Enter reviewing manager name:')
    if (name === null || !name.trim()) return
    await supabase.from('haccp_plans').update({ reviewed_by: name.trim(), reviewed_at: new Date().toISOString(), status: 'active' }).eq('id', plan.id)
    alert('Plan marked as reviewed and activated.')
    loadPlans()
  }

  async function archivePlan(plan: HaccpPlan) {
    if (!confirm(`Archive "${plan.title}"?`)) return
    await supabase.from('haccp_plans').update({ status: 'archived' }).eq('id', plan.id)
    loadPlans()
  }

  async function exportPlanPdf(plan: HaccpPlan) {
    const ccps = await fetchCcps(plan.id)
    printHACCPPlan(plan, ccps, locationName ?? '', restaurantName)
  }

  // ── Cooking handlers ──────────────────────────────────────────
  function openCookForm() {
    setCookMsg('')
    setCookDraft({ item_name: '', recipe_id: '', cook_method: 'reheating', target_temp: '165', internal_temp: '', cook_time: '', batch_description: '', recorded_by: '', notes: '' })
  }
  function setCookMethod(method: string) {
    const m = COOK_METHODS.find(x => x.value === method)
    setCookDraft(d => d ? { ...d, cook_method: method, target_temp: m?.target != null ? String(m.target) : '' } : d)
  }
  function pickRecipe(recipeId: string) {
    const r = recipes.find(x => x.id === recipeId)
    setCookDraft(d => d ? { ...d, recipe_id: recipeId, item_name: r ? r.name : d.item_name } : d)
  }
  const cookCompliant = (target: string, internal: string): boolean | null => {
    const t = parseFloat(target), v = parseFloat(internal)
    if (isNaN(v)) return null
    if (isNaN(t)) return true // no target to compare against
    return v >= t
  }

  async function saveCook() {
    if (!cookDraft || !locationId) return
    if (!cookDraft.item_name.trim()) { alert('Item name is required'); return }
    if (cookDraft.internal_temp === '' || isNaN(parseFloat(cookDraft.internal_temp))) { alert('Internal temp is required'); return }
    if (!cookDraft.recorded_by.trim()) { alert('Recorded by is required'); return }
    setSaving(true)
    const nowIso = new Date().toISOString()
    const target = cookDraft.target_temp === '' ? null : parseFloat(cookDraft.target_temp)
    const internal = parseFloat(cookDraft.internal_temp)
    const isComp = target != null ? internal >= target : true

    const { data: logRow, error } = await supabase.from('haccp_cooking_logs').insert({
      location_id: locationId, item_name: cookDraft.item_name.trim(), recipe_id: cookDraft.recipe_id || null,
      cook_method: cookDraft.cook_method, target_temp: target, internal_temp: internal,
      cook_time_minutes: cookDraft.cook_time === '' ? null : parseInt(cookDraft.cook_time),
      batch_description: cookDraft.batch_description || '', recorded_by: cookDraft.recorded_by.trim(),
      is_compliant: isComp, notes: cookDraft.notes || '', recorded_at: nowIso,
    }).select().single()
    if (error || !logRow) { setSaving(false); console.error('[haccp cooking]', error); alert('Failed to save cooking log'); return }

    if (!isComp) {
      await supabase.from('corrective_actions').insert({
        location_id: locationId, trigger_type: 'cooking_log', trigger_id: (logRow as { id: string }).id,
        description: `${cookDraft.item_name.trim()}: internal temp ${internal}°F did not reach target ${target}°F (${COOK_METHOD_LABELS[cookDraft.cook_method] ?? cookDraft.cook_method}). Item held pending re-check.`,
        discovered_at: nowIso, discovered_by: cookDraft.recorded_by.trim(), action_taken: '', status: 'open',
      })
      setCookMsg('')
      alert('⚠ Non-compliant — corrective action opened.')
    } else {
      setCookMsg(`✓ ${cookDraft.item_name.trim()} at ${internal}°F`)
    }

    setSaving(false)
    // Keep the form open for rapid multi-batch logging; clear per-entry temp fields.
    setCookDraft(d => d ? { ...d, internal_temp: '', cook_time: '', batch_description: '', notes: '' } : d)
    loadCooking(); loadActions()
  }

  async function doPrintCooking() {
    if (!locationId) return
    const { data } = await supabase.from('haccp_cooking_logs').select('*')
      .eq('location_id', locationId)
      .gte('recorded_at', `${cookPrintFrom}T00:00:00`).lte('recorded_at', `${cookPrintTo}T23:59:59`)
      .order('recorded_at', { ascending: true })
    printCookingLog((data ?? []) as CookingLog[], locationName ?? 'Location', cookPrintFrom, cookPrintTo)
  }

  // ── Receiving handlers ────────────────────────────────────────
  function openDelivery() {
    const lines = parTemplate.map(t => ({ ...blankRecvLine(), item_name: t.name, library_id: t.library_id }))
    setDelivery({ received_by: '', supplier_name: '', delivery_type: 'standard', received_at: nowLocalDatetime(), notes: '', lines: lines.length ? lines : [blankRecvLine()] })
  }
  function setRecvLine(i: number, patch: Partial<DeliveryLine>) {
    setDelivery(d => d ? { ...d, lines: d.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) } : d)
  }

  async function saveDelivery() {
    if (!delivery || !locationId) return
    if (!delivery.received_by.trim()) { alert('Received by is required'); return }
    const lines = delivery.lines.filter(l => l.item_name.trim())
    if (!lines.length) { alert('Add at least one item'); return }
    setSaving(true)
    const nowIso = delivery.received_at ? new Date(delivery.received_at).toISOString() : new Date().toISOString()
    const overall = lines.every(l => recvLineCompliant(l) && l.accepted)

    const { data: logRow, error } = await supabase.from('haccp_receiving_logs').insert({
      location_id: locationId, supplier_name: delivery.supplier_name || '', delivery_type: delivery.delivery_type,
      received_at: nowIso, received_by: delivery.received_by.trim(), notes: delivery.notes || '', overall_compliant: overall,
    }).select().single()
    if (error || !logRow) { setSaving(false); console.error('[haccp receiving]', error); alert('Failed to save receiving log'); return }
    const logId = (logRow as { id: string }).id

    let nonCompliant = 0
    await supabase.from('haccp_receiving_log_lines').insert(lines.map(l => {
      const comp = recvLineCompliant(l)
      if (!comp || !l.accepted) nonCompliant++
      return {
        receiving_log_id: logId, library_id: l.library_id, item_name: l.item_name.trim(),
        temp_checked: l.temp_checked,
        temp_value: l.temp_checked && l.temp_value !== '' ? parseFloat(l.temp_value) : null,
        critical_limit: l.critical_limit !== '' ? parseFloat(l.critical_limit) : null,
        temp_unit: 'F', is_compliant: comp, accepted: l.accepted, rejection_reason: l.rejection_reason || '',
        batch_id: l.batch_id || '', expiry_date: l.expiry_date || null, notes: l.notes || '',
      }
    }))

    // Corrective actions for non-compliant / rejected lines.
    for (const l of lines) {
      const comp = recvLineCompliant(l)
      if (comp && l.accepted) continue
      const description = !l.accepted
        ? `${l.item_name}: delivery rejected — ${l.rejection_reason || 'no reason given'}`
        : `${l.item_name}: temp ${l.temp_value}°F exceeds limit ${l.critical_limit}°F`
      await supabase.from('corrective_actions').insert({
        location_id: locationId, trigger_type: 'receiving_log', trigger_id: logId,
        description, discovered_at: nowIso, discovered_by: delivery.received_by.trim(),
        action_taken: '', status: 'open',
      })
    }

    // Contract kitchen: register received batches that don't already exist.
    if (delivery.delivery_type === 'contract_kitchen') {
      for (const l of lines) {
        if (!l.accepted || !l.batch_id.trim()) continue
        const { data: existing } = await supabase.from('prepared_batches').select('id')
          .eq('location_id', locationId).eq('contract_batch_id', l.batch_id.trim()).limit(1)
        if (existing && existing.length) continue
        await supabase.from('prepared_batches').insert({
          location_id: locationId, batch_name: l.item_name.trim(), batch_qty: null, batch_unit: 'each',
          current_qty: null, current_unit: 'each', prep_date: dateOf(nowIso), use_by_date: l.expiry_date || null,
          is_contract_kitchen: true, contract_batch_id: l.batch_id.trim(), status: 'active',
          prep_by: '', storage_location: '', discarded_by: '', discard_reason: '', notes: '',
        })
      }
    }

    setSaving(false)
    setDelivery(null)
    loadReceiving(); loadActions()
    alert(`✓ Receiving check logged — ${lines.length} items, ${nonCompliant} non-compliant`)
  }

  async function doPrintReceiving() {
    if (!locationId) return
    const { data: logs } = await supabase.from('haccp_receiving_logs').select('*')
      .eq('location_id', locationId)
      .gte('received_at', `${recvPrintFrom}T00:00:00`).lte('received_at', `${recvPrintTo}T23:59:59`)
      .order('received_at', { ascending: true })
    const rows = (logs ?? []) as ReceivingLog[]
    const ids = rows.map(r => r.id)
    let map: Record<string, ReceivingLine[]> = {}
    if (ids.length) {
      const { data: lines } = await supabase.from('haccp_receiving_log_lines').select('*').in('receiving_log_id', ids)
      for (const ln of (lines ?? []) as ReceivingLine[]) { (map[ln.receiving_log_id] ??= []).push(ln) }
    }
    printReceivingLog(rows, map, locationName ?? 'Location', recvPrintFrom, recvPrintTo)
  }

  // ── Compliance preview for a single input ─────────────────────
  function compliance(eq: HACCPEquipment, tempStr: string | undefined): 'ok' | 'bad' | null {
    if (!tempStr || isNaN(parseFloat(tempStr))) return null
    const t = parseFloat(tempStr)
    return t >= eq.target_temp_min && t <= eq.target_temp_max ? 'ok' : 'bad'
  }

  function openForm(slot: LogSlot) {
    setActiveSlot(slot)
    setEntries({})
    setSummary(null)
  }

  function setEntry(id: string, field: 'temp' | 'notes', value: string) {
    setEntries(prev => ({ ...prev, [id]: { temp: prev[id]?.temp ?? '', notes: prev[id]?.notes ?? '', [field]: value } }))
  }

  async function saveLog() {
    if (!activeSlot || !locationId) return
    for (const eq of equipment) {
      const e = entries[eq.id]
      if (!e || e.temp === '' || isNaN(parseFloat(e.temp))) {
        alert('Please enter temperature for all equipment')
        return
      }
    }
    if (!recordedBy.trim()) { alert('Please enter your name in "Recorded by"') ; return }

    setSaving(true)
    const nowIso = new Date().toISOString()
    let compliant = 0, nonCompliant = 0, correctiveCount = 0
    const ncNames: string[] = []

    for (const eq of equipment) {
      const temp = parseFloat(entries[eq.id].temp)
      const isComp = temp >= eq.target_temp_min && temp <= eq.target_temp_max
      const { data: logRow, error } = await supabase.from('temperature_logs').insert({
        location_id:      locationId,
        equipment_id:     eq.id,
        log_slot:         activeSlot,
        recorded_at:      nowIso,
        temp_value:       temp,
        temp_unit:        'F',
        recorded_by:      recordedBy.trim(),
        recording_method: 'manual',
        is_compliant:     isComp,
        notes:            entries[eq.id].notes || '',
      }).select().single()
      if (error) { console.error('[haccp] temp log insert failed:', error); continue }

      if (isComp) { compliant++; continue }

      nonCompliant++
      ncNames.push(`${eq.name}: ${temp}°${eq.temp_unit}`)
      const { error: caErr } = await supabase.from('corrective_actions').insert({
        location_id:   locationId,
        trigger_type:  'temperature_log',
        trigger_id:    (logRow as any)?.id ?? null,
        discovered_at: nowIso,
        discovered_by: recordedBy.trim(),
        description:   `${eq.name}: ${temp}°${eq.temp_unit} is outside safe range (${eq.target_temp_min}–${eq.target_temp_max}°${eq.temp_unit})`,
        action_taken:  '',
        status:        'open',
      })
      if (caErr) console.error('[haccp] corrective action insert failed:', caErr)
      else correctiveCount++
    }

    setSaving(false)
    setSummary({ slot: activeSlot, compliant, nonCompliant, ncNames, correctiveCount })
    setActiveSlot(null)
    setEntries({})
    setRecordedBy('')
    loadRecentLogs()
    loadActions()
  }

  // ── 7-day compliance history ──────────────────────────────────
  const history = useMemo(() => {
    const today = todayStr()
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i)
      return d
    })
    function slotStatus(dateStr: string, slot: LogSlot): 'ok' | 'warn' | 'missing' {
      const rows = recentLogs.filter(l => dateOf(l.recorded_at) === dateStr && l.log_slot === slot)
      if (rows.length === 0) return 'missing'
      return rows.some(r => r.is_compliant === false) ? 'warn' : 'ok'
    }
    return days.map(d => {
      const dateStr = d.toISOString().split('T')[0]
      return {
        dateStr,
        label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        isPast: dateStr < today,
        opening: slotStatus(dateStr, 'opening'),
        closing: slotStatus(dateStr, 'closing'),
      }
    })
  }, [recentLogs])

  // Missing logs for past days (today-1 .. today-7); today is not flagged.
  // NOTE: uses the browser's local timezone via Date(), which is fine for
  // client-side display. Will move to server-side, location-tz-aware date
  // calculation when that's added.
  const missingSlots = useMemo(() => {
    const result: { date: string; slot: LogSlot }[] = []
    for (let i = 1; i <= 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      for (const slot of ['opening', 'closing'] as LogSlot[]) {
        const has = recentLogs.some(l => dateOf(l.recorded_at) === dateStr && l.log_slot === slot)
        if (!has) result.push({ date: label, slot })
      }
    }
    return result
  }, [recentLogs])

  async function doPrintTempLog() {
    if (!locationId) return
    const { data } = await supabase.from('temperature_logs').select('*')
      .eq('location_id', locationId)
      .gte('recorded_at', `${printFrom}T00:00:00`)
      .lte('recorded_at', `${printTo}T23:59:59`)
      .order('recorded_at', { ascending: true })
    printTempLog((data ?? []) as TemperatureLog[], equipment, locationName ?? 'Location', printFrom, printTo)
  }

  // ── Corrective actions: filter + print ────────────────────────
  const filteredActions = useMemo(() =>
    actions.filter(a => statusFilter === 'all' ? true : a.status === statusFilter),
    [actions, statusFilter]
  )

  async function resolveAction(a: CorrectiveAction) {
    const name = prompt('Resolved by (your name):')
    if (name === null || !name.trim()) return
    await supabase.from('corrective_actions').update({
      action_taken: actionDraft[a.id] ?? a.action_taken,
      status:       'resolved',
      resolved_at:  new Date().toISOString(),
      resolved_by:  name.trim(),
    }).eq('id', a.id)
    setExpandedId(null)
    loadActions()
  }

  function printActions() {
    const dates = actions.map(a => dateOf(a.created_at)).sort()
    const range = dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : todayStr()
    const rows = filteredActions.map(a => `
      <tr>
        <td>${dateOf(a.discovered_at)}</td>
        <td>${a.items_affected || '—'}</td>
        <td>${a.description}</td>
        <td>${a.action_taken || '—'}</td>
        <td>${a.resolved_by || '—'}</td>
        <td>${a.resolved_at ? dateOf(a.resolved_at) : '—'}</td>
      </tr>`).join('')
    const w = window.open('', '_blank', 'width=900,height=900')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>Corrective Action Log</title>
      <style>
        body { font-family: Georgia, serif; font-size: 12px; padding: 28px; color: #1a1a1a; }
        h2 { font-size: 15px; margin: 0 0 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th { background: #f0ede8; text-align: left; padding: 5px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #ccc; }
        td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
        p.foot { margin-top: 20px; font-size: 10px; color: #666; }
      </style></head><body>
      <h2>Corrective Action Log</h2>
      <table>
        <thead><tr>
          <th>Date</th><th>Equipment/Item</th><th>Description</th><th>Action Taken</th><th>Resolved By</th><th>Date Resolved</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="foot">Corrective Action Log · ${locationName ?? 'Location'} · ${range} · CT retention: 1 year</p>
      </body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  const statusBadge = (status: CorrectiveAction['status']) => {
    const map: Record<string, string> = {
      open:     'bg-red-50 text-red-700 border-red-200',
      resolved: 'bg-amber-50 text-amber-700 border-amber-200',
      verified: 'bg-green-50 text-green-700 border-green-200',
    }
    const label = status.charAt(0).toUpperCase() + status.slice(1)
    return <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize ${map[status] ?? ''}`}>{label}</span>
  }

  if (loading) return <div className="flex items-center justify-center h-full text-[--hint] text-sm">Loading HACCP…</div>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header + tabs */}
      <div className="bg-white border-b border-[--border] px-6 py-4 flex-shrink-0">
        <h1 className="font-serif text-xl font-medium text-[--text] mb-3">Compliance — HACCP</h1>
        <div className="flex bg-[--surface-2] rounded-lg p-0.5 gap-0.5 w-fit">
          {([['log','📋 Log Temps'],['corrective','⚠ Corrective Actions'],['receiving','🚚 Receiving'],['cooking','🍳 Cooking/Reheating'],['plan','📄 HACCP Plan']] as [HACCPTab,string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${tab === t ? 'bg-white text-[--text] shadow-sm' : 'text-[--muted]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── LOG TEMPS TAB ── */}
      {tab === 'log' && (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!locationId ? (
            <p className="text-sm text-[--muted]">No location selected.</p>
          ) : (
            <>
              {/* Daily compliance summary */}
              {(() => {
                const today = todayStr()
                const tempToday = recentLogs.filter(l => dateOf(l.recorded_at) === today).length
                const openActions = actions.filter(a => a.status === 'open').length
                const cookToday = cookingLogs.filter(c => dateOf(c.recorded_at) === today).length
                return (
                  <div className="mb-5 rounded-xl border border-[--border] bg-[--surface-2] px-4 py-3 space-y-1 text-xs">
                    <div className="text-[--muted]">{tempToday > 0 ? `✓ Temperature logs today: ${tempToday} recorded` : 'Temperature logs today: none recorded yet'}</div>
                    <div className={openActions > 0 ? 'text-amber-700' : 'text-[--muted]'}>{openActions > 0 ? `⚠ Open corrective actions: ${openActions}` : '✓ No open corrective actions'}</div>
                    <div className="text-[--muted]">{cookToday > 0 ? `✓ Cooking logs today: ${cookToday} logged` : 'Cooking logs today: none logged yet'}</div>
                  </div>
                )
              })()}

              {/* Slot buttons */}
              <div className="flex gap-3 mb-5">
                <button onClick={() => openForm('opening')}
                  className={`px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${activeSlot === 'opening' ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--text] hover:bg-[--surface-2]'}`}>
                  🌅 Log Opening Temps
                </button>
                <button onClick={() => openForm('closing')}
                  className={`px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${activeSlot === 'closing' ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--text] hover:bg-[--surface-2]'}`}>
                  🌙 Log Closing Temps
                </button>
              </div>

              {/* Save summary */}
              {summary && (
                <div className="mb-5 p-4 rounded-xl border border-[--border] bg-white">
                  <div className="text-sm font-medium text-[--text]">
                    ✓ {SLOT_LABELS[summary.slot]} log saved — {summary.compliant} compliant, {summary.nonCompliant} non-compliant
                  </div>
                  {summary.ncNames.length > 0 && (
                    <div className="text-[12px] text-red-600 mt-1.5">{summary.ncNames.join(' · ')}</div>
                  )}
                  {summary.correctiveCount > 0 && (
                    <div className="text-[12px] text-amber-700 mt-1.5">
                      ⚠ {summary.correctiveCount} corrective action{summary.correctiveCount === 1 ? '' : 's'} opened. See Corrective Actions tab.
                    </div>
                  )}
                </div>
              )}

              {/* Log entry form */}
              {activeSlot && (
                <div className="mb-6 bg-white rounded-xl border border-[--border] overflow-hidden">
                  <div className="px-4 py-3 border-b border-[--border] bg-[--surface-2]">
                    <h2 className="font-serif text-sm font-medium text-[--text]">
                      {SLOT_LABELS[activeSlot]} Temperature Log — {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </h2>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[--border] text-[10px] uppercase tracking-wide text-[--hint]">
                        <th className="text-left px-4 py-2">Equipment</th>
                        <th className="text-left px-4 py-2">Target range</th>
                        <th className="text-left px-4 py-2">Temp</th>
                        <th className="text-left px-4 py-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {equipment.map(eq => {
                        const c = compliance(eq, entries[eq.id]?.temp)
                        return (
                          <tr key={eq.id} className="border-b border-[--border]">
                            <td className="px-4 py-2.5 font-medium text-[--text]">{eq.name}</td>
                            <td className="px-4 py-2.5 text-[--muted]">{eq.target_temp_min}–{eq.target_temp_max}°{eq.temp_unit}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <input type="number" step="0.1" placeholder="--"
                                  value={entries[eq.id]?.temp ?? ''}
                                  onChange={e => setEntry(eq.id, 'temp', e.target.value)}
                                  className="w-20 text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                                <span className="text-[--hint]">°{eq.temp_unit}</span>
                                {c === 'ok' && <span className="text-green-600 font-semibold">✓</span>}
                                {c === 'bad' && <span className="text-red-600 font-semibold">✗</span>}
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <input value={entries[eq.id]?.notes ?? ''}
                                onChange={e => setEntry(eq.id, 'notes', e.target.value)}
                                className="w-full text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="px-4 py-3 border-t border-[--border] flex items-center gap-3 flex-wrap">
                    <input value={recordedBy} onChange={e => setRecordedBy(e.target.value)}
                      placeholder="Your name"
                      className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-44" />
                    <button onClick={saveLog} disabled={saving}
                      className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save Temperature Log'}
                    </button>
                  </div>
                </div>
              )}

              {/* Missing log alert */}
              {missingSlots.length > 0 && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="text-xs font-medium text-amber-800">⚠ Missing temperature logs:</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {missingSlots.map((s, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-amber-200 text-amber-700 capitalize">
                        {s.date} — {s.slot}
                      </span>
                    ))}
                  </div>
                  <div className="text-[11px] text-amber-700 mt-2">Missing logs must be explained to a health inspector.</div>
                </div>
              )}

              {/* Print temperature log */}
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="text-[11px] text-[--muted]">Print log for:</span>
                <input type="date" value={printFrom} onChange={e => setPrintFrom(e.target.value)}
                  className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                <span className="text-[11px] text-[--hint]">to</span>
                <input type="date" value={printTo} onChange={e => setPrintTo(e.target.value)}
                  className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                <button onClick={doPrintTempLog}
                  className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
                  🖨 Print Temperature Log
                </button>
              </div>

              {/* Compliance history */}
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[--hint] mb-2">Last 7 days</h3>
                <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                  {history.map(d => (
                    <div key={d.dateStr} className="flex items-center gap-4 px-4 py-2 border-b border-[--border] last:border-0 text-xs">
                      <span className="w-28 text-[--text]">{d.label}</span>
                      <SlotCell label="Opening" status={d.opening} isPast={d.isPast} />
                      <SlotCell label="Closing" status={d.closing} isPast={d.isPast} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── CORRECTIVE ACTIONS TAB ── */}
      {tab === 'corrective' && (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex gap-1">
              {(['all','open','resolved'] as StatusFilter[]).map(f => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`text-[11px] px-3 py-1 rounded-full border capitalize transition-colors ${statusFilter === f ? 'bg-[--accent] text-white border-[--accent]' : 'border-[--border-2] text-[--muted] hover:bg-[--surface-2]'}`}>
                  {f}
                </button>
              ))}
            </div>
            <button onClick={printActions}
              className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
              🖨 Print
            </button>
          </div>

          {filteredActions.length === 0 ? (
            <p className="text-sm text-[--muted] py-8 text-center">No corrective actions.</p>
          ) : (
            <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                    <th className="text-left px-4 py-2 w-24">Date</th>
                    <th className="text-left px-4 py-2 w-32">Type</th>
                    <th className="text-left px-4 py-2">Description</th>
                    <th className="text-left px-4 py-2 w-24">Status</th>
                    <th className="text-left px-4 py-2">Action taken</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActions.map(a => (
                    <FragmentRow key={a.id}>
                      <tr onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                        className="border-b border-[--border] hover:bg-[--surface-2]/40 cursor-pointer">
                        <td className="px-4 py-2.5 text-[--muted]">{dateOf(a.discovered_at)}</td>
                        <td className="px-4 py-2.5 text-[--muted]">{a.trigger_type.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-2.5 text-[--text]">{a.description}</td>
                        <td className="px-4 py-2.5">{statusBadge(a.status)}</td>
                        <td className="px-4 py-2.5 text-[--muted]">{a.action_taken || '—'}</td>
                      </tr>
                      {expandedId === a.id && (
                        <tr className="border-b border-[--accent] bg-[--accent-light]/20">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="grid grid-cols-2 gap-3 text-[11px] text-[--muted] mb-3">
                              <div><span className="font-medium text-[--text]">Discovered:</span> {new Date(a.discovered_at).toLocaleString()}</div>
                              <div><span className="font-medium text-[--text]">Discovered by:</span> {a.discovered_by || '—'}</div>
                              <div className="col-span-2"><span className="font-medium text-[--text]">Description:</span> {a.description}</div>
                              {a.items_affected && <div className="col-span-2"><span className="font-medium text-[--text]">Items affected:</span> {a.items_affected}</div>}
                              {a.resolved_at && (
                                <div className="col-span-2"><span className="font-medium text-[--text]">Resolved:</span> {new Date(a.resolved_at).toLocaleString()} by {a.resolved_by || '—'}</div>
                              )}
                            </div>
                            <label className="block text-[10px] font-medium text-[--muted] mb-1 uppercase tracking-wide">Action taken</label>
                            <textarea rows={2}
                              defaultValue={a.action_taken}
                              onChange={e => setActionDraft(prev => ({ ...prev, [a.id]: e.target.value }))}
                              className="w-full text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] resize-none"
                              placeholder="Describe the corrective action taken…" />
                            {a.status === 'open' && (
                              <button onClick={() => resolveAction(a)}
                                className="mt-2 px-3 py-1.5 text-[11px] font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">
                                Mark as Resolved
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── RECEIVING TAB ── */}
      {tab === 'receiving' && (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!locationId ? (
            <p className="text-sm text-[--muted]">No location selected.</p>
          ) : (
            <>
              {/* Print + log buttons */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[11px] text-[--muted]">Print log:</span>
                  <input type="date" value={recvPrintFrom} onChange={e => setRecvPrintFrom(e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                  <span className="text-[11px] text-[--hint]">to</span>
                  <input type="date" value={recvPrintTo} onChange={e => setRecvPrintTo(e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                  <button onClick={doPrintReceiving} className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">🖨 Print receiving log</button>
                </div>
                {!delivery && (
                  <button onClick={openDelivery} className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">+ Log delivery check</button>
                )}
              </div>

              {/* Delivery form */}
              {delivery && (
                <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
                  <h3 className="font-serif text-sm font-medium text-[--text]">Log delivery check</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Received by</label>
                      <input value={delivery.received_by} onChange={e => setDelivery(d => ({ ...d!, received_by: e.target.value }))} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full" /></div>
                    <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Supplier</label>
                      <input value={delivery.supplier_name} onChange={e => setDelivery(d => ({ ...d!, supplier_name: e.target.value }))} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full" /></div>
                    <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Delivery type</label>
                      <select value={delivery.delivery_type} onChange={e => setDelivery(d => ({ ...d!, delivery_type: e.target.value as DeliveryType }))} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full bg-white">
                        <option value="standard">Standard delivery</option><option value="contract_kitchen">Contract kitchen</option>
                      </select></div>
                    <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Date/time</label>
                      <input type="datetime-local" value={delivery.received_at} onChange={e => setDelivery(d => ({ ...d!, received_at: e.target.value }))} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full" /></div>
                    <div className="col-span-2"><label className="block text-[11px] font-medium text-[--muted] mb-1">Notes</label>
                      <input value={delivery.notes} onChange={e => setDelivery(d => ({ ...d!, notes: e.target.value }))} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full" /></div>
                  </div>

                  <div className="space-y-2">
                    {delivery.lines.map((l, i) => {
                      const comp = recvLineCompliant(l)
                      return (
                        <div key={i} className="border border-[--border] rounded-lg p-2.5 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <input value={l.item_name} onChange={e => setRecvLine(i, { item_name: e.target.value })} placeholder="Item"
                              className="flex-1 min-w-[140px] text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                            <label className="flex items-center gap-1 text-[11px] text-[--muted] cursor-pointer">
                              <input type="checkbox" checked={l.temp_checked} onChange={e => setRecvLine(i, { temp_checked: e.target.checked })} className="accent-[--accent]" /> Temp checked
                            </label>
                            {l.temp_checked && (
                              <>
                                <input type="number" step="0.1" value={l.temp_value} onChange={e => setRecvLine(i, { temp_value: e.target.value })} placeholder="Temp"
                                  className="w-20 text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                                <span className="text-[10px] text-[--hint]">limit</span>
                                <input type="number" step="0.1" value={l.critical_limit} onChange={e => setRecvLine(i, { critical_limit: e.target.value })}
                                  className="w-16 text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                                {l.temp_value !== '' && (comp ? <span className="text-green-600 font-semibold">✓</span> : <span className="text-red-600 font-semibold">✗</span>)}
                              </>
                            )}
                            <label className="flex items-center gap-1 text-[11px] text-[--muted] cursor-pointer">
                              <input type="checkbox" checked={l.accepted} onChange={e => setRecvLine(i, { accepted: e.target.checked })} className="accent-[--accent]" /> Accepted
                            </label>
                            <button onClick={() => setDelivery(d => ({ ...d!, lines: d!.lines.filter((_, idx) => idx !== i) }))} className="text-red-400 hover:text-red-600 ml-auto" title="Remove">✕</button>
                          </div>
                          {!l.accepted && (
                            <input value={l.rejection_reason} onChange={e => setRecvLine(i, { rejection_reason: e.target.value })} placeholder="Rejection reason"
                              className="w-full text-xs border border-red-200 rounded-lg px-2 py-1 outline-none focus:border-red-400" />
                          )}
                          {delivery.delivery_type === 'contract_kitchen' && (
                            <div className="flex items-center gap-2">
                              <input value={l.batch_id} onChange={e => setRecvLine(i, { batch_id: e.target.value })} placeholder="Batch ID"
                                className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                              <span className="text-[10px] text-[--hint]">expiry</span>
                              <input type="date" value={l.expiry_date} onChange={e => setRecvLine(i, { expiry_date: e.target.value })}
                                className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <button onClick={() => setDelivery(d => ({ ...d!, lines: [...d!.lines, blankRecvLine()] }))}
                      className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium">+ Add item</button>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={saveDelivery} disabled={saving}
                      className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">{saving ? 'Saving…' : 'Save delivery check'}</button>
                    <button onClick={() => setDelivery(null)}
                      className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">Cancel</button>
                  </div>
                </div>
              )}

              {/* Recent logs */}
              <div>
                <h2 className="font-serif text-sm font-medium text-[--text] mb-2">Recent deliveries</h2>
                {receivingLogs.length === 0 ? (
                  <p className="text-sm text-[--muted]">No receiving checks logged.</p>
                ) : (
                  <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                          <th className="text-left px-3 py-2">Date/Time</th><th className="text-left px-3 py-2">Supplier</th>
                          <th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Items</th>
                          <th className="text-left px-3 py-2">Compliant</th><th className="text-left px-3 py-2 w-14"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {receivingLogs.map(log => {
                          const lines = receivingLines[log.id] ?? []
                          return (
                            <FragmentRow key={log.id}>
                              <tr className="border-b border-[--border]">
                                <td className="px-3 py-2.5 text-[--muted]">{new Date(log.received_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                                <td className="px-3 py-2.5 text-[--text]">{log.supplier_name || '—'}</td>
                                <td className="px-3 py-2.5 text-[--muted]">{log.delivery_type === 'contract_kitchen' ? 'Contract Kitchen' : 'Standard'}</td>
                                <td className="px-3 py-2.5 text-[--muted]">{lines.length}</td>
                                <td className="px-3 py-2.5">
                                  {log.overall_compliant === true ? <span className="text-green-600">✓</span>
                                    : log.overall_compliant === false ? <span className="text-red-600">✗</span>
                                    : <span className="text-amber-600">Partial</span>}
                                </td>
                                <td className="px-3 py-2.5">
                                  <button onClick={() => setExpandedRecvId(expandedRecvId === log.id ? null : log.id)}
                                    className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">View</button>
                                </td>
                              </tr>
                              {expandedRecvId === log.id && (
                                <tr className="border-b border-[--border] bg-[--surface-2]/40">
                                  <td colSpan={6} className="px-3 py-2">
                                    <table className="w-full text-[11px]">
                                      <thead><tr className="text-[10px] uppercase tracking-wide text-[--hint]">
                                        <th className="text-left py-1 pr-3">Item</th><th className="text-left py-1 pr-3">Temp</th><th className="text-left py-1 pr-3">Limit</th>
                                        <th className="text-left py-1 pr-3">Compliant</th><th className="text-left py-1 pr-3">Accepted</th><th className="text-left py-1 pr-3">Batch ID</th><th className="text-left py-1 pr-3">Notes</th>
                                      </tr></thead>
                                      <tbody>
                                        {lines.map(ln => {
                                          const bad = ln.is_compliant === false
                                          return (
                                            <tr key={ln.id} className={bad ? 'bg-red-50/60' : ''}>
                                              <td className={`py-1 pr-3 ${!ln.accepted ? 'line-through text-[--hint]' : 'text-[--text]'}`}>{ln.item_name}</td>
                                              <td className="py-1 pr-3 text-[--muted]">{ln.temp_checked && ln.temp_value != null ? `${ln.temp_value}°F` : '—'}</td>
                                              <td className="py-1 pr-3 text-[--muted]">{ln.critical_limit != null ? `${ln.critical_limit}°F` : '—'}</td>
                                              <td className="py-1 pr-3">{ln.is_compliant === false ? <span className="text-red-600">✗</span> : <span className="text-green-600">✓</span>}</td>
                                              <td className="py-1 pr-3 text-[--muted]">{ln.accepted ? 'Yes' : `No${ln.rejection_reason ? ` — ${ln.rejection_reason}` : ''}`}</td>
                                              <td className="py-1 pr-3 text-[--muted]">{ln.batch_id || '—'}</td>
                                              <td className="py-1 pr-3 text-[--muted]">{ln.notes}</td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              )}
                            </FragmentRow>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── COOKING/REHEATING TAB ── */}
      {tab === 'cooking' && (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!locationId ? (
            <p className="text-sm text-[--muted]">No location selected.</p>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[11px] text-[--muted]">Print log:</span>
                  <input type="date" value={cookPrintFrom} onChange={e => setCookPrintFrom(e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                  <span className="text-[11px] text-[--hint]">to</span>
                  <input type="date" value={cookPrintTo} onChange={e => setCookPrintTo(e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                  <button onClick={doPrintCooking} className="text-xs px-3 py-1.5 border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">🖨 Print cooking log</button>
                </div>
                {!cookDraft && (
                  <button onClick={openCookForm} className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">+ Log cooking temp</button>
                )}
              </div>

              {/* Cooking form (stays open for rapid logging) */}
              {cookDraft && (() => {
                const comp = cookCompliant(cookDraft.target_temp, cookDraft.internal_temp)
                return (
                  <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
                    <h3 className="font-serif text-sm font-medium text-[--text]">Log cooking temp</h3>
                    {cookMsg && <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">{cookMsg}</div>}
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Item name</label>
                        <input value={cookDraft.item_name} onChange={e => setCookDraft(d => ({ ...d!, item_name: e.target.value, recipe_id: '' }))} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full" /></div>
                      <div><label className="block text-[11px] font-medium text-[--muted] mb-1">…or pick a recipe</label>
                        <select value={cookDraft.recipe_id} onChange={e => pickRecipe(e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full bg-white">
                          <option value="">— none —</option>
                          {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select></div>
                      <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Cook method</label>
                        <select value={cookDraft.cook_method} onChange={e => setCookMethod(e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full bg-white">
                          {COOK_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select></div>
                      <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Target temp (°F)</label>
                        <input type="number" step="0.1" value={cookDraft.target_temp} onChange={e => setCookDraft(d => ({ ...d!, target_temp: e.target.value }))} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full" /></div>
                      <div>
                        <label className="block text-[11px] font-medium text-[--muted] mb-1">Internal temp (°F)</label>
                        <div className="flex items-center gap-2">
                          <input type="number" step="0.1" value={cookDraft.internal_temp} onChange={e => setCookDraft(d => ({ ...d!, internal_temp: e.target.value }))} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-24" />
                          {comp === true && <span className="text-green-600 font-semibold">✓</span>}
                          {comp === false && <span className="text-red-600 font-semibold">✗</span>}
                        </div>
                      </div>
                      <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Cook time (min)</label>
                        <input type="number" value={cookDraft.cook_time} onChange={e => setCookDraft(d => ({ ...d!, cook_time: e.target.value }))} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full" /></div>
                      <div className="col-span-2"><label className="block text-[11px] font-medium text-[--muted] mb-1">Batch description</label>
                        <input value={cookDraft.batch_description} onChange={e => setCookDraft(d => ({ ...d!, batch_description: e.target.value }))} placeholder="2L Besciamella, 4 portions" className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full" /></div>
                      <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Recorded by</label>
                        <input value={cookDraft.recorded_by} onChange={e => setCookDraft(d => ({ ...d!, recorded_by: e.target.value }))} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full" /></div>
                      <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Notes</label>
                        <input value={cookDraft.notes} onChange={e => setCookDraft(d => ({ ...d!, notes: e.target.value }))} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full" /></div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveCook} disabled={saving} className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
                      <button onClick={() => { setCookDraft(null); setCookMsg('') }} className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">Done</button>
                    </div>
                  </div>
                )
              })()}

              {/* Recent logs */}
              <div>
                <h2 className="font-serif text-sm font-medium text-[--text] mb-2">Recent cooking logs</h2>
                {cookingLogs.length === 0 ? (
                  <p className="text-sm text-[--muted]">No cooking temps logged.</p>
                ) : (
                  <div className="bg-white rounded-xl border border-[--border] overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                          <th className="text-left px-3 py-2">Date/Time</th><th className="text-left px-3 py-2">Item</th>
                          <th className="text-left px-3 py-2">Method</th><th className="text-left px-3 py-2">Temp</th>
                          <th className="text-left px-3 py-2">Target</th><th className="text-left px-3 py-2">Compliant</th><th className="text-left px-3 py-2">By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cookingLogs.map(l => (
                          <tr key={l.id} className={`border-b border-[--border] last:border-0 ${l.is_compliant ? '' : 'bg-red-50/50'}`}>
                            <td className="px-3 py-2.5 text-[--muted]">{new Date(l.recorded_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                            <td className="px-3 py-2.5 font-medium text-[--text]">{l.item_name}</td>
                            <td className="px-3 py-2.5 text-[--muted]">{COOK_METHOD_LABELS[l.cook_method] ?? l.cook_method}</td>
                            <td className="px-3 py-2.5 text-[--muted]">{l.internal_temp}°F</td>
                            <td className="px-3 py-2.5 text-[--muted]">{l.target_temp != null ? `${l.target_temp}°F` : '—'}</td>
                            <td className="px-3 py-2.5">{l.is_compliant ? <span className="text-green-600">✓</span> : <span className="text-red-600">✗</span>}</td>
                            <td className="px-3 py-2.5 text-[--muted]">{l.recorded_by || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── HACCP PLAN TAB ── */}
      {tab === 'plan' && (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!locationId ? (
            <p className="text-sm text-[--muted]">No location selected.</p>
          ) : planView === 'list' ? (
            (() => {
              const current = plans.find(p => p.status === 'active') ?? plans.find(p => p.status === 'draft') ?? null
              const archived = plans.filter(p => p.status === 'archived')
              const fmtD = (s: string | null) => s ? new Date(s + (s.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
              return (
                <>
                  {!current ? (
                    <div className="bg-white rounded-xl border border-[--border] p-6 text-center space-y-3">
                      <p className="text-sm text-[--muted]">No HACCP plan on file.</p>
                      <button onClick={openGenerate} className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">+ Generate HACCP Plan</button>
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl border border-[--border] p-4 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h3 className="font-serif text-sm font-medium text-[--text]">{current.title} · Version {current.version} · Effective {fmtD(current.effective_date)}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${current.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{current.status === 'active' ? 'Active' : 'Draft'}</span>
                      </div>
                      <div className="text-[11px] text-[--muted]">
                        {current.reviewed_by ? `Reviewed by ${current.reviewed_by} on ${fmtD(current.reviewed_at)}` : <span className="text-amber-700">Not yet reviewed</span>}
                      </div>
                      <div className="flex gap-2 flex-wrap pt-1">
                        <button onClick={() => openEditPlan(current)} className="px-2.5 py-1 text-[11px] border border-[--border-2] rounded-lg text-[--muted] hover:text-[--text]">Edit plan</button>
                        <button onClick={() => markReviewed(current)} className="px-2.5 py-1 text-[11px] border border-[--border-2] rounded-lg text-[--muted] hover:text-[--text]">Mark as reviewed</button>
                        <button onClick={() => archivePlan(current)} className="px-2.5 py-1 text-[11px] border border-[--border-2] rounded-lg text-[--muted] hover:text-[--text]">Archive</button>
                        <button onClick={() => exportPlanPdf(current)} className="px-2.5 py-1 text-[11px] border border-[--border-2] rounded-lg text-[--muted] hover:text-[--text]">Export PDF</button>
                      </div>
                      <button onClick={openGenerate} className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium pt-1">+ Generate new version</button>
                    </div>
                  )}

                  {archived.length > 0 && (
                    <div>
                      <button onClick={() => setShowPlanHistory(v => !v)} className="text-[11px] text-[--muted] hover:text-[--text] underline">Previous versions {showPlanHistory ? '▲' : '▼'}</button>
                      {showPlanHistory && (
                        <div className="mt-2 space-y-2">
                          {archived.map(p => (
                            <div key={p.id} className="rounded-xl border border-[--border] bg-[--surface-2]/40 px-4 py-2 flex items-center justify-between text-[11px] text-[--muted]">
                              <span>{p.title} · v{p.version} · Effective {fmtD(p.effective_date)}</span>
                              <button onClick={() => exportPlanPdf(p)} className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">Export PDF</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )
            })()
          ) : planDraft ? (
            // ── Generate / Edit form ──
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-serif text-sm font-medium text-[--text]">{planView === 'generate' ? 'Generate HACCP Plan' : `Edit: ${planDraft.title}`}</h3>
                  {planView === 'generate' && (
                    <button onClick={autoGenerate} className="px-3 py-1.5 text-xs font-medium border border-[--accent] text-[--accent] rounded-lg hover:bg-[--accent-light]">Generate plan from location data</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2"><label className="block text-[11px] font-medium text-[--muted] mb-1">Title</label>
                    <input value={planDraft.title} onChange={e => setPlanDraft(d => ({ ...d!, title: e.target.value }))} className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-full" /></div>
                  <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Effective date</label>
                    <input type="date" value={planDraft.effective_date ?? ''} onChange={e => setPlanDraft(d => ({ ...d!, effective_date: e.target.value || null }))} className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-full" /></div>
                  <div><label className="block text-[11px] font-medium text-[--muted] mb-1">Prepared by</label>
                    <input value={planDraft.generated_by} onChange={e => setPlanDraft(d => ({ ...d!, generated_by: e.target.value }))} className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-full" /></div>
                </div>
                {PLAN_SECTIONS.map(s => (
                  <div key={s.key}>
                    <label className="block text-[11px] font-medium text-[--muted] mb-1">{s.label}</label>
                    <textarea rows={3} value={planDraft.plan_data[s.key]} onChange={e => setPlanDraft(d => ({ ...d!, plan_data: { ...d!.plan_data, [s.key]: e.target.value } }))}
                      className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 outline-none focus:border-[--accent] w-full resize-none" />
                  </div>
                ))}
              </div>

              {/* CCP accordion */}
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[--hint] mb-2">Critical Control Points ({ccpDraft.length})</h4>
                {ccpDraft.length === 0 ? (
                  <p className="text-xs text-[--muted]">{planView === 'generate' ? 'Click "Generate plan from location data" to pre-seed the 6 standard CCPs.' : 'No CCPs.'}</p>
                ) : (
                  <div className="space-y-2">
                    {ccpDraft.map((c, i) => (
                      <div key={c.id ?? i} className="bg-white rounded-xl border border-[--border] overflow-hidden">
                        <button onClick={() => setExpandedCcp(expandedCcp === i ? null : i)} className="w-full flex items-center justify-between px-3 py-2 text-left">
                          <span className="text-xs font-medium text-[--text]">CCP {i + 1}: {c.step_name}</span>
                          <span className="text-[--hint] text-[10px]">{expandedCcp === i ? '▲' : '▼'}</span>
                        </button>
                        {expandedCcp === i && (
                          <div className="px-3 pb-3 space-y-2 border-t border-[--border]">
                            <div className="pt-2"><label className="block text-[10px] text-[--muted] mb-1">Step name</label>
                              <input value={c.step_name} onChange={e => setCcpField(i, 'step_name', e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full" /></div>
                            {CCP_FIELDS.map(f => (
                              <div key={f.key}><label className="block text-[10px] text-[--muted] mb-1">{f.label}</label>
                                <textarea rows={2} value={c[f.key]} onChange={e => setCcpField(i, f.key, e.target.value)} className="text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent] w-full resize-none" /></div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={planView === 'generate' ? savePlan : saveEditPlan} disabled={saving}
                  className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
                  {saving ? 'Saving…' : planView === 'generate' ? 'Save plan' : 'Save changes'}
                </button>
                <button onClick={() => { setPlanView('list'); setPlanDraft(null) }} className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">Cancel</button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function SlotCell({ label, status, isPast }: { label: string; status: 'ok' | 'warn' | 'missing'; isPast: boolean }) {
  const icon = status === 'ok' ? '✓' : status === 'warn' ? '⚠' : '—'
  const color = status === 'ok' ? 'text-green-600'
    : status === 'warn' ? 'text-amber-600'
    : isPast ? 'text-red-500' : 'text-[--hint]'
  return (
    <span className={`flex items-center gap-1 ${color}`}>
      <span className="text-[--muted] text-[11px]">{label}</span>
      <span className="font-semibold">{icon}</span>
    </span>
  )
}

// Wrapper so an expandable row pair shares one key without an extra DOM node.
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
