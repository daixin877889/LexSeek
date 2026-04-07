# 案件信息提取 — 材料识别上下文方案

## 背景

`POST /api/v1/case/extract` 用于从用户上传的材料中提取案件信息（用于创建新案件）。

当前问题：API 接收 `materials: [{ ossFileId, name }]`，但只将文件名作为文本传给 LLM，AI 无法读取文件实际内容，导致无法正确提取。

## 目标

在提取前，确保所有文件材料已完成**识别 → 嵌入**流程，并将识别结果（文本内容）传给 LLM，同时处理材料过多超出模型上下文限制的情况。

## 限制条件

- 案件尚未创建，材料不关联任何案件（`case_materials` 表中不存在）
- 不引入案件相关机制
- 前端无改动
- 数据库无改动

## 方案设计

### 整体流程

```
extract API
  │
  ├─ 1. fileProcessService(ossFileIds, userId)
  │     ├─ 1.1 根据 ossFileId 查 OSS 文件 → 判断文件类型
  │     ├─ 1.2 查识别记录表 → 筛选已识别/已嵌入的
  │     ├─ 1.3 对未识别的触发识别
  │     │     图片 → 同步识别，直接返回内容
  │     │     PDF/音频 → 异步识别，轮询等待完成
  │     ├─ 1.4 对未嵌入的触发嵌入
  │     └─ 1.5 从识别记录表读取文本内容
  │
  └─ 2. token 检查 + 上下文构建
        │
        ├─ 阈值 = modelContextWindow * 0.7 (有值) 或 32000 (无值)
        ├─ token 计数: tiktoken (cl100k_base) 精确计算；摘要截断使用 tiktoken 估算（~50000 字符 ≈ 60000 tokens）
        │
        ├─ token < 阈值 → 全文直接拼入 prompt
        │
        └─ token ≥ 阈值 → 分批摘要 + 合并提取
              ├─ 按材料顺序分批，每批调用 LLM 生成摘要
              └─ 所有摘要合并 + user message → 最终提取 LLM
```

### 1. 新建文件

#### 1.1 `server/utils/tokenCounter.ts` — tiktoken 精确 token 计数

```typescript
import tiktoken from 'js-tiktoken'

/** 全局编码实例（cl100k_base，兼容 DeepSeek V3 / GPT-4 / Qwen 等） */
let encoding: Awaited<ReturnType<typeof tiktoken.init>> | null = null

/** 获取或初始化编码实例（懒加载，避免启动时开销） */
async function getEncoding() {
    if (!encoding) {
        encoding = await tiktoken.init()
    }
    return encoding
}

/**
 * 精确计算文本的 token 数
 * @param text 待计数的文本
 * @returns token 数量
 */
export async function countTokens(text: string): Promise<number> {
    const enc = await getEncoding()
    return enc.encode(text).length
}

/**
 * 同步版 token 计数（假设编码已初始化）
 * 用于 token 计数不频繁或可以接受预热的场景
 */
export function countTokensSync(text: string): number {
    if (!encoding) {
        // 未初始化时使用字符估算作为 fallback
        return estimateTokens(text)
    }
    return encoding.encode(text).length
}

/** 字符估算 fallback（中文约 2 字符/token，英文约 4 字符/token） */
function estimateTokens(text: string): number {
    if (!text) return 0
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const otherChars = text.length - chineseChars
    return Math.ceil(chineseChars / 2 + otherChars / 4)
}
```

#### 1.2 `server/services/material/fileProcess.service.ts` — 文件粒度识别→嵌入流水线

