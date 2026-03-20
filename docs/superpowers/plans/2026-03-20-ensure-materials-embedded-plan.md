# ensureMaterialsEmbeddedService 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `ensureMaterialsEmbeddedService` 服务函数，完成案件分析端点中 TODO 批量嵌入未嵌入材料的功能。

**Architecture:** 在 `materialEmbedding.service.ts` 新增服务函数，按材料类型分发到现有嵌入服务，全并行处理并容错。端点侧替换 TODO 为一行调用并清理调试代码。

**Tech Stack:** TypeScript, Vitest, Prisma, LangChain (vectorStore)

**Spec:** `docs/superpowers/specs/2026-03-20-ensure-materials-embedded-design.md`

---

### Task 1: 编写 ensureMaterialsEmbeddedService 单元测试

**Files:**
- Create: `tests/server/material/ensure-materials-embedded.test.ts`

测试文件使用真实数据库创建测试材料，mock 向量化服务（`embedMaterialService` 和 `embedTextMaterialService`），验证分发逻辑、并行执行和容错行为。

- [ ] **Step 1: 创建测试文件并编写测试用例**

```typescript
/**
 * ensureMaterialsEmbeddedService 测试
 *
 * 测试批量嵌入服务的分发逻辑、并行执行和容错行为
 * mock 向量化服务避免真实 embedding API 调用
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'

// mock 依赖服务
vi.mock('../../../server/services/case/caseMaterial.service', () => ({
    embedTextMaterialService: vi.fn(),
}))
vi.mock('../../../server/services/material/materialEmbedding.service', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../server/services/material/materialEmbedding.service')>()
    return {
        ...original,
        embedMaterialService: vi.fn(),
    }
})
vi.mock('../../../server/services/case/caseMaterial.dao', () => ({
    updateMaterialEmbeddingStatusDAO: vi.fn(),
}))

import { ensureMaterialsEmbeddedService } from '../../../server/services/material/materialEmbedding.service'
import { embedTextMaterialService } from '../../../server/services/case/caseMaterial.service'
import { embedMaterialService } from '../../../server/services/material/materialEmbedding.service'
import { updateMaterialEmbeddingStatusDAO } from '../../../server/services/case/caseMaterial.dao'

// 辅助：创建测试材料
function makeMaterial(overrides: Partial<MaterialWithFile> & { id: number; type: number; name: string }): MaterialWithFile {
    return {
        caseId: 1,
        content: '测试内容',
        originalContent: null,
        ossFileId: null,
        isEncrypted: false,
        status: 3,
        embeddingStatus: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
    } as MaterialWithFile
}

describe('ensureMaterialsEmbeddedService', () => {
    const userId = 1
    const caseId = 1
    const sessionId = 'test-session-id'

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('空数组应返回全零统计', async () => {
        const result = await ensureMaterialsEmbeddedService([], userId, caseId, sessionId)
        expect(result).toEqual({ total: 0, success: 0, failed: 0, skipped: 0 })
    })

    it('文本材料应调用 embedTextMaterialService', async () => {
        vi.mocked(embedTextMaterialService).mockResolvedValue({
            success: true, materialId: 1, chunkCount: 3,
        })

        const materials = [makeMaterial({ id: 1, type: 1, name: '案情描述' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(embedTextMaterialService).toHaveBeenCalledWith(1, userId, caseId, sessionId)
        expect(result.success).toBe(1)
        expect(result.total).toBe(1)
    })

    it('非文本材料（有 content）应调用 embedMaterialService', async () => {
        vi.mocked(embedMaterialService).mockResolvedValue({
            ids: ['id1'], lastEmbeddingAt: '2026-01-01', chunkCount: 2,
        })
        vi.mocked(updateMaterialEmbeddingStatusDAO).mockResolvedValue(undefined)

        const materials = [makeMaterial({ id: 2, type: 2, name: '合同.pdf', content: 'PDF内容' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(embedMaterialService).toHaveBeenCalledWith(expect.objectContaining({
            content: 'PDF内容',
            userId,
            caseId,
            materialId: 2,
            sessionId,
            materialName: '合同.pdf',
            materialType: 2,
        }))
        expect(updateMaterialEmbeddingStatusDAO).toHaveBeenCalledWith(2, 'processing')
        expect(updateMaterialEmbeddingStatusDAO).toHaveBeenCalledWith(2, 'completed')
        expect(result.success).toBe(1)
    })

    it('非文本材料 content 为空应标记 skipped', async () => {
        const materials = [makeMaterial({ id: 3, type: 3, name: '证据.jpg', content: null })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(embedMaterialService).not.toHaveBeenCalled()
        expect(updateMaterialEmbeddingStatusDAO).not.toHaveBeenCalled()
        expect(result.skipped).toBe(1)
        expect(result.success).toBe(0)
    })

    it('混合材料应全部并行处理并正确统计', async () => {
        vi.mocked(embedTextMaterialService).mockResolvedValue({
            success: true, materialId: 1, chunkCount: 3,
        })
        vi.mocked(embedMaterialService).mockResolvedValue({
            ids: ['id1'], lastEmbeddingAt: '2026-01-01', chunkCount: 2,
        })
        vi.mocked(updateMaterialEmbeddingStatusDAO).mockResolvedValue(undefined)

        const materials = [
            makeMaterial({ id: 1, type: 1, name: '案情描述' }),          // 文本
            makeMaterial({ id: 2, type: 2, name: '合同.pdf', content: 'PDF' }), // 文档有内容
            makeMaterial({ id: 3, type: 3, name: '证据.jpg', content: null }),  // 图片无内容
            makeMaterial({ id: 4, type: 4, name: '录音.mp3', content: '转写' }), // 音频有内容
        ]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(result).toEqual({ total: 4, success: 3, failed: 0, skipped: 1 })
    })

    it('embedTextMaterialService 失败应计为 failed', async () => {
        vi.mocked(embedTextMaterialService).mockRejectedValue(new Error('向量化失败'))

        const materials = [makeMaterial({ id: 1, type: 1, name: '案情描述' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(result.failed).toBe(1)
        expect(result.success).toBe(0)
    })

    it('embedMaterialService 失败应更新状态为 failed', async () => {
        vi.mocked(embedMaterialService).mockRejectedValue(new Error('向量化失败'))
        vi.mocked(updateMaterialEmbeddingStatusDAO).mockResolvedValue(undefined)

        const materials = [makeMaterial({ id: 2, type: 2, name: '合同.pdf', content: 'PDF' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(updateMaterialEmbeddingStatusDAO).toHaveBeenCalledWith(2, 'failed')
        expect(result.failed).toBe(1)
    })

    it('embedTextMaterialService 返回 success: false 应计为 failed', async () => {
        vi.mocked(embedTextMaterialService).mockResolvedValue({
            success: false, materialId: 1, error: '内容为空',
        })

        const materials = [makeMaterial({ id: 1, type: 1, name: '案情描述' })]
        const result = await ensureMaterialsEmbeddedService(materials, userId, caseId, sessionId)

        expect(result.failed).toBe(1)
    })
})
```

