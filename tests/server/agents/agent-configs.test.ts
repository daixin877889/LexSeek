/**
 * 6 个业务 vertical agent.config.ts 注册副作用 smoke 测试。
 *
 * 每个 agent.config.ts 顶层调 defineDomainAgent，自动 register 到 agentRegistry。
 * 单元测试不会启动 nuxt plugin (agents-load.ts)，所以 import 时副作用不会自然触发。
 * 本测试通过显式 import 6 个 config，让 coverage instrumentation 捕获 register 流程。
 *
 * 不验证业务行为，仅验证：
 * 1. 6 个 config 能被加载（无 import error）
 * 2. 每个都 export 了 DomainAgent 对象（含 definition + runner）
 * 3. agentRegistry 在导入后含对应的 (scope, type) entry
 */

import { describe, it, expect } from 'vitest'
import { agentRegistry } from '~~/server/services/agent-platform/registry/agentRegistry'
import { SessionScope, SessionType } from '#shared/types/agentEvent'

describe('业务 vertical agent.config 注册', () => {
    it('case-main vertical 注册 (CASE, null)', async () => {
        const { caseMainAgent } = await import('~~/server/agents/case-main/agent.config')
        expect(caseMainAgent.definition.scope).toBe(SessionScope.CASE)
        expect(typeof caseMainAgent.runner).toBe('function')
        expect(agentRegistry.has({ scope: SessionScope.CASE, type: null })).toBe(true)
    })

    it('case-module vertical 注册 (CASE, MODULE)', async () => {
        const { caseModuleAgent } = await import('~~/server/agents/case-module/agent.config')
        expect(caseModuleAgent.definition.scope).toBe(SessionScope.CASE)
        expect(caseModuleAgent.definition.type).toBe(SessionType.MODULE)
        expect(typeof caseModuleAgent.runner).toBe('function')
    })

    it('case-analysis vertical 注册 (CASE, ANALYSIS)', async () => {
        const { caseAnalysisAgent } = await import('~~/server/agents/case-analysis/agent.config')
        expect(caseAnalysisAgent.definition.scope).toBe(SessionScope.CASE)
        expect(caseAnalysisAgent.definition.type).toBe(SessionType.ANALYSIS)
        expect(caseAnalysisAgent.definition.agentType).toBe('stateGraph')
        expect(typeof caseAnalysisAgent.runner).toBe('function')
    })

    it('legal-assistant vertical 注册 (ASSISTANT)', async () => {
        const { legalAssistantAgent } = await import('~~/server/agents/legal-assistant/agent.config')
        expect(legalAssistantAgent.definition.scope).toBe(SessionScope.ASSISTANT)
        expect(typeof legalAssistantAgent.runner).toBe('function')
    })

    it('document vertical 注册 (DOCUMENT)', async () => {
        const { documentAgent } = await import('~~/server/agents/document/agent.config')
        expect(documentAgent.definition.scope).toBe(SessionScope.DOCUMENT)
        expect(typeof documentAgent.runner).toBe('function')
    })

    it('contract vertical 注册 (CONTRACT)', async () => {
        const { contractAgent } = await import('~~/server/agents/contract/agent.config')
        expect(contractAgent.definition.scope).toBe(SessionScope.CONTRACT)
        expect(typeof contractAgent.runner).toBe('function')
    })

    it('agentRegistry 至少含 6 个 vertical entry（顺序无关）', () => {
        const entries = agentRegistry.list()
        const scopes = entries.map(e => `${e.scope}:${e.type ?? 'null'}`)
        // 此时 6 个 vertical 应已全部 import 完成（按上面的 it 顺序）
        expect(scopes).toContain(`${SessionScope.CASE}:null`)
        expect(scopes).toContain(`${SessionScope.CASE}:${SessionType.MODULE}`)
        expect(scopes).toContain(`${SessionScope.CASE}:${SessionType.ANALYSIS}`)
        expect(scopes).toContain(`${SessionScope.ASSISTANT}:null`)
        expect(scopes).toContain(`${SessionScope.DOCUMENT}:null`)
        expect(scopes).toContain(`${SessionScope.CONTRACT}:null`)
    })
})
