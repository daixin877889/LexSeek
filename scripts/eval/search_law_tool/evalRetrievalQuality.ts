/**
 * 检索效果评估脚本
 *
 * 连接真实数据库执行检索查询，输出指标报告（含 Rerank 前后对比）。
 *
 * 用法:
 *   bun ./scripts/eval/search_law_tool/evalRetrievalQuality.ts                            // 完整评估
 *   bun ./scripts/eval/search_law_tool/evalRetrievalQuality.ts --tags=exact               // 只跑特定标签
 *   bun ./scripts/eval/search_law_tool/evalRetrievalQuality.ts --ids=exact-001,hybrid-001 // 只跑特定用例
 *   bun ./scripts/eval/search_law_tool/evalRetrievalQuality.ts --verbose                  // 输出详细结果
 */

// -----------------------------------------------------------------------
// 初始化全局依赖（模拟 Nuxt 自动导入，必须在导入服务层之前）
// 运行前需加载 preload 插件：bun --preload scripts/eval/bunPreload.ts run ...
// -----------------------------------------------------------------------

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '../../..')

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { logger as sharedLogger } from '../../../shared/utils/logger/index'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

function createPrismaClient() {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    return new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl, options: '-c TimeZone=UTC' }),
    })
}

const g = globalThis as Record<string, unknown>
g.prisma = createPrismaClient()
g.logger = sharedLogger
g.useRuntimeConfig = () => ({
    embedding: {
        apiKey: process.env.NUXT_EMBEDDING_API_KEY || process.env.EMBEDDING_API_KEY,
        baseUrl: process.env.NUXT_EMBEDDING_BASE_URL || process.env.EMBEDDING_BASE_URL,
        model: process.env.NUXT_EMBEDDING_MODEL || 'text-embedding-v4',
        dimensions: Number(process.env.NUXT_EMBEDDING_DIMENSIONS || 1536),
        batchSize: Number(process.env.NUXT_EMBEDDING_BATCH_SIZE || 5),
    },
    rerank: {
        apiKey: process.env.NUXT_RERANK_API_KEY,
        baseUrl: process.env.NUXT_RERANK_BASE_URL,
        model: process.env.NUXT_RERANK_MODEL,
    },
    hnswEfSearch: process.env.NUXT_HNSW_EF_SEARCH,
    public: { logLevel: process.env.LOG_LEVEL || 'INFO' },
})

// -----------------------------------------------------------------------
// 导入服务层（全局依赖就绪后）
// -----------------------------------------------------------------------

import { retrievalRouterService } from '../../../server/services/retrieval/retrievalRouter.service'
import { classifyIntentService } from '../../../server/services/retrieval/intentClassifier.service'
import { hybridSearchService } from '../../../server/services/retrieval/hybridSearch.service'
import { semanticSearchService } from '../../../server/services/retrieval/semanticSearch.service'
import { exactSearchService } from '../../../server/services/retrieval/exactSearch.service'
import type { RetrievalResult, SearchResultItem } from '../../../server/services/retrieval/types'

// -----------------------------------------------------------------------
// 类型定义
// -----------------------------------------------------------------------

interface MatchRule {
    legal_name?: string
    legal_name_contains?: string
    content_contains?: string
    articles_id?: string
}

interface ExpectedHit {
    match: MatchRule
    mustBeInTopN: number
}

interface EvalCase {
    id: string
    query: string
    type: 'law' | 'case_material'
    expectedMode: string
    k: number
    expectedHits: ExpectedHit[]
    tags: string[]
}

interface EvalDataset {
    version: string
    cases: EvalCase[]
}

interface HitResult {
    hit: ExpectedHit
    found: boolean
    rank: number | null  // 1-based rank, null if not found
}

interface CaseResult {
    id: string
    query: string
    expectedMode: string
    actualMode: string | null
    tags: string[]
    // 完整流程（含 Rerank）
    withRerank: {
        hitResults: HitResult[]
        latencyMs: number
        resultCount: number
    }
    // 无 Rerank 流程
    withoutRerank: {
        hitResults: HitResult[]
        latencyMs: number
        resultCount: number
    } | null  // exact 通道为 null
    error?: string
}

