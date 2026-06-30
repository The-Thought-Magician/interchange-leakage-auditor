// ---------------------------------------------------------------------------
// cron.ts — the scheduling-analysis ENGINE.
//
// Pure, deterministic, self-contained functions consumed by route handlers.
// No DB, no network, no external services. Three schedule "kinds" are
// supported:
//   - 'cron'   : a standard 5/6-field cron expression, evaluated via cron-parser
//   - 'rate'   : a human "every N minutes|hours|days" expression, evaluated
//                arithmetically from the `fromISO` anchor
//   - 'oneoff' : a single ISO instant; fires once if it is in the future
// ---------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface JobInput {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string | null
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface FiringWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export type DstTrapType = 'double_fire' | 'skip' | 'ambiguous'

export interface DstTrap {
  type: DstTrapType
  atLocal: string
  atUtc: string
}

export interface CoverageGap {
  gapStart: string
  gapEnd: string
  durationMinutes: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

const DEFAULT_TZ = 'UTC'
const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const RATE_RE = /^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/i

function parseRate(expr: string): { stepMs: number; n: number; unit: string } | null {
  const m = RATE_RE.exec(expr.trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2].toLowerCase()
  let stepMs: number
  if (unit.startsWith('minute')) stepMs = n * MINUTE_MS
  else if (unit.startsWith('hour')) stepMs = n * HOUR_MS
  else stepMs = n * DAY_MS
  return { stepMs, n, unit }
}

function toISO(d: Date): string {
  return new Date(d.getTime()).toISOString()
}

// Returns the timezone's UTC offset (in minutes) at a given instant.
function offsetMinutesAt(date: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(date)
    const map: Record<string, number> = {}
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
    }
    // Reconstruct the "wall clock" time as if it were UTC, then diff.
    const asUTC = Date.UTC(
      map.year,
      (map.month ?? 1) - 1,
      map.day ?? 1,
      map.hour === 24 ? 0 : map.hour ?? 0,
      map.minute ?? 0,
      map.second ?? 0,
    )
    return Math.round((asUTC - date.getTime()) / MINUTE_MS)
  } catch {
    return 0
  }
}

// Format an instant as a local wall-clock ISO-ish string in the given tz.
function formatLocal(date: Date, timeZone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(date)
    const map: Record<string, string> = {}
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value
    }
    const hh = map.hour === '24' ? '00' : map.hour
    return `${map.year}-${map.month}-${map.day}T${hh}:${map.minute}:${map.second}`
  } catch {
    return toISO(date)
  }
}

// Round an instant down to the start of its minute (UTC).
function minuteBucket(iso: string): string {
  const d = new Date(iso)
  d.setUTCSeconds(0, 0)
  return d.toISOString()
}

// ---------------------------------------------------------------------------
// 1. validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (!expr || typeof expr !== 'string' || expr.trim() === '') {
    return { valid: false, error: 'Expression is empty' }
  }
  const e = expr.trim()
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(e)
      return { valid: true }
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : 'Invalid cron expression' }
    }
  }
  if (kind === 'rate') {
    const r = parseRate(e)
    if (!r) return { valid: false, error: 'Rate must be "every N minutes|hours|days" with N > 0' }
    return { valid: true }
  }
  if (kind === 'oneoff') {
    const t = Date.parse(e)
    if (Number.isNaN(t)) return { valid: false, error: 'One-off must be a valid ISO timestamp' }
    return { valid: true }
  }
  return { valid: false, error: `Unknown schedule kind: ${kind}` }
}

// ---------------------------------------------------------------------------
// 2. describeExpression
// ---------------------------------------------------------------------------

