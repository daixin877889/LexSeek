/**
 * 材料摘要生成服务
 *
 * 当材料上下文超过 token 阈值需要切换到 summary 模式时，
 * 为缺少 summary 的材料调用 LLM 生成摘要并缓存到 caseMaterials.summary
 */

import { getValidNodeConfig } from '../node/node.service'
import { createChatModel } from '../node/chatModelFactory'

/** 摘要生成使用的节点名称 */
const SUMMARIZER_NODE_NAME = 'material_summarizer'

/**
 * 为缺少 summary 的材料批量生成摘要并缓存
 *
 * @param materials 需要生成摘要的材料列表（含 id 和 name）
 * @param contentMap 材料 ID → 完整内容的映射
 * @returns 材料 ID → 生成的摘要映射
 */
export async function generateAndCacheSummaries(
    materials: Array<{ id: number; name: string }>,
    contentMap: Map<number, string>,
): Promise<Map<number, string>> {
    const summaryMap = new Map<number, string>()

    if (materials.length === 0) return summaryMap

    // 获取摘要模型配置
    let model: any
    let systemPrompt = ''
    try {
        const nodeConfig = await getValidNodeConfig(SUMMARIZER_NODE_NAME)
        const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)
        if (!activeApiKey) {
            logger.warn('material_summarizer 节点无可用 API 密钥，跳过摘要生成')
            return summaryMap
        }
        model = createChatModel({
            sdkType: nodeConfig.modelSdkType,
            modelName: nodeConfig.modelName,
            apiKey: activeApiKey.apiKey,
            baseUrl: nodeConfig.modelProviderBaseUrl,
            temperature: 0,
            streaming: false,
        })

        // 从节点配置获取系统提示词
        systemPrompt = nodeConfig.prompts?.find(
            (p: any) => p.type === 'system' && p.status === 1,
        )?.content ?? ''
        if (!systemPrompt) {
            logger.warn('material_summarizer 节点未配置系统提示词，跳过摘要生成')
            return summaryMap
        }
    } catch (error) {
        logger.warn('获取 material_summarizer 节点失败，跳过摘要生成', { error })
        return summaryMap
    }

    // 并行生成摘要
    const tasks = materials.map(async (m) => {
        const content = contentMap.get(m.id)
        if (!content) return

        try {
            const summary = await generateSingleSummary(model, systemPrompt, m.name, content)
            if (summary) {
                summaryMap.set(m.id, summary)
                // 缓存到 DB
                await prisma.caseMaterials.update({
                    where: { id: m.id },
                    data: { summary },
                })
            }
        } catch (error) {
            logger.warn('材料摘要生成失败', { materialId: m.id, name: m.name, error })
        }
    })

    await Promise.all(tasks)

    logger.info('材料摘要生成完成', {
        total: materials.length,
        generated: summaryMap.size,
    })

    return summaryMap
}

/** 为单个材料生成摘要 */
async function generateSingleSummary(
    model: any,
    systemPrompt: string,
    materialName: string,
    content: string,
): Promise<string | null> {
    // 截断过长内容避免超出摘要模型上下文
    const maxContentChars = 50000
    const truncatedContent = content.length > maxContentChars
        ? content.slice(0, maxContentChars) + '\n\n[内容过长已截断]'
        : content

    const messages: any[] = [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: `材料名称：${materialName}\n\n材料内容：\n${truncatedContent}` },
    ]

    const response = await model.invoke(messages)

    const summary = typeof response.content === 'string'
        ? response.content
        : Array.isArray(response.content)
            ? response.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : null

    return summary?.trim() || null
}
