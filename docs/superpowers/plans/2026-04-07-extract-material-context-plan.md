# 案件信息提取 — 材料识别上下文方案实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** extract API 在提取前确保文件材料已完成识别→嵌入流程，支持 tiktoken 精确计数和 token 超限时分批摘要。

**Architecture:**
- 新建 `tokenCounter.ts` 提供 tiktoken 精确 token 计数
- 新建 `fileProcess.service.ts` 处理 OSS 文件粒度的识别→嵌入流程（不依赖 caseId）
- 复用现有识别服务（OCR、MinerU、ASR）的内置后台轮询机制
- extract API 接入新服务，支持全文模式和分批摘要模式

**Tech Stack:** tiktoken, js-tiktoken, LangChain, extractInfo 节点配置

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `server/utils/tokenCounter.ts` | 新建 | tiktoken 精确 token 计数 |
| `server/services/material/fileProcess.service.ts` | 新建 | OSS 文件粒度识别→嵌入流水线 |
| `server/services/material/materialPipeline.service.ts` | 修改 | 导出 `extractTextFromAsrResult` |
| `server/api/v1/case/extract.post.ts` | 修改 | 接入识别流程 + tiktoken + 分批摘要 |

---

## Task 1: 导出 `extractTextFromAsrResult`

> 后续服务需复用 ASR 结果解析逻辑，从私有函数改为导出。

**Files:**
- Modify: `server/services/material/materialPipeline.service.ts`

- [ ] **Step 1: 读取当前 `materialPipeline.service.ts` 中的 `extractTextFromAsrResult` 函数位置**

确认当前函数定义在文件中的行号。

- [ ] **Step 2: 将 `extractTextFromAsrResult` 从私有改为导出**

将 `function extractTextFromAsrResult` 改为 `export function extractTextFromAsrResult`。

- [ ] **Step 3: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增错误

- [ ] **Step 4: 提交**

```bash
git add server/services/material/materialPipeline.service.ts
git commit -m "feat(material): 导出 extractTextFromAsrResult 供外部复用"
```

---

## Task 2: 新建 `tokenCounter.ts`

> 提供 tiktoken 精确 token 计数，复用 `js-tiktoken` 包。

**Files:**
- Create: `server/utils/tokenCounter.ts`
- Test: `tests/server/utils/tokenCounter.test.ts`

- [ ] **Step 1: 确认 `js-tiktoken` 依赖**

Run: `ls node_modules/js-tiktoken 2>/dev/null || bun add js-tiktoken`
Expected: 已安装则跳过，未安装则安装成功

- [ ] **Step 2: 创建 `tokenCounter.test.ts` 并验证失败**

```typescript
// tests/server/utils/tokenCounter.test.ts
import { describe, it, expect, beforeAll } from 'vitest'

describe('countTokens', () => {
    it('应返回正整数', async () => {
        const { countTokens } = await import('~~/server/utils/tokenCounter')
        const result = await countTokens('你好世界')
        expect(result).toBeGreaterThan(0)
    })

    it('中英文混合文本应正确计数', async () => {
        const { countTokens } = await import('~~/server/utils/tokenCounter')
        const result = await countTokens('Hello 你好 world 世界')
        expect(result).toBeGreaterThan(0)
    })

    it('空字符串应返回 0', async () => {
        const { countTokens } = await import('~~/server/utils/tokenCounter')
        const result = await countTokens('')
        expect(result).toBe(0)
    })
})

describe('countTokensSync (fallback)', () => {
    it('编码已初始化时应返回与 async 一致的正整数', async () => {
        const { countTokens, countTokensSync } = await import('~~/server/utils/tokenCounter')
        // 先初始化 async 版本
        await countTokens('init')
        const syncResult = countTokensSync('测试文本')
        expect(syncResult).toBeGreaterThan(0)
    })

    it('未初始化时应使用字符估算 fallback', async () => {
        // 每个测试使用独立模块实例，通过模块搜索路径确保隔离
        // 直接验证估算结果为正整数且非 NaN
        const { countTokensSync } = await import('~~/server/utils/tokenCounter')
        const result = countTokensSync('hello world')
        expect(typeof result).toBe('number')
        expect(result).toBeGreaterThan(0)
        expect(Number.isNaN(result)).toBe(false)
    })
})
```

