// shared/utils/tools/algorithms/calculateSegmentedInterest.ts
import { daysBetween } from '#shared/utils/tools/utils/date'

export interface SegmentInput {
    principal: number
    startDate: string | Date
    endDate: string | Date
    rateLookup: (date: Date) => number
    /** 利率切换点 — 当跨利率时需要传入（用 data 层数据生成） */
    rateChangePoints?: string[]
}

export interface InterestSegment {
    startDate: string
    endDate: string
    days: number
    rate: number
    interest: number
}

export function calculateSegmentedInterest(input: SegmentInput): InterestSegment[] {
    const start = new Date(input.startDate)
    const end = new Date(input.endDate)
    if (start > end) return []

    // 取出在 [start, end] 内的所有利率切换点
    const breaks = (input.rateChangePoints ?? [])
        .map((d) => new Date(d))
        .filter((d) => d > start && d <= end)
        .sort((a, b) => a.getTime() - b.getTime())

    const segments: InterestSegment[] = []
    let curStart = start
    for (const br of breaks) {
        const segEnd = new Date(br.getTime() - 86400000)
        const rate = input.rateLookup(curStart)
        const days = daysBetween(curStart, segEnd) + 1
        segments.push({
            startDate: curStart.toISOString().slice(0, 10),
            endDate: segEnd.toISOString().slice(0, 10),
            days,
            rate,
            interest: (input.principal * (rate / 100) / 365) * days,
        })
        curStart = br
    }
    // 最后一段
    const rate = input.rateLookup(curStart)
    const days = daysBetween(curStart, end)
    segments.push({
        startDate: curStart.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        days,
        rate,
        interest: (input.principal * (rate / 100) / 365) * days,
    })

    return segments
}
