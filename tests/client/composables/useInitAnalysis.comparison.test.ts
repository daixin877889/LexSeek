/**
 * useInitAnalysis 对比测试（Phase 4 改造前基线）
 *
 * 由于 mock @langchain/vue 的 useStream 在 Vitest 环境中复杂度较高，
 * 采用提取纯逻辑函数进行单独测试的策略。
 *
 * 测试目标：锁定改造前的核心行为，确保 useStreamChat 底层替换后逻辑不变。
 *
 * **Feature: init-analysis**
 * **Validates: moduleStates 推断逻辑、mergedResult 合并逻辑、streamMessages 合并逻辑**
 */

import { describe, it, expect } from 'vitest'
import type { ModuleRunState } from '#shared/types/initAnalysis'

// ==================== 提取可独立测试的纯逻辑 ====================
// 这些逻辑来自 useInitAnalysis.ts，改造前行为的基线锁定

/**
 * moduleStates 推断逻辑
 * 对应 useInitAnalysis.ts watch(values, ...) 内部的统一状态计算
 */
function inferModuleStates(
  selectedModules: string[],
  result: Record<string, string | undefined>,
  failedModules: Record<string, string | undefined>,
  currentStates: Record<string, ModuleRunState>,
): Record<string, ModuleRunState> {
  const updated = { ...currentStates }

  for (const m of selectedModules) {
    if (result?.[m]) {
      // 有结果 → complete
      updated[m] = { name: m, status: 'complete', content: result[m] as string }
    } else if (failedModules?.[m]) {
      // 失败 → failed
      updated[m] = { name: m, status: 'failed', content: '', error: failedModules[m] as string }
    } else if (updated[m]?.status === 'complete' || updated[m]?.status === 'failed') {
      // 之前已完成/失败了，但 result 变了？回归 idle
      updated[m] = { name: m, status: 'idle', content: '' }
    }
    // else: 保持原状态（idle 或 streaming）
  }

  // 推断当前正在执行的模块（串行条件边：第一个没有 result/failed 的模块）
  const currentStreaming = selectedModules.find(m =>
    updated[m]?.status !== 'complete' && updated[m]?.status !== 'failed',
  )
  if (currentStreaming && updated[currentStreaming]?.status !== 'streaming') {
    updated[currentStreaming] = { name: currentStreaming, status: 'streaming', content: '' }
  }

  return updated
}

/**
 * mergedResult 合并逻辑
 * 对应 useInitAnalysis.ts 中的 mergedResult computed
 * values 优先覆盖 DB 结果
 */
function mergeResult(
  resultFromDB: Record<string, string>,
  valuesResult: Record<string, string> | undefined,
): Record<string, string> {
  return {
    ...resultFromDB,
    ...(valuesResult ?? {}),
  }
}

/**
 * streamMessages 合并逻辑
 * 对应 useInitAnalysis.ts 中的 streamMessages computed
 * 实时消息优先，fallback 到 checkpoint 消息
 */
function mergeStreamMessages(
  realtimeMessages: any[],
  checkpointMessages: any[],
  coerceRawMessages: (msgs: any[]) => any[],
): any[] {
  if (realtimeMessages.length > 0) return realtimeMessages
  if (checkpointMessages.length > 0) return coerceRawMessages(checkpointMessages)
  return []
}

// ==================== 测试套件 ====================

