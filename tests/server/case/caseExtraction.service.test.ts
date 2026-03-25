/**
 * 案件信息提取存储服务测试
 *
 * **Feature: case-extraction-storage**
 * **Validates: Task 3 — 三层存储服务**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtractedCaseInfo } from '#shared/types/case'

// Mock prisma
const mockPrismaUpdate = vi.fn().mockResolvedValue({})
vi.mock('~~/server/utils/prisma', () => ({
    prisma: {
        cases: { update: (...args: any[]) => mockPrismaUpdate(...args) },
    },
}))

// Mock logger
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// Mock prisma global (Nuxt auto-import)
vi.stubGlobal('prisma', {
    cases: { update: (...args: any[]) => mockPrismaUpdate(...args) },
})

// Mock store
const mockStorePut = vi.fn().mockResolvedValue(undefined)
vi.mock('~~/server/services/workflow/checkpointer', () => ({
    getStore: vi.fn(() => Promise.resolve({ put: mockStorePut })),
}))

const sampleData: ExtractedCaseInfo = {
    title: '张三与李四买卖合同纠纷',
    plaintiff: ['张三'],
    defendant: ['李四'],
    caseType: '民事',
    summary: '原告张三购买车辆',
    extraFields: [
        { name: 'amount', title: '涉案金额', value: '68万元' },
    ],
}

const sampleCaseTypes = [
    { id: 1, name: '民事' },
    { id: 2, name: '刑事' },
]

describe('saveCaseInfoService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('匹配 caseType 时应更新 caseTypeId', async () => {
        const { saveCaseInfoService } = await import(
            '~~/server/services/case/caseExtraction.service'
        )

        await saveCaseInfoService(1, sampleData, sampleCaseTypes)

        expect(mockPrismaUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 1 },
                data: expect.objectContaining({ caseTypeId: 1 }),
            }),
        )
    })

    it('caseType 不匹配时不设置 caseTypeId', async () => {
        const { saveCaseInfoService } = await import(
            '~~/server/services/case/caseExtraction.service'
        )

        const dataWithUnknownType = { ...sampleData, caseType: '未知类型' }
        await saveCaseInfoService(1, dataWithUnknownType, sampleCaseTypes)

        const updateCall = mockPrismaUpdate.mock.calls[0][0]
        expect(updateCall.data).not.toHaveProperty('caseTypeId')
    })

    it('应写入 DB 固定字段和 JSONB', async () => {
        const { saveCaseInfoService } = await import(
            '~~/server/services/case/caseExtraction.service'
        )

        await saveCaseInfoService(1, sampleData, sampleCaseTypes)

        const updateCall = mockPrismaUpdate.mock.calls[0][0]
        expect(updateCall.data.title).toBe('张三与李四买卖合同纠纷')
        expect(updateCall.data.plaintiff).toEqual(['张三'])
        expect(updateCall.data.defendant).toEqual(['李四'])
        expect(updateCall.data.summary).toBe('原告张三购买车辆')
        expect(updateCall.data.extractedInfo).toBeDefined()
    })

    it('应写入 PostgresStore 长期记忆', async () => {
        const { saveCaseInfoService } = await import(
            '~~/server/services/case/caseExtraction.service'
        )

        await saveCaseInfoService(1, sampleData, sampleCaseTypes)

        expect(mockStorePut).toHaveBeenCalledWith(
            ['cases', '1'],
            'basic_info',
            expect.objectContaining({
                text: expect.stringContaining('张三与李四买卖合同纠纷'),
                title: '张三与李四买卖合同纠纷',
            }),
        )
    })
})

describe('formatCaseInfo', () => {
    it('应正确格式化固定字段和扩展字段', async () => {
        const { formatCaseInfo } = await import(
            '~~/server/services/case/caseExtraction.service'
        )

        const result = formatCaseInfo(sampleData)

        expect(result).toContain('案件名称：张三与李四买卖合同纠纷')
        expect(result).toContain('原告：张三')
        expect(result).toContain('被告：李四')
        expect(result).toContain('案件类型：民事')
        expect(result).toContain('概述：原告张三购买车辆')
        expect(result).toContain('涉案金额：68万元')
    })

    it('多原告被告应用顿号分隔', async () => {
        const { formatCaseInfo } = await import(
            '~~/server/services/case/caseExtraction.service'
        )

        const data: ExtractedCaseInfo = {
            ...sampleData,
            plaintiff: ['张三', '王五'],
            defendant: ['李四', '赵六'],
        }

        const result = formatCaseInfo(data)

        expect(result).toContain('原告：张三、王五')
        expect(result).toContain('被告：李四、赵六')
    })

    it('无扩展字段时只输出固定字段', async () => {
        const { formatCaseInfo } = await import(
            '~~/server/services/case/caseExtraction.service'
        )

        const data: ExtractedCaseInfo = {
            ...sampleData,
            extraFields: [],
        }

        const result = formatCaseInfo(data)
        const lines = result.split('\n')

        expect(lines).toHaveLength(5)
    })
})