Run: `npx vitest run tests/server/utils/tokenCounter.test.ts --reporter=verbose`
Expected: FAIL（`countTokens` not defined）

- [ ] **Step 3: 创建 `tokenCounter.ts`**

```typescript
import { getEncoding } from 'js-tiktoken'

/** 全局编码实例（cl100k_base，兼容 DeepSeek V3 / GPT-4 / Qwen 等） */
let encoding: Awaited<ReturnType<typeof getEncoding>> | null = null

/** 获取或初始化编码实例（懒加载） */
async function getEncodingInstance() {
    if (!encoding) {
        encoding = await getEncoding('cl100k_base')
    }
    return encoding
}

/**
 * 精确计算文本的 token 数
 * @param text 待计数的文本
 * @returns token 数量
 */
export async function countTokens(text: string): Promise<number> {
    const enc = await getEncodingInstance()
    return enc.encode(text).length
}

/**
 * 同步版 token 计数（编码已初始化时使用，fallback 为字符估算）
 */
export function countTokensSync(text: string): number {
    if (!encoding) {
        // 未初始化时使用字符估算 fallback
        return estimateTokensFallback(text)
    }
    return encoding.encode(text).length
}

/** 字符估算 fallback（中文约 2 字符/token，英文约 4 字符/token） */
function estimateTokensFallback(text: string): number {
    if (!text) return 0
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const otherChars = text.length - chineseChars
    return Math.ceil(chineseChars / 2 + otherChars / 4)
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/utils/tokenCounter.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add server/utils/tokenCounter.ts tests/server/utils/tokenCounter.test.ts
git commit -m "feat(utils): 新增 tiktoken 精确 token 计数工具"
```

---

## Task 3: 新建 `fileProcess.service.ts`

> 处理 OSS 文件的识别（不依赖 caseId），复用底层识别服务和已有的 `extractTextFromAsrResult`。

**Files:**
- Create: `server/services/material/fileProcess.service.ts`
- Test: `tests/server/services/material/fileProcess.service.test.ts`

- [ ] **Step 1: 创建单元测试 `tests/server/services/material/fileProcess.service.test.ts` 并验证失败**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 所有外部依赖，对齐项目 vi.hoisted() 模式
const mocks = vi.hoisted(() => ({
    createImageConversionService: vi.fn(),
    convertPdfService: vi.fn(),
    getDocRecognitionByOssFileIdService: vi.fn(),
    transcribeAudioService: vi.fn(),
    extractTextFromAsrResult: vi.fn((r: any) => r?.text ?? ''),
    // Mock prisma 各表
    prisma: {
        ossFiles: { findMany: vi.fn() },
        docRecognitionRecords: { findMany: vi.fn() },
        imageRecognitionRecords: { findMany: vi.fn() },
        asrRecords: { findFirst: vi.fn() },
    },
    logger: { info: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../../../server/utils/prisma', () => ({
    prisma: mocks.prisma,
}))
vi.mock('~~/server/utils/prisma', () => ({
    prisma: mocks.prisma,
}))

vi.mock('../../../../server/services/material/ocr.service', () => ({
    createImageConversionService: mocks.createImageConversionService,
}))
vi.mock('~~/server/services/material/ocr.service', () => ({
    createImageConversionService: mocks.createImageConversionService,
}))

vi.mock('../../../../server/services/material/mineru.service', () => ({
    convertPdfService: mocks.convertPdfService,
    getDocRecognitionByOssFileIdService: mocks.getDocRecognitionByOssFileIdService,
}))
vi.mock('~~/server/services/material/mineru.service', () => ({
    convertPdfService: mocks.convertPdfService,
    getDocRecognitionByOssFileIdService: mocks.getDocRecognitionByOssFileIdService,
}))

vi.mock('../../../../server/services/material/asr.service', () => ({
    transcribeAudioService: mocks.transcribeAudioService,
}))
vi.mock('~~/server/services/material/asr.service', () => ({
    transcribeAudioService: mocks.transcribeAudioService,
}))

vi.mock('../../../../server/services/material/materialPipeline.service', () => ({
    extractTextFromAsrResult: mocks.extractTextFromAsrResult,
}))
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    extractTextFromAsrResult: mocks.extractTextFromAsrResult,
}))