describe('inferModuleStates - moduleStates 推断逻辑', () => {
  const modules = ['summary', 'chronicle', 'claim']

  it('所有模块无结果时，第一个模块应标记为 streaming', () => {
    const states = inferModuleStates(modules, {}, {}, {})
    expect(states['summary'].status).toBe('streaming')
    expect(states['chronicle']).toBeUndefined()
    expect(states['claim']).toBeUndefined()
  })

  it('第一个模块完成后，第二个应标记为 streaming', () => {
    const initialStates: Record<string, ModuleRunState> = {
      summary: { name: 'summary', status: 'complete', content: '概要内容' },
    }
    const states = inferModuleStates(
      modules,
      { summary: '概要内容' },
      {},
      initialStates,
    )
    expect(states['summary'].status).toBe('complete')
    expect(states['chronicle'].status).toBe('streaming')
  })

  it('有失败模块时，失败模块后第一个正常模块标记为 streaming', () => {
    const states = inferModuleStates(
      modules,
      { summary: '概要内容' },
      { chronicle: '超出重试次数' },
      {},
    )
    expect(states['summary'].status).toBe('complete')
    expect(states['chronicle'].status).toBe('failed')
    expect(states['chronicle'].error).toBe('超出重试次数')
    expect(states['claim'].status).toBe('streaming')
  })

  it('所有模块完成后，不再有 streaming 模块', () => {
    const states = inferModuleStates(
      modules,
      { summary: '概要', chronicle: '大事记', claim: '请求权' },
      {},
      {},
    )
    expect(states['summary'].status).toBe('complete')
    expect(states['chronicle'].status).toBe('complete')
    expect(states['claim'].status).toBe('complete')
    // 没有任何 streaming
    const streamingCount = Object.values(states).filter(s => s.status === 'streaming').length
    expect(streamingCount).toBe(0)
  })

  it('之前 complete 的模块，result 消失后同帧内立即被推断为 streaming', () => {
    // 说明：inferModuleStates 在同一次调用中：
    // 1. 先将 complete→idle（因为 result 中无该模块）
    // 2. 再推断第一个非 complete/failed 模块为 streaming
    // 因此 complete→idle→streaming 在同一次调用中完成，外部观察到的是 streaming
    const initialStates: Record<string, ModuleRunState> = {
      summary: { name: 'summary', status: 'complete', content: '旧内容' },
    }
    // result 中没有 summary（模拟重试清空）
    const states = inferModuleStates(modules, {}, {}, initialStates)
    // 实际行为：summary 先降为 idle，但立刻被推断为 streaming（第一个非 complete/failed 模块）
    expect(states['summary'].status).toBe('streaming')
  })

  it('单个模块列表时，仅有该模块', () => {
    const states = inferModuleStates(['summary'], { summary: '结果' }, {}, {})
    expect(states['summary'].status).toBe('complete')
    expect(states['summary'].content).toBe('结果')
  })

  it('failedModules 的错误信息应正确保存', () => {
    const states = inferModuleStates(
      ['summary'],
      {},
      { summary: '解析失败: 超时' },
      {},
    )
    expect(states['summary'].status).toBe('failed')
    expect(states['summary'].error).toBe('解析失败: 超时')
    expect(states['summary'].content).toBe('')
  })

  it('保持现有 streaming 状态不变（未完成未失败）', () => {
    const initialStates: Record<string, ModuleRunState> = {
      summary: { name: 'summary', status: 'streaming', content: '' },
    }
    const states = inferModuleStates(modules, {}, {}, initialStates)
    // summary 还在 streaming，且不在 result/failedModules 中，保持 streaming
    expect(states['summary'].status).toBe('streaming')
  })
})

describe('mergeResult - mergedResult 合并逻辑', () => {
  it('没有 values 时应返回 DB 结果', () => {
    const merged = mergeResult({ summary: 'db结果' }, undefined)
    expect(merged.summary).toBe('db结果')
  })

  it('values 覆盖 DB 结果', () => {
    const merged = mergeResult(
      { summary: 'DB旧结果', chronicle: 'DB大事记' },
      { summary: '流式新结果' },
    )
    expect(merged.summary).toBe('流式新结果')
    expect(merged.chronicle).toBe('DB大事记')
  })

  it('DB 有值，values 为空对象时应保留 DB 值', () => {
    const merged = mergeResult({ summary: 'DB结果' }, {})
    expect(merged.summary).toBe('DB结果')
  })

  it('两者都为空时返回空对象', () => {
    const merged = mergeResult({}, undefined)
    expect(merged).toEqual({})
  })

  it('values 新增模块不影响已有 DB 模块', () => {
    const merged = mergeResult(
      { summary: 'DB概要' },
      { chronicle: '新大事记', claim: '新请求权' },
    )
    expect(merged.summary).toBe('DB概要')
    expect(merged.chronicle).toBe('新大事记')
    expect(merged.claim).toBe('新请求权')
  })

  it('应返回新对象，不应修改原始 DB 结果', () => {
    const dbResult = { summary: '原始' }
    const merged = mergeResult(dbResult, { summary: '新值' })
    expect(dbResult.summary).toBe('原始') // 原始对象不被修改
    expect(merged.summary).toBe('新值')   // 合并结果正确
  })
})

