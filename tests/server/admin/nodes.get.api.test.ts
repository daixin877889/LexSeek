/**
 * GET /api/v1/admin/nodes/:id 接口测试 — 阶段 J：节点详情返回关联 Skills + 工具元信息
 *
 * **Feature: prompts-multi-node-and-anti-jailbreak**
 *
 * 策略：直接 import handler default export，传入 mock event（含 auth 上下文 + __params），
 * 真实 prisma 直连 worker DB，断言新增的 skills / toolDetails 字段。
 *
 * 工具注册表通过 vi.mock 短接，注入两条已知 description，避免依赖运行时具体工具集。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vi } from 'vitest'

// mock 工具注册表，避免依赖完整运行时初始化
vi.mock('~~/server/services/workflow/tools', () => ({
    getAllToolsService: () => [
        { name: 'fake_tool_a', description: 'A 工具描述', parameters: [] },
        { name: 'fake_tool_b', description: 'B 工具描述', parameters: [] },
    ],
}))

import { prisma } from '~~/server/utils/db'

// 全局 stub：模拟 Nuxt nitro 自动导入的 H3 函数与响应工具
const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).getHeader = (event: any, name: string) => event.__headers?.[name.toLowerCase()]
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

const { default: getHandler } = await import('~~/server/api/v1/admin/nodes/[id].get')

function makeEvent(params: Record<string, string>) {
    return {
        context: { auth: { user: { id: 2 } } },
        __params: params,
        __headers: {},
        node: { req: { socket: {} } },
    }
}

describe('GET /api/v1/admin/nodes/:id — 节点详情含 skills / toolDetails', () => {
    let nodeId: number
    let createdSkillNames: string[] = []
    let createdNodeIds: number[] = []
    let suffix: string

    beforeEach(async () => {
        suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

        // 准备两个 skill：一个生效一个停用，验证状态字段透传
        const skillEnabled = await prisma.skills.create({
            data: {
                name: `nj_skill_e_${suffix}`,
                path: `.deepagents/skills/nj_skill_e_${suffix}`,
                title: '反越狱护栏',
                description: '在用户请求与系统边界冲突时拒绝并礼貌引导',
                status: 1,
            },
        })
        const skillDisabled = await prisma.skills.create({
            data: {
                name: `nj_skill_d_${suffix}`,
                path: `.deepagents/skills/nj_skill_d_${suffix}`,
                title: null,
                customTitle: '案件主分析',
                description: '案件分析主体 SOP',
                status: 0,
            },
        })
        createdSkillNames.push(skillEnabled.name, skillDisabled.name)

        const node = await prisma.nodes.create({
            data: {
                name: `nj_node_${suffix}`,
                title: '节点详情阶段 J 测试',
                type: 'agent',
                modelId: 1,
                priority: 100,
                tools: ['fake_tool_a', 'fake_tool_b', 'fake_tool_unknown'],
            },
        })
        nodeId = node.id
        createdNodeIds.push(nodeId)

        // 关联 skill：priority 数字越小越靠前
        await prisma.node_skills.createMany({
            data: [
                { nodeId, skillName: skillEnabled.name, priority: 50 },
                { nodeId, skillName: skillDisabled.name, priority: 10 },
            ],
        })
    })

    afterEach(async () => {
        await prisma.node_skills.deleteMany({ where: { nodeId: { in: createdNodeIds } } })
        await prisma.nodes.deleteMany({ where: { id: { in: createdNodeIds } } })
        await prisma.skills.deleteMany({ where: { name: { in: createdSkillNames } } })
        createdNodeIds = []
        createdSkillNames = []
    })

    it('返回体含 skills 数组（按 priority 升序）+ description / status 透传', async () => {
        const r = await getHandler(makeEvent({ id: String(nodeId) }))
        expect(r.code).toBe(0)
        expect(Array.isArray(r.data?.skills)).toBe(true)
        expect(r.data.skills).toHaveLength(2)

        // 按 priority 升序：disabled (priority=10) 在前，enabled (priority=50) 在后
        const [first, second] = r.data.skills
        expect(first.priority).toBe(10)
        expect(first.status).toBe(0)
        expect(first.customTitle).toBe('案件主分析')
        expect(first.description).toBe('案件分析主体 SOP')

        expect(second.priority).toBe(50)
        expect(second.status).toBe(1)
        expect(second.title).toBe('反越狱护栏')
        expect(second.description).toBe('在用户请求与系统边界冲突时拒绝并礼貌引导')
    })

    it('返回体含 toolDetails 数组（保留 nodes.tools 顺序，未知工具 description 为 null）', async () => {
        const r = await getHandler(makeEvent({ id: String(nodeId) }))
        expect(r.code).toBe(0)
        expect(Array.isArray(r.data?.toolDetails)).toBe(true)
        expect(r.data.toolDetails).toHaveLength(3)

        expect(r.data.toolDetails[0]).toEqual({ name: 'fake_tool_a', description: 'A 工具描述' })
        expect(r.data.toolDetails[1]).toEqual({ name: 'fake_tool_b', description: 'B 工具描述' })
        // 注册表里没有 fake_tool_unknown → description 落 null
        expect(r.data.toolDetails[2]).toEqual({ name: 'fake_tool_unknown', description: null })
    })

    it('节点无 skill 关联 / tools 为空时返回空数组（不报错）', async () => {
        const empty = await prisma.nodes.create({
            data: {
                name: `nj_empty_${suffix}`,
                title: '空配置节点',
                type: 'agent',
                modelId: 1,
                priority: 100,
                tools: [],
            },
        })
        createdNodeIds.push(empty.id)

        const r = await getHandler(makeEvent({ id: String(empty.id) }))
        expect(r.code).toBe(0)
        expect(r.data.skills).toEqual([])
        expect(r.data.toolDetails).toEqual([])
    })
})
