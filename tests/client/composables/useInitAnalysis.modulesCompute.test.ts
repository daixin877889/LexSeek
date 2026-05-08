/**
 * useInitAnalysis 模块状态推断回归守护测试
 *
 * 历史上发现的三个根因（commit 历史 → 用户描述"模块失败后顶部状态全乱"）：
 * - 根因 1：streaming 状态不会被清除 → 出现多个模块同时 streaming
 * - 根因 2：startAnalysis 用 selectedModules[0]，与服务端 sort 后的执行顺序不一致
 * - 根因 3：SSE 拿到过期 checkpoint 时，把 DB 已知 failed 模块错误重置为 idle 再标 streaming
 *
 * 修复方向：
 * - watch 推断改为「SSE 是补丁、上一帧 prev 是基底，不无故清除已知终态」
 * - startAnalysis firstModule 改用 INIT_ANALYSIS_MODULES 顺序的第一个
 *
 * 本测试 import useInitAnalysis 导出的纯函数，断言修复后的预期行为。
 */

import { describe, it, expect } from 'vitest'
import type { ModuleRunState, InitAnalysisStatusResponse } from '#shared/types/initAnalysis'
import { VALID_MODULE_NAMES } from '#shared/types/initAnalysis'
// 阶段 7 迁移：useInitAnalysis 已删除，纯工具函数搬到 useInitAnalysisModules
import {
    computeModuleStatesFromSnapshot,
    pickFirstSelectedModule,
    extractGlobalStatusSnapshot,
} from '~/composables/initAnalysis/useInitAnalysisModules'

/** initAnalysis.service.ts:14-27 的 validateAndSortModules 排序部分（本地副本） */
function sortByValidOrder(modules: string[]): string[] {
    const unique = [...new Set(modules)]
    return VALID_MODULE_NAMES.filter(m => unique.includes(m))
}

/** 工具：列出 status === 'streaming' 的模块名（按字典序排序，便于 toEqual 比较） */
function streamingModules(states: Record<string, ModuleRunState>): string[] {
    return Object.entries(states)
        .filter(([, s]) => s.status === 'streaming')
        .map(([name]) => name)
        .sort()
}

// ==================== pickFirstSelectedModule（解决根因 2） ====================

describe('pickFirstSelectedModule（解决根因 2：startAnalysis firstModule 与服务端执行顺序对齐）', () => {
    it('用户乱序勾选 [evidence, summary] → 返回 MODULE_ORDER 顺序的首个 = summary', () => {
        expect(pickFirstSelectedModule(['evidence', 'summary'])).toBe('summary')
    })

    it('用户乱序勾选 [claim, summary, chronicle] → 返回 summary（与服务端 validateAndSortModules 一致）', () => {
        expect(pickFirstSelectedModule(['claim', 'summary', 'chronicle'])).toBe('summary')
    })

    it('默认全选 → 返回 summary', () => {
        expect(pickFirstSelectedModule(VALID_MODULE_NAMES.slice())).toBe('summary')
    })

    it('单模块（补充分析场景） → 返回该模块', () => {
        expect(pickFirstSelectedModule(['trend'])).toBe('trend')
    })

    it('空数组 → 返回 undefined', () => {
        expect(pickFirstSelectedModule([])).toBeUndefined()
    })

    it('包含未知模块名 → 仅在 INIT_ANALYSIS_MODULES 范围内挑首个', () => {
        expect(pickFirstSelectedModule(['unknown', 'chronicle', 'summary'])).toBe('summary')
    })
})

// ==================== computeModuleStatesFromSnapshot（解决根因 1+3） ====================

describe('computeModuleStatesFromSnapshot · 根因 1：streaming 残留必须被自动清除', () => {
    it('上一帧的 streaming 模块若不在新 result/failedModules 里，应被自动清除（不再残留）', () => {
        const prev: Record<string, ModuleRunState> = {
            evidence: { name: 'evidence', status: 'streaming', content: '' },
            summary: { name: 'summary', status: 'idle', content: '' },
        }
        const sorted = sortByValidOrder(['evidence', 'summary'])
        const next = computeModuleStatesFromSnapshot(sorted, {}, {}, prev)
        expect(streamingModules(next)).toEqual(['summary'])
        expect(next['evidence']?.status).toBe('idle')
    })

    it('多次推断保持幂等：同样输入两次结果完全一致', () => {
        const sorted = sortByValidOrder(VALID_MODULE_NAMES.slice())
        const f1 = computeModuleStatesFromSnapshot(sorted, {}, {}, {})
        const f2 = computeModuleStatesFromSnapshot(sorted, {}, {}, f1)
        expect(f2).toEqual(f1)
    })

    it('乱序勾选叠加 SSE 接管：startAnalysis 标的 streaming 不再叠加成两个', () => {
        // 模拟 startAnalysis 把用户点击顺序的首个 (claim) 标为 streaming
        const initialFromStartAnalysis: Record<string, ModuleRunState> = {
            claim: { name: 'claim', status: 'streaming', content: '' },
            summary: { name: 'summary', status: 'idle', content: '' },
            chronicle: { name: 'chronicle', status: 'idle', content: '' },
        }
        // SSE 接管后 selectedModules 被覆盖为 sorted
        const sorted = sortByValidOrder(['claim', 'summary', 'chronicle'])
        const next = computeModuleStatesFromSnapshot(sorted, {}, {}, initialFromStartAnalysis)

        // 应只有一个 streaming（按 sorted 顺序的第一个 = summary），claim 残留必须被清除
        expect(streamingModules(next)).toEqual(['summary'])
    })
})

