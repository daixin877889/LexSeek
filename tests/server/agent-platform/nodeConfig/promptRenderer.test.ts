/**
 * 系统提示词渲染器测试
 *
 * **Feature: prompts-multi-node**
 * **Validates: Phase 3 Task 3.3 — 多 prompt 按 displayOrder 升序拼接**
 */

import { describe, it, expect } from 'vitest'
import { renderSystemPrompt, assembleSystemPromptTemplate } from '~~/server/services/agent-platform/nodeConfig/promptRenderer'
import type { NodeConfig } from '~~/server/services/node/node.service'

const buildConfig = (prompts: NodeConfig['prompts']): NodeConfig => ({
    id: 1,
    name: 'test-node',
    title: 'Test',
    description: '',
    type: 'analysis',
    prompts,
    modelId: 1,
    modelName: 'm',
    modelType: 'chat',
    modelStatus: 1,
    modelSdkType: 'openai',
    modelProviderId: 1,
    modelProviderName: 'p',
    modelProviderBaseUrl: 'http://x',
    modelProviderDescription: '',
    modelApiKeys: [],
    tools: [],
    outputSchema: null,
    thinkingEnabled: false,
    modelSupportsThinking: false,
})

describe('promptRenderer 多 prompt 拼接', () => {
    it('按 displayOrder 升序拼接所有 type=system, status=1 的 prompts', () => {
        const cfg = buildConfig([
            { id: 1, name: 'b', content: 'B', version: 'v1', type: 'system', status: 1, displayOrder: 200 },
            { id: 2, name: 'a', content: 'A', version: 'v1', type: 'system', status: 1, displayOrder: 100 },
            { id: 3, name: 'c', content: 'C', version: 'v1', type: 'user', status: 1, displayOrder: 1 },
            { id: 4, name: 'd', content: 'D', version: 'v1', type: 'system', status: 0, displayOrder: 50 },
        ])
        const raw = renderSystemPrompt(cfg, {})
        expect(raw).toBe('A\n\nB')
    })

    it('段落间用空行分隔', () => {
        const cfg = buildConfig([
            { id: 1, name: 'a', content: 'first', version: 'v1', type: 'system', status: 1, displayOrder: 1 },
            { id: 2, name: 'b', content: 'second', version: 'v1', type: 'system', status: 1, displayOrder: 2 },
        ])
        const raw = renderSystemPrompt(cfg, {})
        expect(raw).toBe('first\n\nsecond')
        expect(raw).toContain('\n\n')
    })

    it('零个 system prompt 时返回空字符串', () => {
        const cfg = buildConfig([])
        expect(renderSystemPrompt(cfg, {})).toBe('')
    })

    it('未传 displayOrder 时按默认 100 处理（同序保持原数组顺序）', () => {
        const cfg = buildConfig([
            { id: 1, name: 'a', content: 'first', version: 'v1', type: 'system', status: 1 },
            { id: 2, name: 'b', content: 'second', version: 'v1', type: 'system', status: 1 },
        ])
        const raw = renderSystemPrompt(cfg, {})
        expect(raw).toBe('first\n\nsecond')
    })

    it('每段独立渲染 {{caseId}} 等模板变量', () => {
        const cfg = buildConfig([
            { id: 1, name: 'a', content: '案件 ID: {{caseId}}', version: 'v1', type: 'system', status: 1, displayOrder: 1 },
            { id: 2, name: 'b', content: '模块: {{moduleName}}', version: 'v1', type: 'system', status: 1, displayOrder: 2 },
        ])
        const raw = renderSystemPrompt(cfg, { caseId: 42, moduleName: 'case_summary' })
        expect(raw).toBe('案件 ID: 42\n\n模块: case_summary')
    })
})

// ==================== assembleSystemPromptTemplate（修复合同审查 / invokeNodeJson 等链路）====================

describe('assembleSystemPromptTemplate · 取拼接后的 raw template（不做变量替换）', () => {
    it('按 displayOrder 升序拼接，不替换 {{xxx}} 字面量（让调用方各自做业务变量替换）', () => {
        const cfg = buildConfig([
            { id: 1, name: '反越狱护栏', content: '安全规则段', version: 'v2', type: 'system', status: 1, displayOrder: 10 },
            { id: 2, name: 'businessPrompt', content: '业务段：{{contractType}} / {{stanceLabel}}', version: 'v4', type: 'system', status: 1, displayOrder: 100 },
        ])
        const raw = assembleSystemPromptTemplate(cfg.prompts)
        // 顺序对：display=10 在 display=100 前
        expect(raw).toBe('安全规则段\n\n业务段：{{contractType}} / {{stanceLabel}}')
        // 业务变量保留字面量供调用方处理
        expect(raw).toContain('{{contractType}}')
        expect(raw).toContain('{{stanceLabel}}')
    })

    it('过滤非 system 类型与 status!==1', () => {
        const cfg = buildConfig([
            { id: 1, name: 'a', content: 'A', version: 'v1', type: 'system', status: 1, displayOrder: 1 },
            { id: 2, name: 'b', content: 'B-user', version: 'v1', type: 'user', status: 1, displayOrder: 2 },
            { id: 3, name: 'c', content: 'C-disabled', version: 'v1', type: 'system', status: 0, displayOrder: 3 },
        ])
        expect(assembleSystemPromptTemplate(cfg.prompts)).toBe('A')
    })

    it('空 prompts → 返回空字符串', () => {
        expect(assembleSystemPromptTemplate([])).toBe('')
    })

    it('未传 displayOrder 时按默认 100 处理（同序保持原数组顺序）', () => {
        const cfg = buildConfig([
            { id: 1, name: 'a', content: 'first', version: 'v1', type: 'system', status: 1 },
            { id: 2, name: 'b', content: 'second', version: 'v1', type: 'system', status: 1 },
        ])
        expect(assembleSystemPromptTemplate(cfg.prompts)).toBe('first\n\nsecond')
    })
})