```typescript
import { CaseMaterialType, getMaterialTypeFromMime } from '#shared/types/case'
import { extractTextFromAsrResult } from './materialPipeline.service'
import { createImageConversionService } from './ocr.service'
import { convertPdfService, getDocRecognitionByOssFileIdService, pollTaskStatusService } from './mineru.service'
import { transcribeAudioService } from './asr.service'

/**
 * 文件处理上下文（提取阶段的材料容器，不关联案件）
 */
export interface FileProcessContext {
    ossFileId: number
    name: string
    /** 文件 MIME 类型 */
    fileType: string
    /** 材料类型：1=文本, 2=文档, 3=图片, 4=音频 */
    materialType: CaseMaterialType
    /** 识别状态 */
    recognitionStatus: 'idle' | 'processing' | 'success' | 'failed'
    /** 识别内容 */
    content?: string
    /** 错误信息 */
    error?: string
}

/**
 * 处理 OSS 文件的识别和嵌入（不关联案件）
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
    const [docRecords, imgRecords, asrRecords, textRecords] = await Promise.all([
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
        // textRecords 按 materialId 查询，本阶段不需要（提取阶段无 CASE_CONTENT）
        Promise.resolve([]),
    ])

    // 3. 构建文件上下文，逐个处理
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

        const materialType = inferMaterialType(ossFile.fileType)
        const existingContent = findExistingContent(
            ossFileId, materialType, docRecords, imgRecords, asrRecords
        )

        if (existingContent) {
            // 已识别，直接使用
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

        // 未识别，触发识别
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

    // 4. 过滤已成功识别的文件（用于后续嵌入触发）
    const succeeded = results.filter(r => r.recognitionStatus === 'success' && r.content)

    // 5. 嵌入将在案件创建后处理（当前阶段文件未关联案件，无法触发嵌入）
    if (succeeded.length > 0) {
        logEmbeddingSkipped(succeeded, userId).catch(() => {})
    }

    return results
}

/**
 * 根据文件 MIME 类型推断材料类型
 *
 * 复用 shared/types/case.ts 中的 getMaterialTypeFromMime，
 * 前后端共用同一映射规则，确保一致性。
 */
function inferMaterialType(fileType: string | null): CaseMaterialType {
    return getMaterialTypeFromMime(fileType)
}

/**
 * 查找已有识别内容
 */
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
 * 统一等待识别完成（适用于异步识别类型）
 *
 * 两个底层服务均已内置后台轮询机制：
 * - convertPdfService 内部调用 startTaskPollingService
 * - transcribeAudioService 内部调用 startAsrTaskPollingService
 *
 * 当前函数仅查询 DB 状态，不重复启动轮询。
 *
 * @param taskId 任务 ID（从 submitResult.task.taskId 获取）
 * @param type 识别类型
 * @param ossFileId OSS 文件 ID
 * @returns 识别完成后的文本内容
 * @throws 识别超时
 */
async function waitForRecognitionComplete(
    taskId: string,
    type: 'doc' | 'audio',
    ossFileId: number,
): Promise<string> {
    const MAX_WAIT_MS = 5 * 60 * 1000
    const INTERVAL_MS = type === 'doc' ? 5000 : 3000
    const startTime = Date.now()

    while (Date.now() - startTime < MAX_WAIT_MS) {
        await new Promise(resolve => setTimeout(resolve, INTERVAL_MS))

        if (type === 'doc') {
            // MinerU：使用已导出的 pollTaskStatusService
            const record = await getDocRecognitionByOssFileIdService(ossFileId)
            if (record?.markdownContent) return record.markdownContent
        } else {
            // ASR：直接查询 DB
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
 * 图片同步返回，PDF/音频异步轮询
 */
async function recognizeFile(
    ossFileId: number,
    materialType: CaseMaterialType,
    userId: number,
): Promise<string> {
    switch (materialType) {
        case CaseMaterialType.IMAGE: {
            // 图片识别为同步处理
            const result = await createImageConversionService(ossFileId, userId)
            if (!result.success) throw new Error(result.error || '图片识别失败')
            return result.record?.markdownContent ?? ''
        }
        case CaseMaterialType.AUDIO: {
            // 音频识别为异步处理，提交后等待完成
            const result = await transcribeAudioService(ossFileId, userId)
            if (!result.success) throw new Error(result.error || '音频识别失败')
            // 内部已启动后台轮询，当前函数仅等待 DB 状态变化
            if (result.task?.taskId && result.task.taskId !== 'existing') {
                return await waitForRecognitionComplete(result.task.taskId, 'audio', ossFileId)
            }
            // 兜底：直接查 DB
            const record = await prisma.asrRecords.findFirst({
                where: { ossFileId, status: 2, deletedAt: null },
                select: { summary: true, result: true },
            })
            const content = record?.summary || extractTextFromAsrResult(record?.result)
            if (content) return content
            throw new Error('音频识别结果为空')
        }
        default: {
            // 文档：PDF 等 MinerU 处理，异步
            const result = await convertPdfService(ossFileId, userId)
            if (!result.success) throw new Error(result.error || '文档识别失败')
            if (result.task?.taskId && result.task.taskId !== 'existing') {
                return await waitForRecognitionComplete(result.task.taskId, 'doc', ossFileId)
            }
            // 兜底：直接查 DB
            const record = await getDocRecognitionByOssFileIdService(ossFileId)
            if (record?.markdownContent) return record.markdownContent
            throw new Error('文档识别结果为空')
        }
    }
}

/**
 * 嵌入将在案件创建后处理（当前阶段文件未关联案件，无法触发嵌入）
 *
 * 注：此函数为占位符，待案件创建后由 normal_flow 处理嵌入。
 * 不执行实际嵌入操作，避免与案件流程耦合。
 */
async function logEmbeddingSkipped(
    files: FileProcessContext[],
    _userId: number,
): Promise<void> {
    logger.info('文件识别完成，嵌入将由案件创建后的 normal_flow 处理', {
        ossFileIds: files.map(f => f.ossFileId),
    })
}
```

### 2. 修改 `server/api/v1/case/extract.post.ts`

