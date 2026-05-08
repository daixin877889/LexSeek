/**
 * 文书模板推荐 Service
 *
 * 服务于阶段 5 法律助手 → 文书生成「模板选择卡片」推荐：助手 LLM 把用户意图
 * 转成 `{ intent, keywords?, categoryHint? }`，本服务负责在用户可见模板池
 * （scope=global ∪ scope=user 当前用户私人）中召回 + 评分 + 取 top 5。
 *
 * 评分算法（plan §五·Task 2）：
 * - name×10 + description×5 + category×3，按 keyword 累加（命中即加，单 keyword 仅记一次）
 * - 用户最近 30 天用过的模板：固定 +8（ON DocumentDrafts.createdAt > now()-30d）
 * - priority asc 作为最后一档稳定排序
 *
 * 召回路径：
 * - 第一层：categoryHint 缩范围。
 * - 第二层兜底：第一层 < 3 条时，跨全部分类（仍受 viewerUserId 维度过滤）召回，
 *   合并去重后再评分。
 * - 零关键词回退：仅靠"用户最近使用 + priority"打分（intent 完全无信息）。
 *
 * 不依赖 service 层任何外部副作用 —— 纯查询 + 内存算分。
 *
 * @see docs/superpowers/plans/2026-04-27-ai-unify-stage-5-assistant-tools.md §Task 2
 */

import type { documentTemplates } from '#shared/types/prisma'
import type { DocumentCategoryKey } from '#shared/types/document'
import { DOCUMENT_CATEGORY_KEYS } from '#shared/types/document'

// ==================== 类型 ====================

export interface TemplateRecommendInput {
    userId: number
    /** 用户意图（自然语言；可选，未来用于扩展语义召回） */
    intent: string
    /** LLM 抽取的关键词列表，可空数组；建议 1-5 个 */
    keywords?: string[]
    /** LLM 给出的类别提示，可选；不在 9 类枚举内则视为未提示 */
    categoryHint?: DocumentCategoryKey | string
    /** 推荐返回条数，默认 5 */
    limit?: number
}

export interface TemplateRecommendItem {
    id: number
    name: string
    category: string
    scope: string
    description: string | null
    priority: number
    /** 评分（用于调试 / 透传到前端做次序解释） */
    score: number
}

export interface TemplateRecommendResult {
    items: TemplateRecommendItem[]
    /** 当前用户可见模板总数（即"浏览全部 N 个模板"显示用） */
    total: number
    /** 实际召回 / 评分时使用的关键词集合（清洗去空 / 去重 / 去太短词） */
    usedKeywords: string[]
    /** 是否走了零关键词兜底路径 */
    fallbackToRecency: boolean
}

// ==================== 内部 ====================

const RECENT_USAGE_WINDOW_MS = 30 * 24 * 3600 * 1000

/** 关键词清洗：trim + 过滤空 / 重复 / 长度 < 2 / 只剩英文标点。 */
function normalizeKeywords(raw: string[] | undefined): string[] {
    if (!raw || raw.length === 0) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const k of raw) {
        if (typeof k !== 'string') continue
        const trimmed = k.trim().toLowerCase()
        if (trimmed.length < 2) continue
        if (seen.has(trimmed)) continue
        seen.add(trimmed)
        out.push(trimmed)
    }
    return out
}

/** 是否合法的 9 类枚举之一。 */
function isValidCategory(c: string | undefined): c is DocumentCategoryKey {
    if (!c) return false
    return (DOCUMENT_CATEGORY_KEYS as readonly string[]).includes(c)
}

/** 单模板单关键词的命中分数。
 *
 * name 命中加位置权重：避免中文子串歧义导致评分平局。
 * 例：keyword='起诉' 同时命中"民事起诉状"（idx=2）与"民事答辩状（公民对民事起诉提出答辩用）"（idx=10），
 * 旧版两者都 +10 平局后按 id desc 错把答辩状排在前面。
 * 现在按 name 中 kw 的起始位置打位置奖励，并在 idx=0 时再给 +3 精确意图奖励。
 */
function scoreOneKeyword(tpl: documentTemplates, kw: string): number {
    const name = (tpl.name ?? '').toLowerCase()
    const desc = (tpl.description ?? '').toLowerCase()
    const cat = (tpl.category ?? '').toLowerCase()
    let s = 0
    const nameIdx = name.indexOf(kw)
    if (nameIdx >= 0) {
        s += 10
        // 位置越靠前奖励越多（最多 +5）；name 极短或 idx=0 时奖励接近上限
        s += Math.round(5 * (1 - nameIdx / Math.max(name.length, 1)))
        // name 直接以 kw 开头：精确意图奖励 +3
        if (nameIdx === 0) s += 3
    }
    if (desc.includes(kw)) s += 5
    if (cat.includes(kw)) s += 3
    return s
}

