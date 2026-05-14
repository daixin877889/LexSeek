// shared/utils/tools/algorithms/calculateSegmentedInterest.ts
import { daysBetween } from '#shared/utils/tools/utils/date'

export interface SegmentInput {
    principal: number
    startDate: string | Date
    endDate: string | Date
    rateLookup: (date: Date) => number
    /** 利率切换点 — 当跨利率时需要传入（用 data 层数据生成）；
     *  未传时函数会逐日扫描 rateLookup 自动发现切换点。 */
    rateChangePoints?: string[]
}

export interface InterestSegment {
    startDate: string
    endDate: string
    days: number
    rate: number
    interest: number
}

/** 从 [start, end] 范围内的 rateLookup 逐日扫描，返回利率发生变化的日期列表（升序）。 */
function detectRateChangeDates(start: Date, end: Date, rateLookup: (d: Date) => number): Date[] {
    const changes: Date[] = []
    let prevRate = rateLookup(start)
    const cur = new Date(start)
    cur.setDate(cur.getDate() + 1)
    while (cur <= end) {
        const rate = rateLookup(new Date(cur))
        if (rate !== prevRate) {
            changes.push(new Date(cur))
            prevRate = rate
        }
        cur.setDate(cur.getDate() + 1)
    }
    return changes
}

export function calculateSegmentedInterest(input: SegmentInput): InterestSegment[] {
    const start = new Date(input.startDate)
    const end = new Date(input.endDate)
    if (start > end) return []

    // 确定利率切换点列表
    let breaks: Date[]
    if (input.rateChangePoints && input.rateChangePoints.length > 0) {
        breaks = input.rateChangePoints
            .map((d) => new Date(d))
            .filter((d) => d > start && d <= end)
            .sort((a, b) => a.getTime() - b.getTime())
    } else {
        breaks = detectRateChangeDates(start, end, input.rateLookup)
    }

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