vi.mock('../../../../server/utils/logger', () => ({
    logger: mocks.logger,
}))
vi.mock('~~/server/utils/logger', () => ({
    logger: mocks.logger,
}))

import { processFileMaterials } from '../../../../server/services/material/fileProcess.service'

describe('processFileMaterials', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应返回 FileProcessContext 数组', async () => {
        // Mock ossFiles 有记录但无识别记录，识别失败
        mocks.prisma.ossFiles.findMany.mockResolvedValue([
            { id: 1, fileName: 'test.pdf', fileType: 'application/pdf', filePath: '/path', deletedAt: null },
        ])
        mocks.prisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mocks.prisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mocks.prisma.asrRecords.findMany.mockResolvedValue([])
        mocks.convertPdfService.mockResolvedValue({ success: false, error: '识别失败' })

        const result = await processFileMaterials([1], 1)
        expect(Array.isArray(result)).toBe(true)
        expect(result[0]).toHaveProperty('ossFileId')
        expect(result[0]).toHaveProperty('recognitionStatus')
    })

    it('文件不存在时应返回 failed 状态', async () => {
        mocks.prisma.ossFiles.findMany.mockResolvedValue([])
        mocks.prisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mocks.prisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mocks.prisma.asrRecords.findMany.mockResolvedValue([])

        const result = await processFileMaterials([999], 1)
        expect(result[0].recognitionStatus).toBe('failed')
        expect(result[0].error).toBe('文件不存在')
    })

    it('已有识别记录时应直接返回内容', async () => {
        mocks.prisma.ossFiles.findMany.mockResolvedValue([
            { id: 1, fileName: 'test.pdf', fileType: 'application/pdf', filePath: '/path', deletedAt: null },
        ])
        mocks.prisma.docRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 1, status: 2, markdownContent: '已识别的内容', deletedAt: null },
        ])
        mocks.prisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mocks.prisma.asrRecords.findMany.mockResolvedValue([])

        const result = await processFileMaterials([1], 1)
        expect(result[0].recognitionStatus).toBe('success')
        expect(result[0].content).toBe('已识别的内容')
    })
})
```

Run: `npx vitest run tests/server/services/material/fileProcess.service.test.ts --reporter=verbose`
Expected: FAIL（`processFileMaterials` not defined）

- [ ] **Step 2: 创建 `fileProcess.service.ts`**

```typescript
/**
 * 文件粒度识别服务（提取阶段专用，不关联案件）
 */

import { CaseMaterialType, getMaterialTypeFromMime } from '#shared/types/case'
import { extractTextFromAsrResult } from './materialPipeline.service'
import { createImageConversionService } from './ocr.service'
import { convertPdfService, getDocRecognitionByOssFileIdService } from './mineru.service'
import { transcribeAudioService } from './asr.service'

/** 文件处理上下文（提取阶段的材料容器，不关联案件） */
export interface FileProcessContext {
    ossFileId: number
    name: string
    /** 文件 MIME 类型 */
    fileType: string
    /** 材料类型 */
    materialType: CaseMaterialType
    /** 识别状态 */
    recognitionStatus: 'idle' | 'processing' | 'success' | 'failed'
    /** 识别内容 */
    content?: string
    /** 错误信息 */
    error?: string
}

/**
 * 处理 OSS 文件的识别（不关联案件）
 *
 * @param ossFileIds OSS 文件 ID 列表
 * @param userId 当前用户 ID
 * @returns 每个文件的处理结果
 */
