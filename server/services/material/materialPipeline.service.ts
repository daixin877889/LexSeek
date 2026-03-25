/**
 * 材料就绪保障 Pipeline
 *
 * 确保案件所有材料已完成识别和嵌入，供中间件和工具复用。
 * 只对未识别的触发识别，只对未嵌入的触发嵌入，避免重复处理。
 */
import { getMaterialsByCaseIdService, type MaterialWithFile } from './material.service'
import { batchCheckMaterialEmbeddedService, embedMaterialUnifiedService } from './materialEmbedding.service'
import { processMaterialService, batchCheckMaterialRecognizedService } from './materialProcess.service'

export interface MaterialFailedItem {
    materialId: number
    name: string
    error: string
}

export interface MaterialReadyResult {
    materials: MaterialWithFile[]
    totalMaterials: number
    alreadyEmbedded: number
    newlyProcessed: number
    embeddedMap: Map<number, boolean>
    failed: MaterialFailedItem[]
}

/** 从 Promise.allSettled 结果中收集失败项 */
function collectSettledFailures(
    results: PromiseSettledResult<void>[],
    materials: MaterialWithFile[],
): MaterialFailedItem[] {
    const failures: MaterialFailedItem[] = []
    for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
            const reason = (results[i] as PromiseRejectedResult).reason
            failures.push({
                materialId: materials[i].id,
                name: materials[i].name,
                error: reason instanceof Error ? reason.message : String(reason),
            })
        }
    }
    return failures
}

export async function ensureMaterialsReadyService(
    caseId: number,
    userId: number,
): Promise<MaterialReadyResult> {
    // 1. 获取全部材料
    const materials = await getMaterialsByCaseIdService(caseId)
    if (materials.length === 0) {
        return {
            materials: [],
            totalMaterials: 0,
            alreadyEmbedded: 0,
            newlyProcessed: 0,
            embeddedMap: new Map(),
            failed: [],
        }
    }

    const failed: MaterialFailedItem[] = []

    // 2. 识别阶段：检查识别状态，对未识别的触发识别
    const recognizedMap = await batchCheckMaterialRecognizedService(materials)
    const notRecognized = materials.filter(m => !recognizedMap.get(m.id))

    if (notRecognized.length > 0) {
        // 对于异步识别的材料（PDF via MinerU、音频 via ASR），
        // processMaterialService 可能返回 PROCESSING 状态，
        // 后续嵌入会因内容为空而失败，这是预期行为。
        // TODO: 大量材料时考虑添加并发限制（p-limit）
        const recognitionResults = await Promise.allSettled(
            notRecognized.map(material => processMaterialService(material.id, userId))
        )
        failed.push(...collectSettledFailures(recognitionResults, notRecognized))
    }

    // 3. 嵌入阶段：检查嵌入状态，对未嵌入的触发嵌入
    const ids = materials.map(m => m.id)
    const embeddedMap = await batchCheckMaterialEmbeddedService(ids)

    const alreadyEmbedded = materials.filter(m => embeddedMap.get(m.id)).length
    const notEmbedded = materials.filter(m => !embeddedMap.get(m.id))

    let newlyProcessed = 0

    if (notEmbedded.length > 0) {
        // 排除识别阶段已失败的材料（不需要再尝试嵌入）
        const failedIds = new Set(failed.map(f => f.materialId))
        const toEmbed = notEmbedded.filter(m => !failedIds.has(m.id))

        const embeddingResults = await Promise.allSettled(
            toEmbed.map(material => embedMaterialUnifiedService(material.id, userId))
        )

        const embeddingFailures = collectSettledFailures(embeddingResults, toEmbed)
        newlyProcessed = toEmbed.length - embeddingFailures.length
        failed.push(...embeddingFailures)
    }

    // 4. 获取最终嵌入状态
    const finalEmbeddedMap = notEmbedded.length > 0
        ? await batchCheckMaterialEmbeddedService(ids)
        : embeddedMap

    return {
        materials,
        totalMaterials: materials.length,
        alreadyEmbedded,
        newlyProcessed,
        embeddedMap: finalEmbeddedMap,
        failed,
    }
}
