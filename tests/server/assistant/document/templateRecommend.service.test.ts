/**
 * 文书模板推荐 Service 真打数据库测试
 *
 * 覆盖场景：
 * 1. 纯关键词召回：name / description / category 三档加权各自生效
 * 2. categoryHint 缩范围：第一层只在该 category 内召回
 * 3. 类内召回不足 3 条 → 第二层兜底跨类合并
 * 4. 零关键词 → 退化到 priority + 用户最近使用排序
 * 5. 用户最近 30 天用过的模板得 +8 加权
 * 6. 用户私人模板（scope=user）只对所有者可见，对他人不可见
 *
 * 测试数据使用真实 ls_new_testing 数据库，afterEach 清理本测试创建的全部模板/草稿/用户。
 *
 * **Feature: ai-unify-stage-5 / Task 2**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import '../../case/test-setup'
import {
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from '../../case/test-db-helper'
import {
    recommendDocumentTemplatesService,
} from '~~/server/agents/document/templateRecommend.service'

const createdTemplateIds: number[] = []
const createdDraftIds: number[] = []

interface CreateTplOpts {
    name: string
    category: string
    scope?: 'global' | 'user'
    userId?: number | null
    description?: string | null
    priority?: number
    status?: number
    /** 通过 ossFileId 占位（FK 不存在也行 —— ossFile 表无 NOT NULL 强 FK，但这里建一个最小值即可） */
    ossFileId?: number
}

async function createTpl(opts: CreateTplOpts) {
    const p = getTestPrisma()
    // 复用一个最小 oss_file，保证 ossFileId 不破坏 FK
    let ossFileId = opts.ossFileId
    if (!ossFileId) {
        const owner = opts.userId ?? (await createTestUser()).id
        const oss = await p.ossFiles.create({
            data: {
                fileName: `tpl-${Date.now()}-${Math.random()}.docx`,
                filePath: `test/tpl/${Date.now()}-${Math.random()}.docx`,
                fileSize: 1,
                fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                bucketName: 'test-bucket',
                userId: owner,
            },
        })
        ossFileId = oss.id
    }
    const tpl = await p.documentTemplates.create({
        data: {
            name: opts.name,
            category: opts.category,
            scope: opts.scope ?? 'global',
            userId: opts.scope === 'user' ? opts.userId ?? null : null,
            ossFileId,
            placeholders: [],
            description: opts.description ?? null,
            priority: opts.priority ?? 100,
            status: opts.status ?? 1,
        },
    })
    createdTemplateIds.push(tpl.id)
    return tpl
}