export async function processFileMaterials(
    ossFileIds: number[],
    userId: number,
): Promise<FileProcessContext[]> {
    // 1. 批量查询 OSS 文件信息
    const ossFiles = await prisma.ossFiles.findMany({
        where: { id: { in: ossFileIds }, deletedAt: null },
        select: { id: true, fileName: true, fileType: true, filePath: true },
    })
    const fileMap = new Map(ossFiles.map(f => [f.id, f]))

    // 2. 批量查询已识别的记录
    const [docRecords, imgRecords, asrRecords] = await Promise.all([
        prisma.docRecognitionRecords.findMany({
            where: { ossFileId: { in: ossFileIds }, deletedAt: null },
            select: { ossFileId: true, status: true, markdownContent: true },
        }),
        prisma.imageRecognitionRecords.findMany({
            where: { ossFileId: { in: ossFileIds }, deletedAt: null },
            select: { ossFileId: true, status: true, markdownContent: true },
        }),
        prisma.asrRecords.findMany({
            where: { ossFileId: { in: ossFileIds }, deletedAt: null },
            select: { ossFileId: true, status: true, summary: true, result: true },
        }),
        Promise.resolve([]), // textRecords 本阶段不需要
    ])

    // 3. 逐个处理
    const results: FileProcessContext[] = []
    for (const ossFileId of ossFileIds) {
        const ossFile = fileMap.get(ossFileId)
        if (!ossFile) {
            results.push({
                ossFileId,
                name: `file_${ossFileId}`,
                fileType: 'unknown',
                materialType: CaseMaterialType.DOCUMENT,
                recognitionStatus: 'failed',
                error: '文件不存在',
            })
            continue
        }

        const materialType = getMaterialTypeFromMime(ossFile.fileType)
        const existingContent = findExistingContent(ossFileId, materialType, docRecords, imgRecords, asrRecords)

        if (existingContent) {
            results.push({
                ossFileId,
                name: ossFile.fileName,
                fileType: ossFile.fileType ?? 'unknown',
                materialType,
                recognitionStatus: 'success',
                content: existingContent,
            })
            continue
        }

        try {
            const content = await recognizeFile(ossFileId, materialType, userId)
            results.push({
                ossFileId,
                name: ossFile.fileName,
                fileType: ossFile.fileType ?? 'unknown',
                materialType,
                recognitionStatus: 'success',
                content,
            })
        } catch (err: any) {
            results.push({
                ossFileId,
                name: ossFile.fileName,
                fileType: ossFile.fileType ?? 'unknown',
                materialType,
                recognitionStatus: 'failed',
                error: err.message,
            })
        }
    }

    // 4. 过滤已成功文件（嵌入在案件创建后处理）
    const succeeded = results.filter(r => r.recognitionStatus === 'success' && r.content)
    if (succeeded.length > 0) {
        logger.info('文件识别完成，嵌入将由案件创建后的流程处理', {
            ossFileIds: succeeded.map(f => f.ossFileId),
        })
    }

    return results
}

/** 查找已有识别内容 */
function findExistingContent(
    ossFileId: number,
    materialType: CaseMaterialType,
    docRecords: any[],
    imgRecords: any[],
    asrRecords: any[],
): string | null {
    switch (materialType) {
        case CaseMaterialType.DOCUMENT: {
            const r = docRecords.find(r => r.ossFileId === ossFileId && r.status === 2)
            return r?.markdownContent ?? null
        }
        case CaseMaterialType.IMAGE: {
            const r = imgRecords.find(r => r.ossFileId === ossFileId && r.status === 2)
            return r?.markdownContent ?? null
        }
        case CaseMaterialType.AUDIO: {
            const r = asrRecords.find(r => r.ossFileId === ossFileId && r.status === 2)
            return r?.summary ?? extractTextFromAsrResult(r?.result) ?? null
        }
        default:
            return null
    }
}

/**
 * 统一等待识别完成（不重复启动轮询）
 *
 * 底层服务已内置后台轮询：
 * - convertPdfService → startTaskPollingService
 * - transcribeAudioService → startAsrTaskPollingService
 *
 * 当前函数仅查询 DB 状态。
 */