- [ ] **Step 2: 运行测试，验证全部失败**

```bash
npx vitest run tests/server/material/ensure-materials-embedded.test.ts --reporter=verbose
```

Expected: FAIL — `ensureMaterialsEmbeddedService` 尚未导出

- [ ] **Step 3: 提交测试文件**

```bash
git add tests/server/material/ensure-materials-embedded.test.ts
git commit -m "test(analysis): 新增 ensureMaterialsEmbeddedService 单元测试"
```

---

### Task 2: 实现 ensureMaterialsEmbeddedService

**Files:**
- Modify: `server/services/material/materialEmbedding.service.ts`（文件末尾追加）

- [ ] **Step 1: 在 materialEmbedding.service.ts 文件顶部修改和添加 import**

修改第 19 行的 `CaseMaterialType` import（当前从 `#shared/types/material` 导入，但该文件只做 `import type` 不 re-export 枚举值，运行时无法访问）：

```typescript
// 修改前：import { CaseMaterialType } from '#shared/types/material'
// 修改后：
import { CaseMaterialType } from '#shared/types/case'
```

在 import 区域添加：

```typescript
import type { MaterialWithFile } from './material.service'
import { updateMaterialEmbeddingStatusDAO } from '../case/caseMaterial.dao'
```

- [ ] **Step 2: 在文件末尾追加 ensureMaterialsEmbeddedService 函数**