export function describeExpression(kind: ScheduleKind, expr: string, timezone: string = DEFAULT_TZ): string {
  const v = validateExpression(kind, expr)
  if (!v.valid) return `Invalid schedule: ${v.error}`
  const e = expr.trim()
  if (kind === 'rate') {
    const r = parseRate(e)!
    return `Runs every ${r.n} ${r.unit} (${timezone})`
  }
  if (kind === 'oneoff') {
    return `Runs once at ${new Date(e).toISOString()} (one-off)`
  }
  // cron
  const fields = e.split(/\s+/)
  const [min, hour, dom, mon, dow] = fields
  const parts: string[] = []
  if (min === '*' && hour === '*') parts.push('every minute')
  else if (min !== '*' && hour === '*') parts.push(`at minute ${min} of every hour`)
  else if (min !== '*' && hour !== '*') parts.push(`at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`)
  else parts.push(`during hour ${hour}`)
  if (dom && dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (mon && mon !== '*') parts.push(`in month ${mon}`)
  if (dow && dow !== '*') parts.push(`on weekday ${dow}`)
  return `Cron "${e}" — ${parts.join(', ')} (${timezone})`
}

// ---------------------------------------------------------------------------
// 3. nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone: string = DEFAULT_TZ,
  fromISO: string = new Date().toISOString(),
  count: number = 10,
): string[] {
  const v = validateExpression(kind, expr)
  if (!v.valid) return []
  const n = Math.max(0, Math.min(count, 1000))
  if (n === 0) return []
  const from = new Date(fromISO)
  if (Number.isNaN(from.getTime())) return []
  const e = expr.trim()

  if (kind === 'oneoff') {
    const t = new Date(e)
    return t.getTime() > from.getTime() ? [t.toISOString()] : []
  }

  if (kind === 'rate') {
    const r = parseRate(e)!
    const out: string[] = []
    let cursor = from.getTime() + r.stepMs
    for (let i = 0; i < n; i++) {
      out.push(new Date(cursor).toISOString())
      cursor += r.stepMs
    }
    return out
  }

  // cron
  try {
    const interval = CronExpressionParser.parse(e, { tz: timezone, currentDate: from })
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      const next = interval.next()
      out.push(next.toDate().toISOString())
    }
    return out
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// 4. computeCollisions
// ---------------------------------------------------------------------------

export function computeCollisions(
  jobs: JobInput[],
  opts: { horizonDays?: number; threshold?: number } = {},
): FiringWindow[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = Math.max(2, opts.threshold ?? 2)
  const now = new Date()
  const fromISO = now.toISOString()
  // Cap per-job firings so very tight rates don't explode the analysis.
  const perJobCap = Math.min(2000, horizonDays * 24 * 60)

  // bucket(minuteISO) -> { jobIds:Set, resources: Map<resourceId, Set<jobId>> }
  const buckets = new Map<string, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()

  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? DEFAULT_TZ, fromISO, perJobCap)
    const horizonEnd = now.getTime() + horizonDays * DAY_MS
    for (const f of firings) {
      if (new Date(f).getTime() > horizonEnd) break
      const key = minuteBucket(f)
      let entry = buckets.get(key)
      if (!entry) {
        entry = { jobIds: new Set(), resources: new Map() }
        buckets.set(key, entry)
      }
      entry.jobIds.add(job.id)
      if (job.resourceId) {
        let rset = entry.resources.get(job.resourceId)
        if (!rset) {
          rset = new Set()
          entry.resources.set(job.resourceId, rset)
        }
        rset.add(job.id)
      }
    }
  }

  const windows: FiringWindow[] = []
  for (const [key, entry] of buckets) {
    const concurrency = entry.jobIds.size
    // Resource contention: >=2 jobs sharing a resource in the same minute.
    let contendedResource: string | undefined
    for (const [rid, set] of entry.resources) {
      if (set.size >= 2) {
        contendedResource = rid
        break
      }
    }
    const overThreshold = concurrency >= threshold
    if (!overThreshold && !contendedResource) continue

    const start = new Date(key)
    const end = new Date(start.getTime() + MINUTE_MS)
    let severity: FiringWindow['severity'] = 'low'
    if (concurrency >= threshold * 2 || contendedResource) severity = 'high'
    else if (concurrency >= threshold) severity = 'medium'

    windows.push({
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      jobIds: Array.from(entry.jobIds).sort(),
      severity,
      ...(contendedResource ? { resourceId: contendedResource } : {}),
    })
  }

  windows.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return windows
}

// ---------------------------------------------------------------------------
// 5. loadHeatmap — firings per hour bucket across the horizon
// ---------------------------------------------------------------------------