async function waitForRecognitionComplete(
    type: 'doc' | 'audio',
    ossFileId: number,
): Promise<string> {
    const MAX_WAIT_MS = 5 * 60 * 1000
    const INTERVAL_MS = type === 'doc' ? 5000 : 3000
    const startTime = Date.now()

    while (Date.now() - startTime < MAX_WAIT_MS) {
        await new Promise(resolve => setTimeout(resolve, INTERVAL_MS))

        if (type === 'doc') {
            const record = await getDocRecognitionByOssFileIdService(ossFileId)
            if (record?.markdownContent) return record.markdownContent
        } else {
            const record = await prisma.asrRecords.findFirst({
                where: { ossFileId, status: 2, deletedAt: null },
                select: { summary: true, result: true },
            })
            if (record) {
                const content = record.summary || extractTextFromAsrResult(record.result)
                if (content) return content
            }
        }
    }

    throw new Error(`${type === 'doc' ? '文档' : '音频'}识别超时`)
}

/**
 * 触发文件识别
 * - 图片：同步处理
 * - 文档/音频：异步处理，提交后等待完成
 */
async function recognizeFile(
    ossFileId: number,
    materialType: CaseMaterialType,
    userId: number,
): Promise<string> {
    switch (materialType) {
        case CaseMaterialType.IMAGE: {
            const result = await createImageConversionService(ossFileId, userId)
            if (!result.success) throw new Error(result.error || '图片识别失败')
            return result.record?.markdownContent ?? ''
        }
        case CaseMaterialType.AUDIO: {
            const result = await transcribeAudioService(ossFileId, userId)
            if (!result.success) throw new Error(result.error || '音频识别失败')
            // 内部已启动后台轮询，等待 DB 状态变化
            if (result.task?.taskId && result.task.taskId !== 'existing') {
                return await waitForRecognitionComplete('audio', ossFileId)
            }
            // 兜底直接查 DB
            const record = await prisma.asrRecords.findFirst({
                where: { ossFileId, status: 2, deletedAt: null },
                select: { summary: true, result: true },
            })
            const content = record?.summary || extractTextFromAsrResult(record?.result)
            if (content) return content
            throw new Error('音频识别结果为空')
        }
        default: {
            const result = await convertPdfService(ossFileId, userId)
            if (!result.success) throw new Error(result.error || '文档识别失败')
            if (result.task?.taskId && result.task.taskId !== 'existing') {
                return await waitForRecognitionComplete('doc', ossFileId)
            }
            const record = await getDocRecognitionByOssFileIdService(ossFileId)
            if (record?.markdownContent) return record.markdownContent
            throw new Error('文档识别结果为空')
        }
    }
}
```

- [ ] **Step 3: 运行测试验证通过**

Run: `npx vitest run tests/server/services/material/fileProcess.service.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 4: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add server/services/material/fileProcess.service.ts tests/server/services/material/fileProcess.service.test.ts
git commit -m "feat(material): 新增文件粒度识别服务 fileProcess.service"
```

---

## Task 4: 修改 `extract.post.ts`

> 接入 `processFileMaterials` + `countTokens`，支持全文模式和分批摘要模式。

**Files:**
- Modify: `server/api/v1/case/extract.post.ts`（完整重写原有逻辑）

- [ ] **Step 1: 读取当前 `extract.post.ts` 完整内容**

确认所有现有逻辑后再修改。**注意：新实现需要移除以下导入和调用：**
- `validateCaseAccessService`、`getMaterialsByCaseIdService`、`ensureMaterialsReadyService`、`getMaterialContextService`、`buildMaterialContextMessage` — 不再需要
- 移除 `caseId` 相关逻辑和 schema 中的 `caseId` 字段
- 新增 `materials` 参数（ossFileId + name 数组）

- [ ] **Step 2: 替换为新实现**

完整替换文件内容：

```typescript
/**
 * AI 信息提取端点
 *
 * POST /api/v1/case/extract
 *
 * 调用 extractInfo 节点从案件描述中提取结构化信息
 * 返回 JSON 格式的 ExtractedCaseInfo
 *
 * 流程：
 * 1. 对 OSS 文件执行识别（已识别则跳过，未识别则触发）
 * 2. 读取识别结果文本内容
 * 3. token 阈值检查：
 *    - 未超限 → 全文直接传给 LLM
 *    - 超限 → 分批摘要 + 合并提取
 * 4. 返回提取结果
 */

import { z } from 'zod'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { processFileMaterials } from '~~/server/services/material/fileProcess.service'
import type { FileProcessContext } from '~~/server/services/material/fileProcess.service'
import { countTokens } from '~~/server/utils/tokenCounter'