interface Metrics {
    total: number
    hitRate: number
    hitCount: number
    recallAtK: number
    recallHitCount: number
    totalExpectedHits: number
    mrr: number
    topNAccuracy: number
    topNHitCount: number
    modeAccuracy: number
    modeCorrectCount: number
    avgLatencyMs: number
}

// -----------------------------------------------------------------------
// 匹配逻辑
// -----------------------------------------------------------------------

function matchesRule(result: RetrievalResult | SearchResultItem, rule: MatchRule): boolean {
    if (rule.legal_name && result.metadata.legal_name !== rule.legal_name) return false
    if (rule.legal_name_contains && !String(result.metadata.legal_name || '').includes(rule.legal_name_contains)) return false
    if (rule.content_contains && !result.content.includes(rule.content_contains)) return false
    if (rule.articles_id && result.metadata.articles_id !== rule.articles_id) return false
    return true
}

function evaluateHits(results: (RetrievalResult | SearchResultItem)[], expectedHits: ExpectedHit[]): HitResult[] {
    return expectedHits.map(hit => {
        for (let i = 0; i < results.length; i++) {
            if (matchesRule(results[i], hit.match)) {
                return { hit, found: true, rank: i + 1 }
            }
        }
        return { hit, found: false, rank: null }
    })
}

// -----------------------------------------------------------------------
// 无 Rerank 检索（直接调用通道函数）
// -----------------------------------------------------------------------

async function searchWithoutRerank(
    evalCase: EvalCase,
): Promise<{ results: SearchResultItem[]; latencyMs: number }> {
    const start = Date.now()
    const intent = await classifyIntentService(evalCase.query, evalCase.type as 'law' | 'case_material')

    let results: SearchResultItem[] = []
    const request = { query: evalCase.query, type: evalCase.type as 'law' | 'case_material', k: evalCase.k }

    switch (intent.intent) {
        case 'exact': {
            const exactResults = await exactSearchService(intent)
            results = exactResults.map(r => ({ score: r.score, content: r.content, metadata: r.metadata }))
            if (results.length === 0) {
                // 降级到 hybrid，但不 rerank
                const fallbackIntent = {
                    ...intent,
                    intent: 'hybrid' as const,
                    keywords: intent.keywords ?? [intent.legalName, intent.articleRef].filter(Boolean) as string[],
                    rewrittenQuery: intent.rewrittenQuery ?? request.query,
                }
                results = await hybridSearchService(fallbackIntent, request)
            }
            break
        }
        case 'hybrid':
            results = await hybridSearchService(intent, request)
            break
        case 'semantic':
            results = await semanticSearchService(intent, request)
            break
    }

    return { results: results.slice(0, evalCase.k), latencyMs: Date.now() - start }
}

// -----------------------------------------------------------------------
// 指标计算
// -----------------------------------------------------------------------

function calculateMetrics(caseResults: CaseResult[], useRerank: boolean): Metrics {
    const validResults = caseResults.filter(r => !r.error)
    const total = validResults.length

    let hitCount = 0
    let recallHitCount = 0
    let totalExpectedHits = 0
    let topNHitCount = 0
    let mrrSum = 0
    let modeCorrectCount = 0
    let totalLatency = 0

    for (const cr of validResults) {
        const data = useRerank ? cr.withRerank : (cr.withoutRerank ?? cr.withRerank)
        const hitResults = data.hitResults
        totalLatency += data.latencyMs

        // Mode accuracy
        if (cr.actualMode === cr.expectedMode) modeCorrectCount++

        // 无 expectedHits 的用例（如 edge 空结果）
        if (hitResults.length === 0) {
            hitCount++ // 没有期望命中 = 默认算命中
            continue
        }

        totalExpectedHits += hitResults.length
        const anyFound = hitResults.some(h => h.found)
        if (anyFound) hitCount++

        // Recall + TopN
        for (const hr of hitResults) {
            if (hr.found) {
                recallHitCount++
                if (hr.rank! <= hr.hit.mustBeInTopN) topNHitCount++
            }
        }

        // MRR — 首个命中结果
        const firstFound = hitResults.find(h => h.found)
        if (firstFound?.rank) {
            mrrSum += 1 / firstFound.rank
        }
    }

    return {
        total,
        hitRate: total > 0 ? hitCount / total : 0,
        hitCount,
        recallAtK: totalExpectedHits > 0 ? recallHitCount / totalExpectedHits : 0,
        recallHitCount,
        totalExpectedHits,
        mrr: total > 0 ? mrrSum / total : 0,
        topNAccuracy: totalExpectedHits > 0 ? topNHitCount / totalExpectedHits : 0,
        topNHitCount,
        modeAccuracy: total > 0 ? modeCorrectCount / total : 0,
        modeCorrectCount,
        avgLatencyMs: total > 0 ? totalLatency / total : 0,
    }
}

