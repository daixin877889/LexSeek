/**
 * 节点类型常量测试
 *
 * 覆盖 shared/types/node.ts 中的运行时常量：
 *   - NODE_TYPES / PROMPT_TYPES 数组
 *   - NodeTypeLabels / NodeTypeVariants / NodeStatusLabels
 *   - PromptTypeLabels / PromptStatusLabels
 *   - NodeStatus / PromptStatus 枚举值
 *
 * 这些 Record 映射由代码里多处业务逻辑（管理后台、权限校验、列表展示）直接读取，
 * 对照测试保证枚举和标签始终同步，防止后续改动遗漏任一语言标签或变体。
 *
 * **Feature: node-type-constants**
 */

import { describe, it, expect } from 'vitest'
import {
    NODE_TYPES,
    NodeTypeLabels,
    NodeTypeVariants,
    NodeStatus,
    NodeStatusLabels,
    PROMPT_TYPES,
    PromptTypeLabels,
    PromptStatus,
    PromptStatusLabels,
} from '#shared/types/node'

describe('shared/types/node - 节点类型常量', () => {
    it('NODE_TYPES 覆盖四类节点并保持顺序', () => {
        expect(NODE_TYPES).toEqual(['analysis', 'document', 'extraction', 'agent'])
    })

    it('NodeTypeLabels 每个类型都有可展示的中文标签', () => {
        for (const type of NODE_TYPES) {
            expect(NodeTypeLabels[type]).toBeTruthy()
            expect(typeof NodeTypeLabels[type]).toBe('string')
        }
        expect(NodeTypeLabels.agent).toBe('主代理')
        expect(NodeTypeLabels.analysis).toBe('分析模块')
    })

    it('NodeTypeVariants 只允许 default/secondary/outline 三种 badge 变体', () => {
        const allowed: Array<typeof NodeTypeVariants[keyof typeof NodeTypeVariants]> = [
            'default', 'secondary', 'outline',
        ]
        for (const type of NODE_TYPES) {
            expect(allowed).toContain(NodeTypeVariants[type])
        }
    })
})

describe('shared/types/node - 节点状态', () => {
    it('NodeStatus 为 0/1 数字枚举', () => {
        expect(NodeStatus.DISABLED).toBe(0)
        expect(NodeStatus.ENABLED).toBe(1)
    })

    it('NodeStatusLabels 覆盖启用和禁用', () => {
        expect(NodeStatusLabels[NodeStatus.DISABLED]).toBe('禁用')
        expect(NodeStatusLabels[NodeStatus.ENABLED]).toBe('启用')
    })
})

describe('shared/types/node - 提示词类型 / 状态', () => {
    it('PROMPT_TYPES 支持 system/user/user_injection/assistant', () => {
        expect(PROMPT_TYPES).toEqual(['system', 'user', 'user_injection', 'assistant'])
    })

    it('PromptTypeLabels 每个类型都有标签', () => {
        for (const type of PROMPT_TYPES) {
            expect(PromptTypeLabels[type]).toBeTruthy()
        }
        expect(PromptTypeLabels.system).toBe('系统提示词')
        expect(PromptTypeLabels.user_injection).toBe('用户每轮注入')
    })

    it('PromptStatus 与 PromptStatusLabels 对应', () => {
        expect(PromptStatus.INACTIVE).toBe(0)
        expect(PromptStatus.ACTIVE).toBe(1)
        expect(PromptStatusLabels[PromptStatus.INACTIVE]).toBe('未生效')
        expect(PromptStatusLabels[PromptStatus.ACTIVE]).toBe('生效')
    })
})