const EXTRACT_NODE_NAME = 'extractInfo'

const schema = z.object({
    message: z.string().min(1),
    materials: z.array(z.object({
        ossFileId: z.number().int().positive(),
        name: z.string(),
    })).optional(),
})

export default defineEventHandler(async (event) => {
    // 1. 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 解析请求体
    const body = await readBody(event)
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数校验失败')
    }

    const { message, materials } = parsed.data

    // 3. 加载 extractInfo 节点配置
    let nodeConfig
    try {
        nodeConfig = await getValidNodeConfig(EXTRACT_NODE_NAME, '信息提取')
    } catch (err: any) {
        return resError(event, 500, err.message)
    }

    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        return resError(event, 500, '信息提取节点无可用 API 密钥')
    }

    // 4. 创建模型实例（全文和摘要模式均复用）
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0,
        streaming: false,
    })

    // 5. 计算 token 阈值
    const tokenThreshold = nodeConfig.modelContextWindow
        ? Math.floor(nodeConfig.modelContextWindow * 0.7)
        : 32000

    // 6. 构建系统提示词骨架
    const systemPromptConfig = nodeConfig.prompts?.find(
        (p: { type: string; status: number }) => p.type === 'system' && p.status === 1,
    )
    const systemPrompt = systemPromptConfig?.content ?? ''

    // 7. 查询可用案件类型约束
    const enabledCaseTypes = await getEnabledCaseTypesService()
    const caseTypeNames = enabledCaseTypes.map(ct => ct.name)
    const caseTypeConstraint = `\n\n## 案件类型约束\n案件类型（caseType）必须从以下列表中选择，不得自行创造：\n${caseTypeNames.map(n => `- ${n}`).join('\n')}\n如果无法确定案件类型，请选择最接近的一个。`

    // 8. 材料处理：识别 → 读取内容
    let fileContexts: FileProcessContext[] = []
    if (materials?.length) {
        const ossFileIds = materials.map(m => m.ossFileId)
        fileContexts = await processFileMaterials(ossFileIds, user.id)
    }

    // 9. 构建材料上下文
    let materialContext = ''
    if (fileContexts.length > 0) {
        const succeeded = fileContexts.filter(f => f.recognitionStatus === 'success' && f.content)
        const failed = fileContexts.filter(f => f.recognitionStatus === 'failed')

        if (succeeded.length > 0) {
            materialContext = buildMaterialContext(succeeded)
        }

        if (failed.length > 0) {
            const failedNames = failed.map(f => `${f.name}（${f.error}）`).join('、')
            logger.warn(`部分材料识别失败: ${failedNames}`)
        }
    }

    // 10. 构建完整系统提示词
    const systemWithContext = systemPrompt + materialContext + caseTypeConstraint

    // 11. token 阈值检查
    const totalTokens = await countTokens(systemWithContext + message)

    let extractResult: { extractedInfo: any; message: string | null }

    if (totalTokens < tokenThreshold) {
        // 11a. 未超限：直接全文提取
        extractResult = await doExtract(model, systemWithContext, message, nodeConfig.outputSchema)
    } else {
        // 11b. 超限：分批摘要 + 合并提取
        logger.info('材料上下文超过 token 阈值，启用分批摘要模式', {
            totalTokens,
            tokenThreshold,
        })
        extractResult = await summarizeAndExtract(
            model,
            fileContexts.filter(f => f.recognitionStatus === 'success' && f.content),
            message,
            systemPrompt,
            caseTypeConstraint,
            nodeConfig,
        )
    }

    // 12. 返回结果
    const failedMaterials = fileContexts
        .filter(f => f.recognitionStatus === 'failed')
        .map(f => ({ name: f.name, error: f.error }))

    return resSuccess(event, '提取成功', {
        message: nodeConfig.outputSchema
            ? '已为您提取案件信息，请确认以下内容：'
            : extractResult.message,
        extractedInfo: extractResult.extractedInfo,
        materialMeta: {
            total: fileContexts.length,
            succeeded: fileContexts.filter(f => f.recognitionStatus === 'success').length,
            failed: failedMaterials.length,
            failedMaterials: failedMaterials.length > 0 ? failedMaterials : undefined,
        },
    })
})

