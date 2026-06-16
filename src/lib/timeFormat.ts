// src/lib/timeFormat.ts
// Convert between 12-hour display strings ("6:00 AM") and 24-hour storage
// strings ("06:00") for PostgreSQL `time` columns.

export function to24Hour(time12: string): string {
  if (!time12) return ''
  const [time, period] = time12.split(' ')
  const [hoursStr, minutes] = time.split(':')
  let hours = parseInt(hoursStr, 10)
  if (period === 'PM' && hours !== 12) hours += 12
  if (period === 'AM' && hours === 12) hours = 0
  return `${hours.toString().padStart(2, '0')}:${minutes}`
}

export function to12Hour(time24: string): string {
  if (!time24) return ''
  const [hoursStr, minutes] = time24.split(':')
  let hours = parseInt(hoursStr, 10)
  const period = hours >= 12 ? 'PM' : 'AM'
  if (hours > 12) hours -= 12
  if (hours === 0) hours = 12
  return `${hours}:${minutes} ${period}`
}