```typescript
/**
 * 确保材料列表全部完成嵌入
 *
 * 对未嵌入的材料按类型分类，全并行调用对应的嵌入服务。
 * 失败的材料记录日志但不阻断流程。
 *
 * @param materials 需要嵌入的材料列表
 * @param userId 用户 ID
 * @param caseId 案件 ID
 * @param sessionId 会话 ID
 * @returns 嵌入统计结果
 */
export async function ensureMaterialsEmbeddedService(
    materials: MaterialWithFile[],
    userId: number,
    caseId: number,
    sessionId: string
): Promise<{
    total: number
    success: number
    failed: number
    skipped: number
}> {
    if (materials.length === 0) {
        return { total: 0, success: 0, failed: 0, skipped: 0 }
    }

    const results = await Promise.allSettled(
        materials.map(material => embedSingleMaterial(material, userId, caseId, sessionId))
    )

    let success = 0
    let failed = 0
    let skipped = 0

    for (const result of results) {
        if (result.status === 'fulfilled') {
            switch (result.value) {
                case 'success': success++; break
                case 'failed': failed++; break
                case 'skipped': skipped++; break
            }
        } else {
            // Promise.allSettled rejected 不应发生（内部已 try-catch），但以防万一
            failed++
        }
    }

    return { total: materials.length, success, failed, skipped }
}

/**
 * 嵌入单个材料（内部辅助函数）
 * 按材料类型分发到对应的嵌入服务
 */
async function embedSingleMaterial(
    material: MaterialWithFile,
    userId: number,
    caseId: number,
    sessionId: string
): Promise<'success' | 'failed' | 'skipped'> {
    try {
        if (material.type === CaseMaterialType.CASE_CONTENT) {
            // 文本材料：使用 embedTextMaterialService（含完整状态管理）
            const { embedTextMaterialService } = await import('../case/caseMaterial.service')
            const result = await embedTextMaterialService(material.id, userId, caseId, sessionId)
            return result.success ? 'success' : 'failed'
        }

        // 非文本材料：校验 content
        if (!material.content || material.content.trim() === '') {
            logger.warn('材料内容为空，跳过嵌入', { materialId: material.id, type: material.type })
            return 'skipped'
        }

        // 更新状态为 processing
        await updateMaterialEmbeddingStatusDAO(material.id, 'processing')

        // 构造输入并调用 embedMaterialService
        const input: EmbedMaterialInput = {
            content: material.content,
            userId,
            caseId,
            materialId: material.id,
            sessionId,
            materialName: material.name,
            materialType: material.type as CaseMaterialType,
        }
        await embedMaterialService(input)

        // 更新状态为 completed
        await updateMaterialEmbeddingStatusDAO(material.id, 'completed')
        return 'success'
    } catch (error: any) {
        logger.error('材料嵌入失败', {
            materialId: material.id,
            type: material.type,
            error: error.message,
        })

        // 非文本材料尝试更新状态为 failed（文本材料由 embedTextMaterialService 内部管理状态）
        if (material.type !== CaseMaterialType.CASE_CONTENT) {
            try {
                await updateMaterialEmbeddingStatusDAO(material.id, 'failed')
            } catch {
                // 状态更新失败不阻断
            }
        }

        return 'failed'
    }
}
```

- [ ] **Step 3: 运行测试，验证全部通过**

```bash
npx vitest run tests/server/material/ensure-materials-embedded.test.ts --reporter=verbose
```

Expected: 7 tests PASS

- [ ] **Step 4: 提交实现代码**

```bash
git add server/services/material/materialEmbedding.service.ts
git commit -m "feat(analysis): 实现 ensureMaterialsEmbeddedService 批量嵌入服务"
```

---

### Task 3: 更新端点调用并清理

**Files:**
- Modify: `server/api/v1/case/analysis/stream/[sessionId].post.ts`

- [ ] **Step 1: 替换 TODO 并清理调试代码**

最终文件内容：

