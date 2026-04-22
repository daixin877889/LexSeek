import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    createPlaybookDAO,
    getPlaybookByIdDAO,
    listPlaybooksDAO,
    listEnabledPlaybookPointsDAO,
    updatePlaybookDAO,
} from '~~/server/services/assistant/contract/contractPlaybook.dao'

describe('contractPlaybook.dao', () => {
    beforeEach(async () => {
        await prisma.contractPlaybooks.deleteMany({})
    })

    it('createPlaybookDAO 创建要点', async () => {
        const row = await createPlaybookDAO({
            contractType: '劳动合同',
            code: 'probation',
            title: '试用期约定合规性',
            defaultLevel: 'high',
            stancePreference: 'strict',
            checkContent: '检查试用期是否超过法定上限。',
        })
        expect(row.id).toBeGreaterThan(0)
        expect(row.enabled).toBe(true)
        expect(row.stancePreference).toBe('strict')
    })

    it('listPlaybooksDAO 按类型过滤 + 按 code 自然序排序', async () => {
        await createPlaybookDAO({ contractType: '劳动合同', code: 'overtime', title: '加班费', defaultLevel: 'medium', stancePreference: 'balanced', checkContent: 'x' })
        await createPlaybookDAO({ contractType: '劳动合同', code: 'probation', title: '试用期', defaultLevel: 'high', stancePreference: 'strict', checkContent: 'x' })
        await createPlaybookDAO({ contractType: '租赁合同', code: 'rent', title: '租金', defaultLevel: 'low', stancePreference: 'lenient', checkContent: 'x' })

        const list = await listPlaybooksDAO({ contractType: '劳动合同' })
        expect(list).toHaveLength(2)
        expect(list[0]!.code).toBe('overtime')  // o < p 字母序
        expect(list[1]!.code).toBe('probation')
    })

    it('listEnabledPlaybookPointsDAO 只返回启用项并投影正确字段', async () => {
        await createPlaybookDAO({
            contractType: '劳动合同', code: 'probation', title: '试用期',
            defaultLevel: 'high', stancePreference: 'strict', checkContent: 'c1',
            legalBasis: 'lb', suggestion: 'sug',
        })
        const disabled = await createPlaybookDAO({
            contractType: '劳动合同', code: 'disabled', title: 'off',
            defaultLevel: 'low', stancePreference: 'balanced', checkContent: 'x',
        })
        await updatePlaybookDAO(disabled.id, { enabled: false })

        const points = await listEnabledPlaybookPointsDAO('劳动合同')
        expect(points).toHaveLength(1)
        expect(points[0]!.code).toBe('probation')
        expect(points[0]!.title).toBe('试用期')
        expect(points[0]!.defaultLevel).toBe('high')
        expect(points[0]!.stancePreference).toBe('strict')
        expect(points[0]!.checkContent).toBe('c1')
        expect(points[0]!.legalBasis).toBe('lb')
        expect(points[0]!.suggestion).toBe('sug')
    })

    it('updatePlaybookDAO 可切换 enabled', async () => {
        const row = await createPlaybookDAO({
            contractType: '劳动合同', code: 'c1', title: 't',
            defaultLevel: 'low', stancePreference: 'balanced', checkContent: 'x',
        })
        const updated = await updatePlaybookDAO(row.id, { enabled: false })
        expect(updated.enabled).toBe(false)
    })

    it('getPlaybookByIdDAO 不存在返 null', async () => {
        const row = await getPlaybookByIdDAO(999999)
        expect(row).toBeNull()
    })
})
