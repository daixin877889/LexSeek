/**
 * useCaseMainAgent · extractRunningModulesFromBuckets 单测
 *
 * 验证从 subThreadsMap reactive 分桶提取"正在跑中"的模块名（去重 + 过滤）逻辑正确。
 * 业务路径：[id].vue 合并 manager / xiaosuo 两路 generatingModules → 跨标签 module:generating 广播。
 */
import { describe, it, expect } from 'vitest'
import { extractRunningModulesFromBuckets } from '~/composables/agents/useCaseMainAgent'

describe('useCaseMainAgent · extractRunningModulesFromBuckets', () => {
    it('空 map / null / undefined → 返回空数组', () => {
        expect(extractRunningModulesFromBuckets(null)).toEqual([])
        expect(extractRunningModulesFromBuckets(undefined)).toEqual([])
        expect(extractRunningModulesFromBuckets({})).toEqual([])
    })

    it('只返回 status=running 的 bucket，completed / failed 被过滤', () => {
        const map = {
            tc1: { agentName: 'evidence', status: 'running' as const },
            tc2: { agentName: 'cause', status: 'completed' as const },
            tc3: { agentName: 'claim', status: 'failed' as const },
        }
        expect(extractRunningModulesFromBuckets(map)).toEqual(['evidence'])
    })

    it('多个 running bucket → 返回多个 agentName', () => {
        const map = {
            tc1: { agentName: 'evidence', status: 'running' as const },
            tc2: { agentName: 'cause', status: 'running' as const },
        }
        expect(new Set(extractRunningModulesFromBuckets(map))).toEqual(new Set(['evidence', 'cause']))
    })

    it('同 agentName 多次 running（用户连点）→ 去重只返一次', () => {
        const map = {
            tc1: { agentName: 'evidence', status: 'running' as const },
            tc2: { agentName: 'evidence', status: 'running' as const },
        }
        expect(extractRunningModulesFromBuckets(map)).toEqual(['evidence'])
    })

    it('agentName 缺失 / 空字符串 / 非字符串 → 跳过', () => {
        const map = {
            tc1: { agentName: '', status: 'running' as const },
            tc2: { status: 'running' as const },
            tc3: { agentName: undefined, status: 'running' as const },
            tc4: { agentName: 'evidence', status: 'running' as const },
        }
        expect(extractRunningModulesFromBuckets(map as any)).toEqual(['evidence'])
    })

    it('bucket 自身 undefined → 跳过不抛错', () => {
        const map = {
            tc1: undefined,
            tc2: { agentName: 'evidence', status: 'running' as const },
        }
        expect(extractRunningModulesFromBuckets(map)).toEqual(['evidence'])
    })
})