```typescript
/**
 * SSE 流式分析
 *
 * POST /api/v1/case/analysis/stream/[sessionId]
 *
 * 启动案件分析工作流，通过 SSE 实时返回 AI 分析过程和结果
 *
 * Requirements: 1.3, 9.1, 9.3, 12.3, 12.4
 */

import { toUIMessageStream } from '@ai-sdk/langchain'
import { createUIMessageStreamResponse } from 'ai'
import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'
import { mainAgent } from '~~/server/services/agent/main'
import { getMaterialsByCaseIdService } from '~~/server/services/material/material.service'
import { ensureMaterialsEmbeddedService } from '~~/server/services/material/materialEmbedding.service'


export default defineEventHandler(async (event) => {

    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取路由参数
    const sessionId = getRouterParam(event, 'sessionId')
    if (!sessionId) {
        return resError(event, 400, 'sessionId 不能为空')
    }

    // 先验证（非 SSE 阶段），确保走到这里才设置 SSE 头
    const caseInfo = await findCaseBySessionIdService(sessionId)
    if (!caseInfo) {
        return resError(event, 404, '案件不存在')
    }
    if (user.id !== caseInfo.userId) {
        return resError(event, 403, '您没有权限访问该案件')
    }

    // 获取案件所有材料
    const materials = await getMaterialsByCaseIdService(caseInfo.id)

    // 确保所有材料已完成嵌入
    const noEmbeddedMaterials = materials.filter(material => material.embeddingStatus !== 'completed')
    if (noEmbeddedMaterials.length > 0) {
        const embedResult = await ensureMaterialsEmbeddedService(
            noEmbeddedMaterials, user.id, caseInfo.id, sessionId
        )
        logger.info('批量嵌入完成', embedResult)
    }

    console.log('开始分析案件')
    // 使用案件的 content 作为 prompt
    const prompt = "原告2021年5月份在宝马官方二手车网站上看到了被告售卖的宝马3系长轴距版 330Li xDrive车辆，车辆状态为未上牌，总价37万。到店看完车之后，于 2021年5月22日缴纳1万元定金，2021年5月29日到店支付首付款共18.3万元并签订了合同，约定2021年6月5日提车。\n2021年6月3日被告告知因为售价过低，无法开票，需要走集团流程申请。经过和被告沟通，将提车日期改到2021年6月8日。2021年6月7日再次被被告告知合格证已被使用，无法开具发票，需要跟厂家沟通。随后反馈是税务系统升级导致无法开具发票，需要跟税务局沟通，无具体解决时间。\n2021年6月11日到店沟通，被告依旧无法给出解决的方案与时间。最终协商暂时退还18.8万元，保留5000定金，继续履行合同。\n2021年7月10日，原告到店跟被告咨询处理方案，仍无法给出具体提车时间，也无法说明开不出发票的具体原因。原告提出2021年7月16日前提车，如无法提车则中止合同，并按民法典第五百八十七条规定返还双倍定金，同时赔偿2021年6月5日至2021年7月16日共41天的用车损失诉求。被告回复只能退车，不接受赔偿。\n2021年7月24日，原告受被告邀请到店协商赔偿事宜，被告拒绝按民法典五百八十七条的条款返回合同双倍定金，拒绝赔偿用车损失，只愿意支付5000-8000元的赔偿费用。"


    // 调用 mainAgent 获取 LangGraph 流，并转换为 AI SDK 标准格式
    const agentStream = await mainAgent(sessionId, prompt)
    const uiStream = toUIMessageStream(agentStream)

    // 创建 SSE 响应
    return createUIMessageStreamResponse({
        stream: uiStream,
        headers: {
            'X-Accel-Buffering': 'no',
        },
    })
})
```

变更点：
1. 新增 `import { ensureMaterialsEmbeddedService }`
2. 移除 `console.log(JSON.stringify(materials, null, 2))`
3. 替换 TODO 注释为 `ensureMaterialsEmbeddedService` 调用
4. 移除多余空行

> **注意**：端点中 `console.log('开始分析案件')` 和硬编码 prompt 字符串属于既有的临时开发代码，不在本次 TODO 改动范围内，将在后续 SSE 流式分析任务中一并清理。

- [ ] **Step 2: 运行完整测试套件验证无回归**

```bash
npx vitest run tests/server/material/ --reporter=verbose
```

Expected: 所有测试 PASS

- [ ] **Step 3: 提交端点改动**

```bash
git add server/api/v1/case/analysis/stream/\[sessionId\].post.ts
git commit -m "refactor(analysis): 案件分析端点集成批量嵌入服务并清理调试代码"
```