describe('computeModuleStatesFromSnapshot · 根因 3：DB restored 的终态必须保留', () => {
    it('刷新场景：chronicle DB 已 failed，但 SSE 第一帧 failedModules 为空 → 必须保留 failed', () => {
        const sorted = sortByValidOrder(VALID_MODULE_NAMES.slice())
        const restored: Record<string, ModuleRunState> = {
            summary: { name: 'summary', status: 'complete', content: '已生成的摘要' },
            chronicle: { name: 'chronicle', status: 'failed', content: '', error: '执行失败' },
            claim: { name: 'claim', status: 'streaming', content: '' },
        }
        const next = computeModuleStatesFromSnapshot(
            sorted,
            { summary: '已生成的摘要' },
            {},  // ← 过期 checkpoint，无 chronicle 失败信息
            restored,
        )
        // chronicle 必须保留 failed（来自 DB restored）
        expect(next['chronicle']?.status).toBe('failed')
        expect(next['chronicle']?.error).toBe('执行失败')
        // 唯一 streaming 应是 claim（实际服务端正在跑）
        expect(streamingModules(next)).toEqual(['claim'])
    })

    it('complete 终态在 SSE result 缺失时也必须保留', () => {
        const sorted = sortByValidOrder(['summary', 'chronicle'])
        const prev: Record<string, ModuleRunState> = {
            summary: { name: 'summary', status: 'complete', content: '摘要' },
        }
        const next = computeModuleStatesFromSnapshot(sorted, {}, {}, prev)
        expect(next['summary']?.status).toBe('complete')
        expect(next['summary']?.content).toBe('摘要')
    })

    it('叠加根因 1+3：刷新后只剩一个 streaming 指向真正在跑的模块', () => {
        const sorted = sortByValidOrder(VALID_MODULE_NAMES.slice())
        const restored: Record<string, ModuleRunState> = {
            summary: { name: 'summary', status: 'complete', content: '摘要' },
            chronicle: { name: 'chronicle', status: 'failed', content: '', error: 'X' },
            claim: { name: 'claim', status: 'streaming', content: '' },  // DB 显示 claim 在跑
        }
        const next = computeModuleStatesFromSnapshot(
            sorted,
            { summary: '摘要' },
            {},
            restored,
        )
        // 修复后：summary✓ + chronicle❌ + claim⟳，没有 streaming 残留
        expect(streamingModules(next)).toEqual(['claim'])
        expect(next['chronicle']?.status).toBe('failed')
    })
})

describe('computeModuleStatesFromSnapshot · 正常流程不应有回归', () => {
    const modules = ['summary', 'chronicle', 'claim']

    it('全部 idle 时第一个推断为 streaming', () => {
        const next = computeModuleStatesFromSnapshot(modules, {}, {}, {})
        expect(next['summary']?.status).toBe('streaming')
        expect(next['chronicle']?.status).toBe('idle')
        expect(next['claim']?.status).toBe('idle')
    })

    it('summary 完成 → chronicle 推断为 streaming', () => {
        const prev: Record<string, ModuleRunState> = {
            summary: { name: 'summary', status: 'streaming', content: '' },
            chronicle: { name: 'chronicle', status: 'idle', content: '' },
            claim: { name: 'claim', status: 'idle', content: '' },
        }
        const next = computeModuleStatesFromSnapshot(modules, { summary: '摘要' }, {}, prev)
        expect(next['summary']?.status).toBe('complete')
        expect(next['chronicle']?.status).toBe('streaming')
        expect(next['claim']?.status).toBe('idle')
    })

    it('chronicle 失败 → claim 推断为 streaming', () => {
        const prev: Record<string, ModuleRunState> = {
            summary: { name: 'summary', status: 'complete', content: '摘要' },
            chronicle: { name: 'chronicle', status: 'streaming', content: '' },
            claim: { name: 'claim', status: 'idle', content: '' },
        }
        const next = computeModuleStatesFromSnapshot(
            modules,
            { summary: '摘要' },
            { chronicle: '执行失败' },
            prev,
        )
        expect(next['summary']?.status).toBe('complete')
        expect(next['chronicle']?.status).toBe('failed')
        expect(next['chronicle']?.error).toBe('执行失败')
        expect(next['claim']?.status).toBe('streaming')
    })

    it('全部进入终态 → 没有 streaming', () => {
        const next = computeModuleStatesFromSnapshot(
            modules,
            { summary: '摘要', claim: '请求权' },
            { chronicle: '执行失败' },
            {},
        )
        expect(streamingModules(next)).toEqual([])
        expect(next['summary']?.status).toBe('complete')
        expect(next['chronicle']?.status).toBe('failed')
        expect(next['claim']?.status).toBe('complete')
    })

    it('result 优先级 > failedModules：retryModule 重新成功后即使 failedModules 还有旧 key 也显示 complete', () => {
        const next = computeModuleStatesFromSnapshot(
            ['chronicle'],
            { chronicle: '重试成功的内容' },
            { chronicle: '上次失败' },
            {},
        )
        expect(next['chronicle']?.status).toBe('complete')
        expect(next['chronicle']?.content).toBe('重试成功的内容')
    })

    it('补充分析（单模块）场景：trend 单独跑', () => {
        const next = computeModuleStatesFromSnapshot(['trend'], {}, {}, {})
        expect(next['trend']?.status).toBe('streaming')
        expect(Object.keys(next)).toEqual(['trend'])
    })
})