// -----------------------------------------------------------------------
// 报告输出
// -----------------------------------------------------------------------

function pct(n: number): string { return `${(n * 100).toFixed(1)}%` }

function printMetrics(label: string, m: Metrics) {
    console.log(`  ${label}:`)
    console.log(`    Hit Rate:       ${pct(m.hitRate)} (${m.hitCount}/${m.total})`)
    console.log(`    Recall@K:       ${pct(m.recallAtK)} (${m.recallHitCount}/${m.totalExpectedHits})`)
    console.log(`    MRR:            ${m.mrr.toFixed(3)}`)
    console.log(`    TopN Accuracy:  ${pct(m.topNAccuracy)} (${m.topNHitCount}/${m.totalExpectedHits})`)
    console.log(`    Mode Accuracy:  ${pct(m.modeAccuracy)} (${m.modeCorrectCount}/${m.total})`)
    console.log(`    Avg Latency:    ${Math.round(m.avgLatencyMs)}ms`)
}

function printReport(caseResults: CaseResult[], verbose: boolean) {
    console.log('\n╔══════════════════════════════════════════════════════════╗')
    console.log(`║     检索效果评估报告 ${new Date().toISOString().slice(0, 16)}        ║`)
    console.log('╠══════════════════════════════════════════════════════════╣\n')

    // 总体指标（含 Rerank）
    const withRerank = calculateMetrics(caseResults, true)
    printMetrics(`总体指标 — With Rerank (${withRerank.total} 条)`, withRerank)

    // 总体指标（不含 Rerank，仅 hybrid+semantic）
    const nonExactCases = caseResults.filter(r => r.withoutRerank !== null)
    if (nonExactCases.length > 0) {
        const withoutRerank = calculateMetrics(nonExactCases, false)
        const withRerankNonExact = calculateMetrics(nonExactCases, true)
        console.log('')
        console.log('  Rerank 效果对比（仅 hybrid + semantic 通道）:')
        console.log('  ┌──────────────┬─────────────────┬─────────────────┬─────────┐')
        console.log('  │ 指标         │ Without Rerank  │ With Rerank     │ Delta   │')
        console.log('  ├──────────────┼─────────────────┼─────────────────┼─────────┤')
        const rows: [string, number, number][] = [
            ['Hit Rate', withoutRerank.hitRate, withRerankNonExact.hitRate],
            ['Recall@K', withoutRerank.recallAtK, withRerankNonExact.recallAtK],
            ['MRR', withoutRerank.mrr, withRerankNonExact.mrr],
            ['TopN Acc', withoutRerank.topNAccuracy, withRerankNonExact.topNAccuracy],
        ]
        for (const [name, without, withR] of rows) {
            const delta = withR - without
            const sign = delta >= 0 ? '+' : ''
            const fmt = name === 'MRR'
                ? (v: number) => v.toFixed(3).padStart(6)
                : (v: number) => pct(v).padStart(6)
            console.log(`  │ ${name.padEnd(12)} │ ${fmt(without).padStart(15)} │ ${fmt(withR).padStart(15)} │ ${(sign + (name === 'MRR' ? delta.toFixed(3) : pct(delta))).padStart(7)} │`)
        }
        console.log('  └──────────────┴─────────────────┴─────────────────┴─────────┘')
    }

    // 按通道分组
    console.log('\n  按通道分组（With Rerank）:')
    const modeGroups = new Map<string, CaseResult[]>()
    for (const cr of caseResults) {
        const mode = cr.expectedMode
        if (!modeGroups.has(mode)) modeGroups.set(mode, [])
        modeGroups.get(mode)!.push(cr)
    }
    console.log('  ┌──────────┬──────────┬───────────┬───────┬──────────┐')
    console.log('  │ 通道     │ Hit Rate │ Recall@K  │ MRR   │ Latency  │')
    console.log('  ├──────────┼──────────┼───────────┼───────┼──────────┤')
    for (const [mode, cases] of modeGroups) {
        const m = calculateMetrics(cases, true)
        console.log(`  │ ${mode.padEnd(8)} │ ${pct(m.hitRate).padStart(8)} │ ${pct(m.recallAtK).padStart(9)} │ ${m.mrr.toFixed(2).padStart(5)} │ ${(Math.round(m.avgLatencyMs) + 'ms').padStart(8)} │`)
    }
    console.log('  └──────────┴──────────┴───────────┴───────┴──────────┘')

    // 失败用例
    const failures = caseResults.filter(cr => {
        if (cr.error) return true
        return cr.withRerank.hitResults.some(h => !h.found)
    })
    if (failures.length > 0) {
        console.log(`\n  失败/部分命中用例 (${failures.length} 条):`)
        for (const cr of failures.slice(0, 15)) {
            if (cr.error) {
                console.log(`    ✗ ${cr.id}: "${cr.query.slice(0, 30)}" — 错误: ${cr.error}`)
            } else {
                const total = cr.withRerank.hitResults.length
                const found = cr.withRerank.hitResults.filter(h => h.found).length
                console.log(`    ✗ ${cr.id}: "${cr.query.slice(0, 30)}" — ${found}/${total} 命中`)
            }
        }
    }

    // Rerank 排名变化详情（verbose 模式）
    if (verbose && nonExactCases.length > 0) {
        console.log('\n  Rerank 逐用例排名变化:')
        for (const cr of nonExactCases) {
            if (!cr.withoutRerank || cr.withRerank.hitResults.length === 0) continue
            for (let i = 0; i < cr.withRerank.hitResults.length; i++) {
                const before = cr.withoutRerank.hitResults[i]
                const after = cr.withRerank.hitResults[i]
                if (!before || !after) continue
                const beforeRank = before.rank ?? '∅'
                const afterRank = after.rank ?? '∅'
                if (beforeRank === afterRank) continue
                const arrow = (after.rank && before.rank && after.rank < before.rank) ? '▲'
                    : (after.rank && before.rank && after.rank > before.rank) ? '▼' : '●'
                console.log(`    ${cr.id}: "${cr.query.slice(0, 25)}" — #${beforeRank} → #${afterRank} ${arrow}`)
            }
        }
    }

    console.log('')
}

