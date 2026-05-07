/**
 * 数据迁移脚本（已废弃）的占位测试
 *
 * Phase 6 改造删除 prompts.nodeId 字段后，`server/scripts/migrateNodePrompts.ts` 失去运行依据，
 * 现在仅保留为占位以避免历史引用断裂。本测试验证它仍可被调用且不抛错。
 *
 * **Feature: prompts-multi-node**
 * **Validates: Phase 6（脚本废弃后行为）**
 */

import { describe, it, expect } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { migrateNodePrompts } from '~~/server/scripts/migrateNodePrompts'

describe('migrateNodePrompts 数据迁移脚本（已废弃）', () => {
    it('调用不抛错', async () => {
        await expect(migrateNodePrompts()).resolves.not.toThrow()
    })

    it('不写入任何 node_prompts 记录', async () => {
        const before = await prisma.node_prompts.count()
        await migrateNodePrompts()
        const after = await prisma.node_prompts.count()
        expect(after).toBe(before)
    })

    it('多次调用幂等无副作用', async () => {
        const before = await prisma.node_prompts.count()
        await migrateNodePrompts()
        await migrateNodePrompts()
        await migrateNodePrompts()
        const after = await prisma.node_prompts.count()
        expect(after).toBe(before)
    })
})