async function createDraftWithTemplate(userId: number, templateId: number, daysAgo = 1) {
    const p = getTestPrisma()
    const at = new Date(Date.now() - daysAgo * 24 * 3600 * 1000)
    const draft = await p.documentDrafts.create({
        data: {
            userId,
            templateId,
            sessionId: `tpl-recent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            values: {},
            status: 'ready',
            title: 'recent-test',
            createdAt: at,
            updatedAt: at,
        },
    })
    createdDraftIds.push(draft.id)
    return draft
}

async function cleanupTemplatesAndDrafts() {
    const p = getTestPrisma()
    if (createdDraftIds.length > 0) {
        // 顺带清同 user/template 范围内的所有 drafts 防遗漏
        await p.documentDrafts.deleteMany({ where: { id: { in: createdDraftIds } } })
        createdDraftIds.length = 0
    }
    if (createdTemplateIds.length > 0) {
        await p.documentDrafts.deleteMany({ where: { templateId: { in: createdTemplateIds } } })
        await p.documentTemplates.deleteMany({ where: { id: { in: createdTemplateIds } } })
        createdTemplateIds.length = 0
    }
}

describe('recommendDocumentTemplatesService（真打 DB）', () => {
    let testIds: CaseTestIds

    beforeAll(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        await cleanupTemplatesAndDrafts()
        if (testIds.userIds.length > 0 || testIds.ossFileIds.length > 0) {
            await cleanupTestData(testIds)
        }
        testIds.userIds = []
        testIds.ossFileIds = []
    })

    afterAll(async () => {
        await cleanupTemplatesAndDrafts()
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    it('1. 纯关键词召回：name 命中 +10、description +5、category +3 加权生效', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const a = await createTpl({ name: 'X异端劳动合同通知书', category: 'gen-x-cat', description: null })
        const b = await createTpl({ name: 'X异端终止合作函', category: 'gen-x-cat', description: '处理X异端劳动相关纠纷' })
        const c = await createTpl({ name: 'X异端诉讼代理意见书', category: 'lit-x-cat', description: '不相关' })

        const result = await recommendDocumentTemplatesService({
            userId: user.id,
            intent: '解除劳动合同',
            keywords: ['X异端劳动'],
            limit: 20,
        })

        expect(result.fallbackToRecency).toBe(false)
        expect(result.usedKeywords).toEqual(['x异端劳动'])
        const ours = result.items.filter(i => [a.id, b.id, c.id].includes(i.id))
        expect(ours.length).toBe(3)
        // a: name 命中 → +10；b: description 命中 → +5；c: 都没命中 → 0
        const scoreA = ours.find(i => i.id === a.id)!.score
        const scoreB = ours.find(i => i.id === b.id)!.score
        const scoreC = ours.find(i => i.id === c.id)!.score
        expect(scoreA).toBeGreaterThanOrEqual(10)
        expect(scoreB).toBeGreaterThanOrEqual(5)
        expect(scoreB).toBeLessThan(scoreA)
        expect(scoreC).toBe(0)
    })

    it('2. categoryHint 缩范围：仅在该类别内召回', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // 模板分别在 litigation / general / evidence 三类
        const tplLit1 = await createTpl({ name: '民事起诉状', category: 'litigation' })
        const tplLit2 = await createTpl({ name: '刑事自诉状', category: 'litigation' })
        const tplLit3 = await createTpl({ name: '行政起诉状', category: 'litigation' })
        await createTpl({ name: '调解协议', category: 'general' })
        await createTpl({ name: '证据清单', category: 'evidence' })

        const result = await recommendDocumentTemplatesService({
            userId: user.id,
            intent: '起诉',
            keywords: ['起诉'],
            categoryHint: 'litigation',
        })

        const ids = result.items.map(i => i.id)
        // 第一层就召回了 3 条 litigation，不会触发跨类兜底
        expect(ids).toContain(tplLit1.id)
        expect(ids).toContain(tplLit2.id)
        expect(ids).toContain(tplLit3.id)
        for (const it of result.items) {
            expect(it.category).toBe('litigation')
        }
    })

    it('3. 类内召回不足 3 条时跨类兜底合并', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // protection_order 在测试种子库中没有启用模板；本用例只放 1 条，
        // 其余分散在多个 category，稳定触发跨类兜底。
        const keyword = 'x跨类兜底'
        const tplHint = await createTpl({ name: '人身安全保护令申请书', category: 'protection_order' })
        const tplGen = await createTpl({ name: '调解协议', category: 'general', description: `${keyword}前置` })
        const tplEvi = await createTpl({ name: `证据${keyword}清单`, category: 'evidence' })

        const result = await recommendDocumentTemplatesService({
            userId: user.id,
            intent: keyword,
            keywords: [keyword],
            categoryHint: 'protection_order',
        })

        const ids = result.items.map(i => i.id)
        // 第一层只有 1 条，所以兜底合并
        expect(ids).toContain(tplHint.id)
        expect(ids.length).toBeGreaterThan(1)
        // 跨类的 tplEvi（name 命中 keyword → +10）必须出现
        expect(ids).toContain(tplEvi.id)
        // tplGen 描述命中 keyword → +5，应在结果中
        expect(ids).toContain(tplGen.id)
    })

    it('4. 零关键词时退化到 priority + 用户最近使用', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const lowPri = await createTpl({ name: '低优先级模板', category: 'general', priority: 10 })
        const highPri = await createTpl({ name: '高优先级模板', category: 'general', priority: 100 })
        const recent = await createTpl({ name: '最近用过的模板', category: 'general', priority: 200 })
        await createDraftWithTemplate(user.id, recent.id, 1)

        const result = await recommendDocumentTemplatesService({
            userId: user.id,
            intent: '随便给我推一个',
            keywords: [], // 零关键词
        })

        expect(result.fallbackToRecency).toBe(true)
        // 最近用过 +8 → 排第一
        expect(result.items[0]!.id).toBe(recent.id)
        const sortedRest = result.items.slice(1)
        // 后面按 priority asc：lowPri(10) < highPri(100)
        const idxLow = sortedRest.findIndex(i => i.id === lowPri.id)
        const idxHigh = sortedRest.findIndex(i => i.id === highPri.id)
        expect(idxLow).toBeLessThan(idxHigh)
    })

    it('5. 用户最近 30 天用过的模板得到 +8 加权', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const tplA = await createTpl({ name: '甲合同', category: 'general' })
        const tplB = await createTpl({ name: '乙合同', category: 'general' })
        // 用户用过 B
        await createDraftWithTemplate(user.id, tplB.id, 5)

        const result = await recommendDocumentTemplatesService({
            userId: user.id,
            intent: '合同',
            keywords: ['合同'],
        })

        // 两者 name 都命中合同 → +10；B 多 +8 → 必须排第一
        expect(result.items[0]!.id).toBe(tplB.id)
        expect(result.items[0]!.score - result.items[1]!.score).toBeGreaterThanOrEqual(7)

        // 31 天前的 draft 不应再加权
        const tplC = await createTpl({ name: '丙合同', category: 'general' })
        await createDraftWithTemplate(user.id, tplC.id, 35)

        const result2 = await recommendDocumentTemplatesService({
            userId: user.id,
            intent: '合同',
            keywords: ['合同'],
        })
        const c = result2.items.find(i => i.id === tplC.id)
        const a = result2.items.find(i => i.id === tplA.id)
        expect(c).toBeDefined()
        expect(a).toBeDefined()
        // C 没有最近加权 → 与 A 同分（仅 name +10）
        expect(c!.score).toBe(a!.score)
    })

    it('6. 用户私人模板（scope=user）只对所有者可见', async () => {
        const owner = await createTestUser()
        const other = await createTestUser()
        testIds.userIds.push(owner.id, other.id)

        await createTpl({ name: '甲方私模板', category: 'general', scope: 'user', userId: owner.id })
        await createTpl({ name: '通用模板', category: 'general', scope: 'global' })

        const r1 = await recommendDocumentTemplatesService({
            userId: owner.id,
            intent: '私', keywords: ['模板'],
        })
        const r2 = await recommendDocumentTemplatesService({
            userId: other.id,
            intent: '私', keywords: ['模板'],
        })

        expect(r1.items.some(i => i.name === '甲方私模板')).toBe(true)
        expect(r2.items.some(i => i.name === '甲方私模板')).toBe(false)
        // total 也分别区分
        expect(r1.total).toBeGreaterThan(r2.total)
    })

    it('7. 仅启用态（status=1）参与召回；status=0 被过滤', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        await createTpl({ name: '启用模板', category: 'general', status: 1 })
        await createTpl({ name: '禁用模板', category: 'general', status: 0 })

        const r = await recommendDocumentTemplatesService({
            userId: user.id, intent: '模板', keywords: ['模板'],
        })
        expect(r.items.some(i => i.name === '启用模板')).toBe(true)
        expect(r.items.some(i => i.name === '禁用模板')).toBe(false)
    })

    // Bug A 复现 + 修复回归：keyword='起诉' 在多个模板 name 中都命中（子串），
    // 位置加权应让"起诉"出现在更靠前位置的"民事起诉状"得分高于"民事答辩状（公民对民事起诉提出答辩用）"
    // 避免 score 平局后按 id desc 错误地把答辩状排在前面（线上真实复现路径）
    it('8. 子串歧义：keyword 在多个模板 name 命中时，位置越靠前得分越高', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const litComplaint = await createTpl({
            name: '民事起诉状（公民提起民事诉讼用）',
            category: 'litigation',
            description: null,
            priority: 100,
        })
        const litResponse = await createTpl({
            name: '民事答辩状（公民对民事起诉提出答辩用）',
            category: 'litigation',
            description: null,
            priority: 100,
        })

        const result = await recommendDocumentTemplatesService({
            userId: user.id,
            intent: '帮我起草起诉状',
            keywords: ['起诉'],
            categoryHint: 'litigation',
            limit: 10,
        })

        const ids = result.items.map(i => i.id)
        const idxComplaint = ids.indexOf(litComplaint.id)
        const idxResponse = ids.indexOf(litResponse.id)
        expect(idxComplaint).toBeGreaterThanOrEqual(0)
        expect(idxResponse).toBeGreaterThanOrEqual(0)
        // 起诉状必须排在答辩状前面
        expect(idxComplaint).toBeLessThan(idxResponse)

        const scoreComplaint = result.items.find(i => i.id === litComplaint.id)!.score
        const scoreResponse = result.items.find(i => i.id === litResponse.id)!.score
        // 起诉状的 "起诉" 在 name 第 3 字符（idx=2），答辩状的 "起诉" 在 name 第 11 字符附近
        // 位置加权后，起诉状必须严格高于答辩状
        expect(scoreComplaint).toBeGreaterThan(scoreResponse)
    })

    // 进一步验证：name 以 keyword 开头时额外奖励（最关键的精确意图）
    it('9. name 以 keyword 开头额外加分（精确意图）', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const startsWith = await createTpl({ name: '起诉状-民事通用', category: 'litigation' })
        const middle = await createTpl({ name: '民事起诉状（公民提起民事诉讼用）', category: 'litigation' })

        const r = await recommendDocumentTemplatesService({
            userId: user.id,
            intent: '起诉状',
            keywords: ['起诉状'],
            categoryHint: 'litigation',
        })

        const sStart = r.items.find(i => i.id === startsWith.id)!.score
        const sMid = r.items.find(i => i.id === middle.id)!.score
        // name 以 "起诉状" 开头的应严格高于 name 中部含的
        expect(sStart).toBeGreaterThan(sMid)
    })

    it('10. items 中的 recentlyUsed 标记最近 30 天用过的模板', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const used = await createTpl({ name: '近期合同', category: 'general' })
        const unused = await createTpl({ name: '其他合同', category: 'general' })
        await createDraftWithTemplate(user.id, used.id, 5)

        const r = await recommendDocumentTemplatesService({
            userId: user.id,
            intent: '合同',
            keywords: ['合同'],
            limit: 20,
        })

        const usedItem = r.items.find(i => i.id === used.id)
        const unusedItem = r.items.find(i => i.id === unused.id)
        expect(usedItem!.recentlyUsed).toBe(true)
        expect(unusedItem!.recentlyUsed).toBe(false)
    })
})