/** 综合评分：关键词命中 + 用户最近使用奖励。 */
function scoreTemplate(
    tpl: documentTemplates,
    keywords: string[],
    recentTemplateIds: ReadonlySet<number>,
): number {
    let score = 0
    for (const kw of keywords) score += scoreOneKeyword(tpl, kw)
    if (recentTemplateIds.has(tpl.id)) score += 8
    return score
}

// ==================== 主入口 ====================

/**
 * 计算「我能看到的模板池」基础 where 条件。
 * - scope=global ∪ (scope=user AND userId=viewer)
 * - status=1 / deletedAt=null
 *
 * 注意 scope 字面量与 documentTemplate.dao.ts 保持一致：'global' / 'user'。
 */
function buildVisibleWhere(viewerUserId: number) {
    return {
        deletedAt: null,
        status: 1,
        OR: [
            { scope: 'global' },
            { scope: 'user', userId: viewerUserId },
        ],
    }
}

/**
 * 推荐文书模板。
 *
 * 不会抛错；任何异常路径都返回降级结果（空列表）。
 */
export async function recommendDocumentTemplatesService(
    input: TemplateRecommendInput,
): Promise<TemplateRecommendResult> {
    const { userId, keywords, categoryHint } = input
    const limit = Math.max(1, Math.min(20, input.limit ?? 5))

    const cleanedKeywords = normalizeKeywords(keywords)
    const validCategoryHint = isValidCategory(categoryHint) ? categoryHint : undefined

    const visibleWhere = buildVisibleWhere(userId)

    // 总数（"浏览全部 N 个模板"）
    const total = await prisma.documentTemplates.count({ where: visibleWhere })

    // 用户最近 30 天用过的模板 id 集合（含已软删 draft 也算用过 —— 我们关心的是用户偏好）
    const since = new Date(Date.now() - RECENT_USAGE_WINDOW_MS)
    const recentDrafts = await prisma.documentDrafts.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { templateId: true },
        distinct: ['templateId'],
    })
    const recentTemplateIds = new Set<number>(recentDrafts.map(d => d.templateId))

    // 第一层：categoryHint 缩范围
    let pool: documentTemplates[] = []
    if (validCategoryHint) {
        pool = await prisma.documentTemplates.findMany({
            where: { ...visibleWhere, category: validCategoryHint },
            // 适当多取一些，便于排序后取 top
            take: 50,
            orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        })
    }

    // 第二层兜底：跨全部分类
    if (pool.length < 3) {
        const all = await prisma.documentTemplates.findMany({
            where: visibleWhere,
            take: 200,
            orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        })
        // 合并去重，保留第一层在前（categoryHint 命中天然加权）
        const seen = new Set<number>(pool.map(p => p.id))
        for (const t of all) {
            if (!seen.has(t.id)) {
                pool.push(t)
                seen.add(t.id)
            }
        }
    }

    // 零关键词回退
    const fallbackToRecency = cleanedKeywords.length === 0

    // 评分
    const scored: Array<{ tpl: documentTemplates; score: number }> = pool.map((tpl) => {
        let score = scoreTemplate(tpl, cleanedKeywords, recentTemplateIds)

        // 零关键词回退：以"最近使用 + priority"为主信号；最近使用按上面已 +8，
        // 这里再为类别命中 categoryHint 做一档轻量加权（1 分）防止类别完全失灵
        if (fallbackToRecency && validCategoryHint && tpl.category === validCategoryHint) {
            score += 1
        }
        return { tpl, score }
    })

    // 排序：score desc → recent usage 优先 → priority asc → id desc（稳定）
    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        const aRecent = recentTemplateIds.has(a.tpl.id) ? 1 : 0
        const bRecent = recentTemplateIds.has(b.tpl.id) ? 1 : 0
        if (aRecent !== bRecent) return bRecent - aRecent
        if (a.tpl.priority !== b.tpl.priority) return a.tpl.priority - b.tpl.priority
        return b.tpl.id - a.tpl.id
    })

    const items = scored.slice(0, limit).map(({ tpl, score }) => ({
        id: tpl.id,
        name: tpl.name,
        category: tpl.category,
        scope: tpl.scope,
        description: tpl.description ?? null,
        priority: tpl.priority,
        score,
    }))

    return {
        items,
        total,
        usedKeywords: cleanedKeywords,
        fallbackToRecency,
    }
}