```typescript
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

    // 4. 创建模型实例（全文和摘要模式均复用同一模型）
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

    // 6. 构建系统提示词（不含材料内容，待动态填充）
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
            const failedNames = failed.map(f => `${f.name}（识别失败: ${f.error}）`).join('、')
            logger.warn(`部分材料识别失败: ${failedNames}`)
        }
    }

    // 10. 构建完整系统提示词
    const systemWithContext = systemPrompt + materialContext + caseTypeConstraint

    // 11. 检查 token 是否超限
    const totalTokens = await countTokens(systemWithContext + message)

    let extractResult: any

    if (totalTokens < tokenThreshold) {
        // 11a. 未超限：直接使用全文提取
        extractResult = await doExtract(
            model, systemWithContext, message, nodeConfig.outputSchema
        )
    } else {
        // 11b. 超限：分批摘要 + 合并提取（内部完成最终提取）
        logger.info('材料上下文超过 token 阈值，启用分批摘要模式', {
            totalTokens,
            tokenThreshold,
        })
        extractResult = await summarizeAndExtract(
            fileContexts.filter(f => f.recognitionStatus === 'success' && f.content),
            message,
            systemPrompt,
            caseTypeConstraint,
            nodeConfig,
            activeApiKey,
        )
    }

    // 12. 返回结果（附带材料元数据，供前端展示识别状态）
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

/**
 * 构建材料上下文（全文模式）
 */
function buildMaterialContext(fileContexts: FileProcessContext[]): string {
    const header = '\n\n## 用户上传的材料内容\n'
    const body = fileContexts
        .map(f => `### ${f.name}\n${f.content || '[无内容]'}`)
        .join('\n\n')
    return header + body
}

/**
 * 执行案件信息提取
 *
 * @param model LLM 模型实例
 * @param systemWithContext 完整的系统提示词（包含材料内容）
 * @param userMessage 用户消息
 * @param outputSchema 节点配置的结构化输出 schema（可选）
 */
async function doExtract(
    model: any,
    systemWithContext: string,
    userMessage: string,
    outputSchema: Record<string, unknown> | null,
) {
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

/**
 * 分批摘要 + 合并提取（超限模式）
 *
 * 在函数内部完成：生成摘要 → 构建摘要上下文 → 最终提取
 * 直接返回提取结果，不返回中间字符串
 *
 * @param fileContexts 已成功识别的文件上下文
 * @param userMessage 用户原始消息
 * @param systemPrompt 原始系统提示词（不含材料内容）
 * @param caseTypeConstraint 案件类型约束
 * @param nodeConfig 节点配置
 * @param activeApiKey API 密钥
 */
async function summarizeAndExtract(
    fileContexts: any[],
    userMessage: string,
    systemPrompt: string,
    caseTypeConstraint: string,
    nodeConfig: any,
    activeApiKey: any,
): Promise<{ extractedInfo: any; message: string | null }> {
    // 1. 创建摘要模型
    const summaryModel = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0,
        streaming: false,
    })

    const summaryPromptTemplate = `请仔细阅读以下材料，生成 300-500 字的摘要，保留所有关键信息：

材料名称：{name}

材料内容：
{content}`

    // 2. 并行生成各文件摘要
    const summaries: string[] = []
    for (const file of fileContexts) {
        if (!file.content) continue
        try {
            // 内容过长时按 tiktoken 估算截断（约 50000 字符对应 ~60000 tokens）
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

    // 3. 构建摘要上下文
    const summaryContext = '\n\n## 材料摘要\n' + summaries.join('\n\n')

    // 4. 构建最终系统提示词（摘要替换全文）
    const finalSystemPrompt = systemPrompt + summaryContext + caseTypeConstraint

    // 5. 执行最终提取
    const extractModel = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0,
        streaming: false,
    })

    return await doExtract(extractModel, finalSystemPrompt, userMessage, nodeConfig.outputSchema)
}
```

### 3. 改动说明

| 文件 | 改动 |
|------|------|
| `server/services/material/materialPipeline.service.ts` | **改动**：将 `extractTextFromAsrResult` 从私有函数改为 `export`，供其他模块复用 |
| `server/utils/tokenCounter.ts` | **新建**，tiktoken 精确 token 计数。**注**：现有的 `estimateTokens`（`materialPipeline.service.ts`）为字符估算 fallback，两套并存；后续可统一。 |
| `server/services/material/fileProcess.service.ts` | **新建**，文件粒度识别→嵌入流水线。**注**：嵌入依赖 `case_materials.materialId`，当前阶段文件未关联案件，嵌入由案件创建后的 normal_flow 处理。复用 `extractTextFromAsrResult`（从 materialPipeline 导出）。 |
| `server/api/v1/case/extract.post.ts` | 接入 fileProcessService + tiktoken 计数 + 分批摘要 + 材料元数据响应 |

## 待确认事项

### 1. 音频/文档识别超时处理

当前轮询超时设置为 5 分钟（`MAX_WAIT_MS = 5 * 60 * 1000`），对于大型 PDF 或长音频可能不够。建议增加重试机制或增大超时时间。

**当前方案**：超时则抛出错误，用户感知到"识别超时"，可重试。

## 测试计划

1. **单元测试**：
   - `tokenCounter.ts`: 验证 tiktoken 计数准确性
   - `fileProcess.service.ts`: Mock 各识别服务，测试已识别/未识别/识别失败场景

2. **集成测试**：
   - 使用真实小文件测试提取流程（token 未超限路径）
   - 使用大量/大文件测试分批摘要流程（token 超限路径）

3. **手动测试**：
   - 单个 PDF 文件提取
   - 多个文件（图片+文档）混合提取
   - 音频文件提取（识别超时场景）