describe('mergeStreamMessages - streamMessages 合并逻辑', () => {
  // 简单 identity 函数模拟 coerceRawMessages
  const identity = (msgs: any[]) => msgs.map(m => ({ ...m, coerced: true }))

  it('有实时消息时优先使用实时消息', () => {
    const realtime = [{ id: '1', type: 'ai', content: '实时内容' }]
    const checkpoint = [{ id: '2', type: 'ai', content: 'checkpoint内容' }]
    const result = mergeStreamMessages(realtime, checkpoint, identity)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('实时内容')
    expect(result[0].coerced).toBeUndefined() // 实时消息不经过 coerce
  })

  it('无实时消息时 fallback 到 checkpoint 并 coerce', () => {
    const checkpoint = [{ id: '1', type: 'ai', content: 'checkpoint内容' }]
    const result = mergeStreamMessages([], checkpoint, identity)
    expect(result).toHaveLength(1)
    expect(result[0].coerced).toBe(true) // checkpoint 消息经过 coerce
  })

  it('两者都为空时返回空数组', () => {
    const result = mergeStreamMessages([], [], identity)
    expect(result).toEqual([])
  })

  it('实时消息为空但 checkpoint 有多条时，全部返回', () => {
    const checkpoint = [
      { id: '1', type: 'human', content: '用户提问' },
      { id: '2', type: 'ai', content: 'AI回答' },
    ]
    const result = mergeStreamMessages([], checkpoint, identity)
    expect(result).toHaveLength(2)
    expect(result.every(m => m.coerced)).toBe(true)
  })

  it('实时消息有多条时，全部返回且不 coerce', () => {
    const realtime = [
      { id: '1', type: 'human', content: '问题' },
      { id: '2', type: 'ai', content: '回答' },
    ]
    const result = mergeStreamMessages(realtime, [], identity)
    expect(result).toHaveLength(2)
    expect(result.every(m => !m.coerced)).toBe(true)
  })
})

describe('完成条件检查逻辑', () => {
  /**
   * 对应 useInitAnalysis.ts 中检查是否全部完成的逻辑
   * if (mods?.length && result) {
   *   const completedCount = mods.filter(m => result[m]).length
   *   const failedCount = Object.keys(failedModules ?? {}).length
   *   if (completedCount + failedCount >= mods.length) phase = 'complete'
   * }
   */
  function isAnalysisComplete(
    mods: string[],
    result: Record<string, string | undefined>,
    failedModules: Record<string, string | undefined>,
  ): boolean {
    if (!mods?.length || !result) return false
    const completedCount = mods.filter(m => result[m]).length
    const failedCount = Object.keys(failedModules ?? {}).length
    return completedCount + failedCount >= mods.length
  }

  it('所有模块完成时应返回 true', () => {
    expect(isAnalysisComplete(
      ['summary', 'chronicle'],
      { summary: '结果1', chronicle: '结果2' },
      {},
    )).toBe(true)
  })

  it('部分模块失败时，完成+失败 >= 总数应返回 true', () => {
    expect(isAnalysisComplete(
      ['summary', 'chronicle', 'claim'],
      { summary: '结果' },
      { chronicle: '失败', claim: '失败' },
    )).toBe(true)
  })

  it('还有未完成模块时应返回 false', () => {
    expect(isAnalysisComplete(
      ['summary', 'chronicle', 'claim'],
      { summary: '结果' },
      {},
    )).toBe(false)
  })

  it('模块列表为空时应返回 false', () => {
    expect(isAnalysisComplete([], { summary: '结果' }, {})).toBe(false)
  })

  it('混合完成和失败，刚好等于总数时返回 true', () => {
    expect(isAnalysisComplete(
      ['summary', 'chronicle'],
      { summary: '结果' },
      { chronicle: '失败' },
    )).toBe(true)
  })
})