// -----------------------------------------------------------------------
// 主逻辑
// -----------------------------------------------------------------------

async function main() {
    const args = process.argv.slice(2)
    const tagsArg = args.find(a => a.startsWith('--tags='))?.split('=')[1]
    const idsArg = args.find(a => a.startsWith('--ids='))?.split('=')[1]
    const verbose = args.includes('--verbose')

    // 加载数据集
    const datasetPath = resolve(__dirname, 'evalDataset.json')
    const dataset: EvalDataset = JSON.parse(readFileSync(datasetPath, 'utf-8'))
    let cases = dataset.cases

    // 过滤
    if (tagsArg) {
        const tags = new Set(tagsArg.split(','))
        cases = cases.filter(c => c.tags.some(t => tags.has(t)))
    }
    if (idsArg) {
        const ids = new Set(idsArg.split(','))
        cases = cases.filter(c => ids.has(c.id))
    }

    console.log(`📊 开始评估，共 ${cases.length} 条用例...\n`)

    const caseResults: CaseResult[] = []

    for (let i = 0; i < cases.length; i++) {
        const evalCase = cases[i]
        const progress = `[${i + 1}/${cases.length}]`

        try {
            // 1. 完整流程（含 Rerank）
            const startFull = Date.now()
            const fullResults = await retrievalRouterService({
                query: evalCase.query,
                type: evalCase.type as 'law' | 'case_material',
                k: evalCase.k,
            })
            const fullLatency = Date.now() - startFull
            const fullHits = evaluateHits(fullResults, evalCase.expectedHits)
            const actualMode = fullResults[0]?.retrievalMode ?? null

            // 2. 无 Rerank 流程（仅非 exact 通道）
            let withoutRerank: CaseResult['withoutRerank'] = null
            if (evalCase.expectedMode !== 'exact') {
                try {
                    const noRerank = await searchWithoutRerank(evalCase)
                    const noRerankHits = evaluateHits(noRerank.results, evalCase.expectedHits)
                    withoutRerank = {
                        hitResults: noRerankHits,
                        latencyMs: noRerank.latencyMs,
                        resultCount: noRerank.results.length,
                    }
                } catch {
                    // 无 Rerank 流程失败不影响主流程
                }
            }

            const found = fullHits.filter(h => h.found).length
            const total = fullHits.length
            const status = total === 0 ? '⬜' : found === total ? '✅' : found > 0 ? '🟡' : '❌'
            console.log(`  ${progress} ${status} ${evalCase.id}: "${evalCase.query.slice(0, 35)}" — ${found}/${total} 命中, ${fullLatency}ms`)

            caseResults.push({
                id: evalCase.id,
                query: evalCase.query,
                expectedMode: evalCase.expectedMode,
                actualMode,
                tags: evalCase.tags,
                withRerank: {
                    hitResults: fullHits,
                    latencyMs: fullLatency,
                    resultCount: fullResults.length,
                },
                withoutRerank,
            })
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            console.log(`  ${progress} 💥 ${evalCase.id}: "${evalCase.query.slice(0, 35)}" — 错误: ${msg}`)
            caseResults.push({
                id: evalCase.id,
                query: evalCase.query,
                expectedMode: evalCase.expectedMode,
                actualMode: null,
                tags: evalCase.tags,
                withRerank: { hitResults: [], latencyMs: 0, resultCount: 0 },
                withoutRerank: null,
                error: msg,
            })
        }
    }

    // 输出报告
    printReport(caseResults, verbose)

    // 保存 JSON 报告
    const reportsDir = resolve(__dirname, 'reports')
    mkdirSync(reportsDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const reportPath = resolve(reportsDir, `${timestamp}.json`)
    const report = {
        timestamp: new Date().toISOString(),
        totalCases: cases.length,
        metrics: {
            withRerank: calculateMetrics(caseResults, true),
            withoutRerank: calculateMetrics(caseResults.filter(r => r.withoutRerank !== null), false),
        },
        caseResults: caseResults.map(cr => ({
            id: cr.id,
            query: cr.query,
            expectedMode: cr.expectedMode,
            actualMode: cr.actualMode,
            tags: cr.tags,
            error: cr.error,
            withRerank: {
                hitResults: cr.withRerank.hitResults.map(h => ({
                    found: h.found,
                    rank: h.rank,
                    mustBeInTopN: h.hit.mustBeInTopN,
                })),
                latencyMs: cr.withRerank.latencyMs,
                resultCount: cr.withRerank.resultCount,
            },
            withoutRerank: cr.withoutRerank ? {
                hitResults: cr.withoutRerank.hitResults.map(h => ({
                    found: h.found,
                    rank: h.rank,
                    mustBeInTopN: h.hit.mustBeInTopN,
                })),
                latencyMs: cr.withoutRerank.latencyMs,
                resultCount: cr.withoutRerank.resultCount,
            } : null,
        })),
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`📄 JSON 报告已保存: ${reportPath}\n`)

    // 退出
    const prismaClient = g.prisma as InstanceType<typeof PrismaClient>
    await prismaClient.$disconnect()
}

main().catch(error => {
    console.error('💥 评估脚本执行失败:', error)
    process.exit(1)
})
