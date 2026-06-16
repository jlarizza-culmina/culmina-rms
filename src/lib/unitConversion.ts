// src/lib/unitConversion.ts
// Converts recipe ingredient amounts between native, English (imperial), and
// metric units for the production pull list.

export type UnitClass = 'metric_volume' | 'imperial_volume' |
                        'metric_weight' | 'imperial_weight' | 'count'

export function classifyUnit(unit: string): UnitClass {
  const u = unit.toLowerCase().trim()
  if (['ml','l','cl','litre','liter'].includes(u)) return 'metric_volume'
  if (['fl oz','cup','cups','pint','quart','gallon','tbsp','tsp','tablespoon','teaspoon'].includes(u)) return 'imperial_volume'
  if (['g','kg','gram','grams','kilogram'].includes(u)) return 'metric_weight'
  if (['oz','lb','lbs','pound','pounds','ounce','ounces'].includes(u)) return 'imperial_weight'
  return 'count'  // each, clove, sprig, bottle, carton, bunch, head, etc.
}

// Convert any amount+unit to a base unit (ml for volume, g for weight)
export function toBaseUnit(amount: number, unit: string): { value: number; base: 'ml' | 'g' | 'count' } {
  const cls = classifyUnit(unit)
  const u = unit.toLowerCase().trim()
  if (cls === 'count') return { value: amount, base: 'count' }
  if (cls === 'metric_volume') {
    const ml = u === 'l' || u === 'litre' || u === 'liter' ? amount * 1000
             : u === 'cl' ? amount * 10
             : amount
    return { value: ml, base: 'ml' }
  }
  if (cls === 'imperial_volume') {
    const ml = u === 'cup' || u === 'cups' ? amount * 236.588
             : u === 'pint' ? amount * 473.176
             : u === 'quart' ? amount * 946.353
             : u === 'gallon' ? amount * 3785.41
             : u === 'tbsp' || u === 'tablespoon' ? amount * 14.787
             : u === 'tsp' || u === 'teaspoon' ? amount * 4.929
             : amount * 29.5735  // fl oz default
    return { value: ml, base: 'ml' }
  }
  if (cls === 'metric_weight') {
    const g = u === 'kg' || u === 'kilogram' ? amount * 1000 : amount
    return { value: g, base: 'g' }
  }
  // imperial_weight
  const g = u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds'
            ? amount * 453.592 : amount * 28.3495
  return { value: g, base: 'g' }
}

export function formatNative(amount: number, unit: string): string {
  return `${+amount.toFixed(1)} ${unit}`
}

export function formatEnglish(amount: number, unit: string): string {
  const cls = classifyUnit(unit)
  if (cls === 'count') return `${amount} ${unit}`
  const { value, base } = toBaseUnit(amount, unit)
  if (base === 'ml') {
    const floz = value * 0.033814
    return `${+floz.toFixed(1)} fl oz`
  }
  const oz = value * 0.035274
  if (oz >= 16) return `${+(oz/16).toFixed(2)} lb`
  return `${+oz.toFixed(1)} oz`
}

export function formatMetric(amount: number, unit: string): string {
  const cls = classifyUnit(unit)
  if (cls === 'count') return `${amount} ${unit}`
  const { value, base } = toBaseUnit(amount, unit)
  if (base === 'ml') {
    if (value >= 1000) return `${+(value/1000).toFixed(2)} L`
    return `${+value.toFixed(0)} ml`
  }
  if (value >= 1000) return `${+(value/1000).toFixed(2)} kg`
  return `${+value.toFixed(0)} g`
}

// Purchase unit calculation: ceil(native / purchase_unit_qty)
// Returns null if purchase_unit_qty is missing
export function formatPurchase(
  amount: number,
  unit: string,
  purchaseUnitQty: number | null | undefined,
  purchaseUnitLabel: string | null | undefined
): string | null {
  if (!purchaseUnitQty || !purchaseUnitLabel) return null
  const { value: nativeBase } = toBaseUnit(amount, unit)
  const { value: purchaseBase } = toBaseUnit(purchaseUnitQty, purchaseUnitLabel)
  if (nativeBase === 0 || purchaseBase === 0) return null
  const count = Math.ceil(nativeBase / purchaseBase)
  return `${count} ${purchaseUnitLabel}`
}
