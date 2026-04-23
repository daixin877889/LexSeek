import type { MemoryHit } from '#shared/types/memory'

/**
 * 时间衰减（半衰期公式）
 * 公式：0.5 ^ (daysSinceCreated / halfLifeDays)
 */
export function recencyDecay(createdAtISO: string, halfLifeDays: number): number {
  const now = Date.now()
  const created = new Date(createdAtISO).getTime()
  const days = Math.max(0, (now - created) / (24 * 60 * 60 * 1000))
  return Math.pow(0.5, days / halfLifeDays)
}

/**
 * Subject 版本链打分
 * final = base × recencyDecay(30d) × (invalidated ? 0 : 1) × (isLatestInSubject ? 1.0 : 0.3)
 */
export function subjectVersionScoring(hits: MemoryHit[]): MemoryHit[] {
  const latestBySubject = new Map<string, string>()
  for (const h of hits) {
    const key = h.metadata.subjectKey
    if (!key) continue
    const prevId = latestBySubject.get(key)
    const prevHit = prevId ? hits.find((x) => x.id === prevId) : undefined
    if (!prevHit || h.metadata.createdAt > prevHit.metadata.createdAt) {
      latestBySubject.set(key, h.id)
    }
  }

  return hits
    .map((h) => {
      const invalidated = !!h.metadata.invalidatedAt
      const hasSubject = !!h.metadata.subjectKey
      const isLatest = !hasSubject || latestBySubject.get(h.metadata.subjectKey!) === h.id
      const decay = recencyDecay(h.metadata.createdAt, 30)
      const versionWeight = isLatest ? 1.0 : 0.3
      const score = invalidated ? 0 : h.score * decay * versionWeight
      return { ...h, score }
    })
    .sort((a, b) => b.score - a.score)
}