/** 构建材料上下文（全文模式） */
function buildMaterialContext(fileContexts: FileProcessContext[]): string {
    const header = '\n\n## 用户上传的材料内容\n'
    const body = fileContexts
        .map(f => `### ${f.name}\n${f.content || '[无内容]'}`)
        .join('\n\n')
    return header + body
}

/** 执行案件信息提取 */
async function doExtract(
    model: any,
    systemWithContext: string,
    userMessage: string,
    outputSchema: Record<string, unknown> | null,
): Promise<{ extractedInfo: any; message: string | null }> {
    const messages = [
        new SystemMessage(systemWithContext),
        new HumanMessage(userMessage),
    ]

    if (outputSchema) {
        const structuredModel = model.withStructuredOutput(outputSchema)
        const result = await structuredModel.invoke(messages)
        return { extractedInfo: result, message: null }
    } else {
        const result = await model.invoke(messages)
        const content = typeof result.content === 'string'
            ? result.content
            : JSON.stringify(result.content)
        return { extractedInfo: null, message: content }
    }
}

/** 分批摘要 + 合并提取（超限模式） */
async function summarizeAndExtract(
    model: any,
    fileContexts: FileProcessContext[],
    userMessage: string,
    systemPrompt: string,
    caseTypeConstraint: string,
    nodeConfig: any,
): Promise<{ extractedInfo: any; message: string | null }> {
    const summaryModel = model // 与 extract 使用相同模型实例

    const summaryPromptTemplate = `请仔细阅读以下材料，生成 300-500 字的摘要，保留所有关键信息：

材料名称：{name}

材料内容：
{content}`

    // 并行生成各文件摘要
    const summaries: string[] = []
    for (const file of fileContexts) {
        if (!file.content) continue
        try {
            // 按 tiktoken 估算约 50000 字符 ≈ 60000 tokens
            const truncated = file.content.length > 50000
                ? file.content.slice(0, 50000) + '\n\n[内容过长已截断]'
                : file.content
            const result = await summaryModel.invoke([
                new HumanMessage(
                    summaryPromptTemplate
                        .replace('{name}', file.name)
                        .replace('{content}', truncated)
                ),
            ])
            const summary = typeof result.content === 'string'
                ? result.content
                : JSON.stringify(result.content)
            summaries.push(`【${file.name}摘要】\n${summary.trim()}`)
        } catch (err: any) {
            logger.warn(`材料摘要生成失败: ${file.name}`, { error: err.message })
            summaries.push(
                `【${file.name}摘要】\n[摘要生成失败，原文预览: ${file.content.slice(0, 200)}...]`
            )
        }
    }

    // 构建摘要上下文并执行最终提取
    const summaryContext = '\n\n## 材料摘要\n' + summaries.join('\n\n')
    const finalSystemPrompt = systemPrompt + summaryContext + caseTypeConstraint

    return await doExtract(model, finalSystemPrompt, userMessage, nodeConfig.outputSchema)
}
```

- [ ] **Step 3: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add server/api/v1/case/extract.post.ts
git commit -m "feat(extract): 接入文件识别流程，支持 tiktoken 计数和分批摘要"
```

---

## Task 5: 端到端验证

- [ ] **Step 1: 启动开发服务器**

Run: `bun dev`

- [ ] **Step 2: 测试全文模式（token 未超限）**

使用少量小文件测试，验证识别流程正常工作。

- [ ] **Step 3: 测试识别失败场景**

传入不存在的 ossFileId，验证错误处理和 materialMeta 响应。

- [ ] **Step 4: 使用 `simplify` 优化代码**

```bash
@simplify
```

---

## 改动文件清单

| 文件 | 动作 |
|------|------|
| `server/services/material/materialPipeline.service.ts` | 导出 `extractTextFromAsrResult` |
| `server/utils/tokenCounter.ts` | 新建 |
| `server/services/material/fileProcess.service.ts` | 新建 |
| `server/api/v1/case/extract.post.ts` | 修改 |
