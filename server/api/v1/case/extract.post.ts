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
import { generateSummaryService } from '~~/server/services/ai/summaryService'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { processFileMaterials } from '~~/server/services/material/fileProcess.service'
import type { FileProcessContext } from '~~/server/services/material/fileProcess.service'
import { countTokens } from '~~/server/utils/tokenCounter'
import { getEnabledCaseTypesService } from '~~/server/services/case/caseType.service'

const EXTRACT_NODE_NAME = 'extractInfo'

/** 分批摘要时单文件最大字符数（约 50000 字符 ≈ 60000 tokens） */
const MAX_CONTENT_CHARS_FOR_SUMMARY = 50000

const schema = z.object({
    message: z.string().min(1),
    materials: z.array(z.object({
        ossFileId: z.number().int().positive(),
        name: z.string(),
    })).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const body = await readBody(event)
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数校验失败')
    }

    const { message, materials } = parsed.data

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

    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0,
        streaming: false,
    })

    // token 阈值 = 上下文窗口的 70%，兜底 32000
    const tokenThreshold = nodeConfig.modelContextWindow
        ? Math.floor(nodeConfig.modelContextWindow * 0.7)
        : 32000

    const systemPromptConfig = nodeConfig.prompts?.find(
        (p: { type: string; status: number }) => p.type === 'system' && p.status === 1,
    )
    const systemPrompt = systemPromptConfig?.content ?? ''

    const enabledCaseTypes = await getEnabledCaseTypesService()
    const caseTypeNames = enabledCaseTypes.map(ct => ct.name)
    const caseTypeConstraint = `\n\n## 案件类型约束\n案件类型（caseType）必须从以下列表中选择，不得自行创造：\n${caseTypeNames.map(n => `- ${n}`).join('\n')}\n如果无法确定案件类型，请选择最接近的一个。`

    // 材料处理：识别 → 读取内容
    let fileContexts: FileProcessContext[] = []
    if (materials?.length) {
        const ossFileIds = materials.map(m => m.ossFileId)
        fileContexts = await processFileMaterials(ossFileIds, user.id)
    }

    // 一次性分组，后续复用
    const succeeded = fileContexts.filter(f => f.recognitionStatus === 'success' && f.content)
    const failed = fileContexts.filter(f => f.recognitionStatus === 'failed')

    if (failed.length > 0) {
        const failedNames = failed.map(f => `${f.name}（${f.error}）`).join('、')
        logger.warn(`部分材料识别失败: ${failedNames}`)
    }

    const materialContext = succeeded.length > 0 ? buildMaterialContext(succeeded) : ''
    const systemWithContext = systemPrompt + materialContext + caseTypeConstraint

    const totalTokens = await countTokens(systemWithContext + message)

    let extractResult: { extractedInfo: any; message: string | null }

    try {
        if (totalTokens < tokenThreshold) {
            extractResult = await doExtract(model, systemWithContext, message, nodeConfig.outputSchema)
        } else {
            logger.info('材料上下文超过 token 阈值，启用分批摘要模式', {
                totalTokens,
                tokenThreshold,
            })
            extractResult = await summarizeAndExtract(
                model,
                succeeded,
                message,
                systemPrompt,
                caseTypeConstraint,
                nodeConfig,
            )
        }
    } catch (err: any) {
        logger.error('信息提取失败:', err)
        return resError(event, 500, '信息提取失败，请重试')
    }

    const failedMaterials = failed.map(f => ({ name: f.name, error: f.error }))

    return resSuccess(event, '提取成功', {
        message: nodeConfig.outputSchema
            ? '已为您提取案件信息，请确认以下内容：'
            : extractResult.message,
        extractedInfo: extractResult.extractedInfo,
        materialMeta: {
            total: fileContexts.length,
            succeeded: succeeded.length,
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
    // 并行生成各文件摘要
    const summaryResults = await Promise.allSettled(
        fileContexts
            .filter(f => f.content)
            .map(file => generateFileSummary(file)),
    )

    const filesWithContent = fileContexts.filter(f => f.content)
    const summaries = summaryResults.map((r, i) => {
        const file = filesWithContent[i]!
        if (r.status === 'fulfilled') return r.value
        logger.warn(`材料摘要生成失败: ${file.name}`, { error: (r.reason as Error)?.message })
        return `【${file.name}摘要】\n[摘要生成失败，原文预览: ${file.content!.slice(0, 200)}...]`
    })

    const summaryContext = '\n\n## 材料摘要\n' + summaries.join('\n\n')
    const finalSystemPrompt = systemPrompt + summaryContext + caseTypeConstraint

    return await doExtract(model, finalSystemPrompt, userMessage, nodeConfig.outputSchema)
}

/** 生成单个文件的摘要 */
async function generateFileSummary(file: FileProcessContext): Promise<string> {
    const truncated = file.content!.length > MAX_CONTENT_CHARS_FOR_SUMMARY
        ? file.content!.slice(0, MAX_CONTENT_CHARS_FOR_SUMMARY) + '\n\n[内容过长已截断]'
        : file.content!
    try {
        const config = await getValidNodeConfig('material_summarizer', '材料摘要')
        const apiKey = config.modelApiKeys.find(k => k.status === 1)?.apiKey
        const systemPrompt = config.prompts.find(p => p.type === 'system' && p.status === 1)?.content
        if (!apiKey || !systemPrompt) {
            return `[摘要生成失败：material_summarizer 节点未配置]`
        }
        const summaryModel = createChatModel({
            sdkType: config.modelSdkType,
            modelName: config.modelName,
            apiKey,
            baseUrl: config.modelProviderBaseUrl,
            temperature: 0,
            streaming: false,
        })
        const summary = await generateSummaryService(
            summaryModel,
            `材料名称：${file.name}\n\n材料内容：\n${truncated}`,
            { maxChars: 500, systemPrompt },
        )
        return `【${file.name}摘要】\n${summary.trim()}`
    } catch (err) {
        logger.warn('材料摘要生成失败', { name: file.name, error: err })
        return `[摘要生成失败，原文预览: ${truncated.slice(0, 200)}...]`
    }
}
