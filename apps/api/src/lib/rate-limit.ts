const WINDOW_MS = 60_000
const LIMIT = 10
const hits = new Map<string, number[]>()

/** Fixed-window limiter, in-process. Fine for a single instance. */
export function allow(key: string, limit = LIMIT, windowMs = WINDOW_MS): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((at) => at > now - windowMs)
  if (recent.length >= limit) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  // Opportunistically drop stale keys so the map cannot grow without bound.
  if (hits.size > 10_000) {
    for (const [k, timestamps] of hits) {
      if (timestamps.every((at) => at <= now - windowMs)) hits.delete(k)
    }
  }
  return true
}