// ==================== extractGlobalStatusSnapshot（修复：首次加载 status 没推给 projection 的 statusModules / resultFromDB） ====================

describe('extractGlobalStatusSnapshot · 把 InitAnalysisStatusResponse 拆解成 projection 依赖的快照', () => {
    it('空 modules → 三段快照都是空', () => {
        const status: InitAnalysisStatusResponse = {
            status: 'not_started',
            modules: [],
            result: {},
        }
        const snap = extractGlobalStatusSnapshot(status)
        expect(snap.completedModules).toEqual([])
        expect(snap.statusModules).toEqual([])
        expect(snap.resultFromDB).toEqual({})
    })

    it('部分 complete + 部分 idle：completedModules 仅含 complete；statusModules 原样返回；resultFromDB 取 status.result', () => {
        const status: InitAnalysisStatusResponse = {
            status: 'in_progress',
            modules: [
                { name: 'summary', status: 'complete', result: '案件概要内容', version: 1, analyzedAt: '2026-05-01T00:00:00Z' },
                { name: 'chronicle', status: 'in_progress' },
                { name: 'claim', status: 'idle' },
            ],
            result: { summary: '案件概要内容' },
        }
        const snap = extractGlobalStatusSnapshot(status)
        expect(snap.completedModules).toEqual(['summary'])
        expect(snap.statusModules).toHaveLength(3)
        expect(snap.statusModules[0]).toEqual({
            name: 'summary',
            status: 'complete',
            result: '案件概要内容',
            version: 1,
            analyzedAt: '2026-05-01T00:00:00Z',
        })
        expect(snap.resultFromDB).toEqual({ summary: '案件概要内容' })
    })

    it('修复点：DB 已 complete 但当前 session 没选中该模块时，statusModules 仍把它带回，避免 projection 落到 idle 显示"未生成"', () => {
        const status: InitAnalysisStatusResponse = {
            status: 'in_progress',
            // 当前 session 只跑了 chronicle；summary 是历史 session 的成品
            selectedModules: ['chronicle'],
            modules: [
                { name: 'summary', status: 'complete', result: '历史成品', version: 2 },
                { name: 'chronicle', status: 'in_progress' },
            ],
            result: { summary: '历史成品' },
        }
        const snap = extractGlobalStatusSnapshot(status)
        // statusModules 必须把 summary 带回，让 projection 能在 localStates 没值的情况下回退到 globalModules → complete
        const summary = snap.statusModules.find(m => m.name === 'summary')
        expect(summary?.status).toBe('complete')
        expect(summary?.result).toBe('历史成品')
        // resultFromDB 也必须把 summary 带回
        expect(snap.resultFromDB.summary).toBe('历史成品')
        // completedModules 用于禁用 ModuleSelector 已完成项
        expect(snap.completedModules).toEqual(['summary'])
    })

    it('result 字段缺失时 resultFromDB 兜底为空对象', () => {
        const status: InitAnalysisStatusResponse = {
            status: 'completed',
            modules: [
                { name: 'summary', status: 'complete', result: '内容' },
            ],
            // result 字段缺失
        }
        const snap = extractGlobalStatusSnapshot(status)
        expect(snap.resultFromDB).toEqual({})
    })

    it('failed 模块不进 completedModules，但保留在 statusModules 让 projection 显示 failed', () => {
        const status: InitAnalysisStatusResponse = {
            status: 'in_progress',
            modules: [
                { name: 'summary', status: 'complete', result: '内容' },
                { name: 'chronicle', status: 'failed' },
            ],
            result: { summary: '内容' },
        }
        const snap = extractGlobalStatusSnapshot(status)
        expect(snap.completedModules).toEqual(['summary'])
        expect(snap.statusModules.find(m => m.name === 'chronicle')?.status).toBe('failed')
    })
})