export function loadHeatmap(
  jobs: JobInput[],
  opts: { horizonDays?: number } = {},
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const now = new Date()
  const fromISO = now.toISOString()
  const horizonEnd = now.getTime() + horizonDays * DAY_MS
  const perJobCap = Math.min(5000, horizonDays * 24 * 60)

  const counts = new Map<string, number>()
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? DEFAULT_TZ, fromISO, perJobCap)
    for (const f of firings) {
      const t = new Date(f)
      if (t.getTime() > horizonEnd) break
      const b = new Date(t)
      b.setUTCMinutes(0, 0, 0)
      const key = b.toISOString()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ---------------------------------------------------------------------------
// 6. dstTraps — DST-related firing hazards across the window
// ---------------------------------------------------------------------------

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone: string = DEFAULT_TZ,
  fromISO: string = new Date().toISOString(),
  days: number = 365,
): DstTrap[] {
  const v = validateExpression(kind, expr)
  if (!v.valid) return []
  const traps: DstTrap[] = []
  const start = new Date(fromISO)
  if (Number.isNaN(start.getTime())) return []
  const end = new Date(start.getTime() + days * DAY_MS)

  // Find offset-change instants by scanning hourly and bisecting.
  const transitions: Array<{ at: Date; before: number; after: number }> = []
  let cursor = start.getTime()
  let prevOffset = offsetMinutesAt(new Date(cursor), timezone)
  while (cursor < end.getTime()) {
    const nextT = cursor + HOUR_MS
    const off = offsetMinutesAt(new Date(nextT), timezone)
    if (off !== prevOffset) {
      // bisect to the minute
      let lo = cursor
      let hi = nextT
      while (hi - lo > MINUTE_MS) {
        const mid = lo + Math.floor((hi - lo) / 2)
        if (offsetMinutesAt(new Date(mid), timezone) === prevOffset) lo = mid
        else hi = mid
      }
      transitions.push({ at: new Date(hi), before: prevOffset, after: off })
      prevOffset = off
    }
    cursor = nextT
  }

  // For each transition, fetch firings around it and classify.
  for (const tr of transitions) {
    const windowStart = new Date(tr.at.getTime() - 2 * HOUR_MS).toISOString()
    const firings = nextFirings(kind, expr, timezone, windowStart, 200)
    const springForward = tr.after > tr.before // clocks jump forward, an hour is skipped
    const fallBack = tr.after < tr.before // clocks fall back, an hour repeats

    for (const f of firings) {
      const ft = new Date(f).getTime()
      if (ft < tr.at.getTime() - 2 * HOUR_MS || ft > tr.at.getTime() + 2 * HOUR_MS) continue
      const local = formatLocal(new Date(f), timezone)
      if (springForward && Math.abs(ft - tr.at.getTime()) < HOUR_MS) {
        traps.push({ type: 'skip', atLocal: local, atUtc: f })
      } else if (fallBack && Math.abs(ft - tr.at.getTime()) < HOUR_MS) {
        traps.push({ type: 'ambiguous', atLocal: local, atUtc: f })
      }
    }
    // Fall-back can also cause a literal double fire of the same wall-clock time.
    if (fallBack) {
      const repeated = firings.filter((f) => {
        const ft = new Date(f).getTime()
        return ft >= tr.at.getTime() && ft < tr.at.getTime() + Math.abs(tr.after - tr.before) * MINUTE_MS
      })
      const byLocal = new Map<string, string[]>()
      for (const f of repeated) {
        const local = formatLocal(new Date(f), timezone)
        const arr = byLocal.get(local) ?? []
        arr.push(f)
        byLocal.set(local, arr)
      }
      for (const [local, utcs] of byLocal) {
        if (utcs.length >= 2) {
          for (const u of utcs) traps.push({ type: 'double_fire', atLocal: local, atUtc: u })
        }
      }
    }
  }

  // de-dupe
  const seen = new Set<string>()
  return traps.filter((t) => {
    const k = `${t.type}|${t.atUtc}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---------------------------------------------------------------------------
// 7. coverageGaps — periods of the horizon with NO scheduled firing
// ---------------------------------------------------------------------------

export function coverageGaps(
  windows: Array<{ start?: string; end?: string }>,
  jobs: JobInput[],
  opts: { horizonDays?: number; minGapMinutes?: number } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const minGapMinutes = opts.minGapMinutes ?? 60
  const now = new Date()
  const fromISO = now.toISOString()
  const horizonEnd = now.getTime() + horizonDays * DAY_MS
  const perJobCap = Math.min(5000, horizonDays * 24 * 60)

  // Collect all firing instants from every job.
  const instants: number[] = []
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? DEFAULT_TZ, fromISO, perJobCap)
    for (const f of firings) {
      const t = new Date(f).getTime()
      if (t <= horizonEnd) instants.push(t)
    }
  }

  // Optionally fold in explicit "covered" windows (treated as covered ranges).
  const covered: Array<[number, number]> = []
  for (const w of windows) {
    if (w.start && w.end) {
      const s = new Date(w.start).getTime()
      const e = new Date(w.end).getTime()
      if (!Number.isNaN(s) && !Number.isNaN(e) && e > s) covered.push([s, e])
    }
  }

  instants.sort((a, b) => a - b)
  const gaps: CoverageGap[] = []
  let prev = now.getTime()

  const isCovered = (t: number) => covered.some(([s, e]) => t >= s && t <= e)

  for (const t of instants) {
    if (t <= prev) continue
    const gapMs = t - prev
    if (gapMs >= minGapMinutes * MINUTE_MS && !isCovered(prev + gapMs / 2)) {
      gaps.push({
        gapStart: new Date(prev).toISOString(),
        gapEnd: new Date(t).toISOString(),
        durationMinutes: Math.round(gapMs / MINUTE_MS),
      })
    }
    prev = Math.max(prev, t)
  }
  // trailing gap to horizon end
  if (horizonEnd - prev >= minGapMinutes * MINUTE_MS) {
    gaps.push({
      gapStart: new Date(prev).toISOString(),
      gapEnd: new Date(horizonEnd).toISOString(),
      durationMinutes: Math.round((horizonEnd - prev) / MINUTE_MS),
    })
  }

  return gaps
}

// ---------------------------------------------------------------------------
// 8. autoSpread — suggest jitter to relieve collision hot-spots
// ---------------------------------------------------------------------------

export function autoSpread(
  jobs: JobInput[],
  opts: { threshold?: number; horizonDays?: number } = {},
): SpreadSuggestion[] {
  const threshold = Math.max(2, opts.threshold ?? 2)
  const collisions = computeCollisions(jobs, { threshold, horizonDays: opts.horizonDays ?? 7 })

  // Count how many collision windows each job participates in.
  const hotCount = new Map<string, number>()
  for (const w of collisions) {
    for (const id of w.jobIds) hotCount.set(id, (hotCount.get(id) ?? 0) + 1)
  }

  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const suggestions: SpreadSuggestion[] = []

  // For the most-conflicting jobs, propose a staggered offset.
  const ranked = Array.from(hotCount.entries()).sort((a, b) => b[1] - a[1])
  let offsetMinute = 1
  for (const [jobId, n] of ranked) {
    const job = jobById.get(jobId)
    if (!job) continue
    const suggested = suggestSpreadExpr(job, offsetMinute)
    if (suggested && suggested !== job.expr) {
      suggestions.push({
        jobId,
        suggestedExpr: suggested,
        reason: `Job participates in ${n} collision window(s); shift by ${offsetMinute} minute(s) to de-correlate.`,
      })
      offsetMinute = (offsetMinute % 59) + 1
    }
  }

  return suggestions
}

function suggestSpreadExpr(job: JobInput, offsetMinute: number): string | null {
  if (job.kind === 'cron') {
    const fields = job.expr.trim().split(/\s+/)
    if (fields.length < 5) return null
    // Pin the minute field to a staggered value (or shift a numeric minute).
    const minField = fields[0]
    const base = minField === '*' || minField.includes('*') ? 0 : parseInt(minField, 10) || 0
    fields[0] = String((base + offsetMinute) % 60)
    return fields.join(' ')
  }
  if (job.kind === 'rate') {
    // Rates can't carry a phase offset in their textual form; leave a note via expr unchanged.
    return null
  }
  return null
}
