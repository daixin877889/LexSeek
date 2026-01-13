/**
 * 材料向量化服务
 *
 * 提供案件材料的向量化功能，包括内容分块、向量化、存储和检索
 * 复用已有的向量存储服务（vectorStore.service.ts）
 * Requirements: 3.14, 3.15, 3.16
 */

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Document } from '@langchain/core/documents'
import { v7 as uuidv7 } from 'uuid'
import dayjs from 'dayjs'
import {
    addDocumentsToVectorStore,
    similaritySearchWithScore,
    getPool,
    type VectorStoreConfig,
} from '~~/server/services/legal/vectorStore.service'
import { MaterialType } from '#shared/types/material'

/** 材料向量存储配置 */
export const caseMaterialVectorConfig: VectorStoreConfig = {
    tableName: 'case_material_embeddings',
    vectorColumnName: 'embedding',
    contentColumnName: 'text',
    metadataColumnName: 'metadata',
}

/** 材料向量化元数据（旧版，用于案件材料） */
export interface MaterialEmbeddingMetadata {
    /** 用户 ID */
    userId: number
    /** 案件 ID */
    caseId: number
    /** 材料 ID */
    materialId: number
    /** 会话 ID */
    sessionId: string
    /** 材料名称 */
    materialName: string
    /** 材料类型 */
    materialType: number
    /** 分块索引 */
    chunkIndex: number
    /** 最后嵌入时间 */
    lastEmbeddingAt: string
}

/**
 * 通用内容嵌入元数据（新版）
 * 支持多种来源类型：doc（文档）、audio（音频）、image（图片）等
 */
export interface ContentEmbeddingMetadata {
    /** 来源类型：doc=文档, audio=音频, image=图片 */
    source: 'doc' | 'audio' | 'image'
    /** 用户 ID */
    userId: number
    /** 来源 ID（如 ossFileId） */
    sourceId: number
    /** 最后嵌入时间 */
    last_embedding_at: string
    /** 分块索引 */
    chunkIndex: number
}

/** 材料向量化输入 */
export interface EmbedMaterialInput {
    /** 材料内容 */
    content: string
    /** 用户 ID */
    userId: number
    /** 案件 ID */
    caseId: number
    /** 材料 ID */
    materialId: number
    /** 会话 ID */
    sessionId: string
    /** 材料名称 */
    materialName: string
    /** 材料类型 */
    materialType: MaterialType
}

/** 材料向量化结果 */
export interface EmbedMaterialResult {
    /** 生成的向量 ID 列表 */
    ids: string[]
    /** 最后嵌入时间 */
    lastEmbeddingAt: string
    /** 分块数量 */
    chunkCount: number
}

/** 材料检索结果 */
export interface MaterialSearchResult {
    /** 内容片段 */
    content: string
    /** 材料 ID */
    materialId: number
    /** 材料名称 */
    materialName: string
    /** 相似度分数 */
    score: number
    /** 分块索引 */
    chunkIndex: number
}

/** 文本分块配置 */
interface TextSplitterConfig {
    /** 分块大小 */
    chunkSize: number
    /** 分块重叠 */
    chunkOverlap: number
}

/** 默认分块配置 */
const defaultSplitterConfig: TextSplitterConfig = {
    chunkSize: 1000,
    chunkOverlap: 100,
}

/**
 * 创建文本分割器
 * 使用 Markdown 语言感知的递归字符分割器
 */
function createTextSplitter(config: TextSplitterConfig = defaultSplitterConfig): RecursiveCharacterTextSplitter {
    return RecursiveCharacterTextSplitter.fromLanguage('markdown', {
        chunkSize: config.chunkSize,
        chunkOverlap: config.chunkOverlap,
    })
}

/**
 * 将材料内容分块
 * @param content 材料内容
 * @param metadata 元数据
 * @param config 分块配置
 * @returns 分块后的文档列表和 ID 列表
 */
async function splitMaterialContent(
    content: string,
    metadata: Omit<MaterialEmbeddingMetadata, 'chunkIndex'>,
    config: TextSplitterConfig = defaultSplitterConfig
): Promise<{ documents: Document[]; ids: string[] }> {
    const splitter = createTextSplitter(config)

    // 分割文本
    const texts = await splitter.splitText(content)

    // 创建文档和 ID
    const documents: Document[] = []
    const ids: string[] = []

    texts.forEach((text, index) => {
        const docMetadata: MaterialEmbeddingMetadata = {
            ...metadata,
            chunkIndex: index,
        }

        documents.push(
            new Document({
                pageContent: text,
                metadata: docMetadata,
            })
        )

        ids.push(uuidv7())
    })

    return { documents, ids }
}

/**
 * 删除材料的现有向量数据
 * @param materialId 材料 ID
 * @returns 删除的记录数
 */
export async function deleteMaterialEmbeddings(materialId: number): Promise<number> {
    const pool = getPool()
    const query = `
        DELETE FROM ${caseMaterialVectorConfig.tableName} 
        WHERE metadata->>'materialId' = $1
        RETURNING id
    `
    const result = await pool.query(query, [materialId.toString()])
    const count = result.rowCount || 0

    if (count > 0) {
        logger.info(`已删除材料 ${materialId} 的 ${count} 条向量记录`)
    }

    return count
}

/**
 * 删除案件的所有材料向量数据
 * @param caseId 案件 ID
 * @returns 删除的记录数
 */
export async function deleteCaseMaterialEmbeddings(caseId: number): Promise<number> {
    const pool = getPool()
    const query = `
        DELETE FROM ${caseMaterialVectorConfig.tableName} 
        WHERE metadata->>'caseId' = $1
        RETURNING id
    `
    const result = await pool.query(query, [caseId.toString()])
    const count = result.rowCount || 0

    if (count > 0) {
        logger.info(`已删除案件 ${caseId} 的 ${count} 条向量记录`)
    }

    return count
}

/**
 * 向量化材料内容
 * Requirements: 3.14, 3.15, 3.16
 *
 * @param input 材料向量化输入
 * @param config 分块配置（可选）
 * @returns 向量化结果
 */
export async function embedMaterialService(
    input: EmbedMaterialInput,
    config: TextSplitterConfig = defaultSplitterConfig
): Promise<EmbedMaterialResult> {
    const { content, userId, caseId, materialId, sessionId, materialName, materialType } = input

    logger.info('开始向量化材料', {
        materialId,
        caseId,
        userId,
        contentLength: content.length,
    })

    try {
        // 删除该材料的现有向量数据（避免重复）
        await deleteMaterialEmbeddings(materialId)

        // 记录嵌入时间
        const lastEmbeddingAt = dayjs().format('YYYY-MM-DDTHH:mm:ss+08:00')

        // 准备元数据
        const metadata: Omit<MaterialEmbeddingMetadata, 'chunkIndex'> = {
            userId,
            caseId,
            materialId,
            sessionId,
            materialName,
            materialType,
            lastEmbeddingAt,
        }

        // 分块
        const { documents, ids } = await splitMaterialContent(content, metadata, config)

        if (documents.length === 0) {
            logger.warn(`材料 ${materialId} 内容为空，跳过向量化`)
            return {
                ids: [],
                lastEmbeddingAt,
                chunkCount: 0,
            }
        }

        // 添加到向量存储
        await addDocumentsToVectorStore(documents, ids, caseMaterialVectorConfig)

        logger.info(`材料 ${materialId} 向量化完成`, {
            chunkCount: documents.length,
            ids,
        })

        return {
            ids,
            lastEmbeddingAt,
            chunkCount: documents.length,
        }
    } catch (error) {
        logger.error(`材料 ${materialId} 向量化失败:`, error)
        throw error
    }
}

/**
 * 批量向量化材料
 * @param inputs 材料向量化输入列表
 * @param config 分块配置（可选）
 * @returns 向量化结果列表
 */
export async function embedMaterialsBatchService(
    inputs: EmbedMaterialInput[],
    config: TextSplitterConfig = defaultSplitterConfig
): Promise<EmbedMaterialResult[]> {
    const results: EmbedMaterialResult[] = []

    for (const input of inputs) {
        try {
            const result = await embedMaterialService(input, config)
            results.push(result)
        } catch (error) {
            logger.error(`批量向量化材料 ${input.materialId} 失败:`, error)
            // 继续处理其他材料
            results.push({
                ids: [],
                lastEmbeddingAt: dayjs().format('YYYY-MM-DDTHH:mm:ss+08:00'),
                chunkCount: 0,
            })
        }
    }

    return results
}

/**
 * 检索案件材料
 * 仅在指定用户和案件范围内进行向量相似度搜索
 * Requirements: 12.1.1-12.1.4
 *
 * @param userId 用户 ID（必传，确保用户只能检索自己的材料）
 * @param caseId 案件 ID
 * @param query 查询文本
 * @param k 返回结果数量（默认 5）
 * @returns 检索结果列表
 */
export async function searchCaseMaterialsService(
    userId: number,
    caseId: number,
    query: string,
    k: number = 5
): Promise<MaterialSearchResult[]> {
    logger.info('检索案件材料', { userId, caseId, query, k })

    try {
        // 使用 userId 和 caseId 作为过滤条件，确保用户只能检索自己的材料
        // PGVectorStore 的 filter 会将 metadata 中的值与 filter 值进行比较
        const filter = { userId, caseId }

        // 执行向量相似度搜索
        const results = await similaritySearchWithScore(query, k, filter, caseMaterialVectorConfig)

        // 转换结果格式
        const searchResults: MaterialSearchResult[] = results.map(([doc, score]: [Document, number]) => {
            const metadata = doc.metadata as MaterialEmbeddingMetadata
            return {
                content: doc.pageContent,
                materialId: metadata.materialId,
                materialName: metadata.materialName,
                score,
                chunkIndex: metadata.chunkIndex,
            }
        })

        logger.info(`案件 ${caseId} 材料检索完成`, {
            resultCount: searchResults.length,
        })

        return searchResults
    } catch (error) {
        logger.error(`案件 ${caseId} 材料检索失败:`, error)
        throw error
    }
}

/**
 * 获取材料的向量 ID 列表
 * @param materialId 材料 ID
 * @returns 向量 ID 列表
 */
export async function getMaterialEmbeddingIds(materialId: number): Promise<string[]> {
    const pool = getPool()
    const query = `
        SELECT id FROM ${caseMaterialVectorConfig.tableName} 
        WHERE metadata->>'materialId' = $1
        ORDER BY (metadata->>'chunkIndex')::int ASC
    `
    const result = await pool.query(query, [materialId.toString()])
    return result.rows.map((row: { id: string }) => row.id)
}

/**
 * 获取案件的所有材料向量统计
 * @param caseId 案件 ID
 * @returns 向量统计信息
 */
export async function getCaseMaterialEmbeddingStats(caseId: number): Promise<{
    totalChunks: number
    materialCount: number
    materials: Array<{ materialId: number; materialName: string; chunkCount: number }>
}> {
    const pool = getPool()

    // 获取总分块数
    const totalQuery = `
        SELECT COUNT(*) as total FROM ${caseMaterialVectorConfig.tableName} 
        WHERE metadata->>'caseId' = $1
    `
    const totalResult = await pool.query(totalQuery, [caseId.toString()])
    const totalChunks = parseInt(totalResult.rows[0]?.total || '0', 10)

    // 获取每个材料的分块统计
    const statsQuery = `
        SELECT 
            metadata->>'materialId' as material_id,
            metadata->>'materialName' as material_name,
            COUNT(*) as chunk_count
        FROM ${caseMaterialVectorConfig.tableName} 
        WHERE metadata->>'caseId' = $1
        GROUP BY metadata->>'materialId', metadata->>'materialName'
        ORDER BY (metadata->>'materialId')::int ASC
    `
    const statsResult = await pool.query(statsQuery, [caseId.toString()])

    const materials = statsResult.rows.map((row: { material_id: string; material_name: string; chunk_count: string }) => ({
        materialId: parseInt(row.material_id, 10),
        materialName: row.material_name,
        chunkCount: parseInt(row.chunk_count, 10),
    }))

    return {
        totalChunks,
        materialCount: materials.length,
        materials,
    }
}

/**
 * 检查材料是否已向量化
 * @param materialId 材料 ID
 * @returns 是否已向量化
 */
export async function isMaterialEmbedded(materialId: number): Promise<boolean> {
    const pool = getPool()
    const query = `
        SELECT EXISTS(
            SELECT 1 FROM ${caseMaterialVectorConfig.tableName} 
            WHERE metadata->>'materialId' = $1
            LIMIT 1
        ) as exists
    `
    const result = await pool.query(query, [materialId.toString()])
    return result.rows[0]?.exists === true
}


// ============================================
// 通用内容嵌入服务（新版，支持多种来源类型）
// ============================================

/** 文档嵌入输入参数 */
export interface EmbedDocumentInput {
    /** 文档内容（Markdown 格式） */
    content: string
    /** 用户 ID */
    userId: number
    /** OSS 文件 ID */
    ossFileId: number
}

/** 文档嵌入结果 */
export interface EmbedDocumentResult {
    /** 生成的向量 ID 列表 */
    ids: string[]
    /** 最后嵌入时间 */
    lastEmbeddingAt: string
    /** 分块数量 */
    chunkCount: number
}

/**
 * 删除文档的现有向量数据
 * @param source 来源类型
 * @param sourceId 来源 ID（如 ossFileId）
 * @returns 删除的记录数
 */
export async function deleteContentEmbeddings(
    source: 'doc' | 'audio' | 'image',
    sourceId: number
): Promise<number> {
    const pool = getPool()
    const query = `
        DELETE FROM ${caseMaterialVectorConfig.tableName} 
        WHERE metadata->>'source' = $1 AND metadata->>'sourceId' = $2
        RETURNING id
    `
    const result = await pool.query(query, [source, sourceId.toString()])
    const count = result.rowCount || 0

    if (count > 0) {
        logger.info(`已删除 ${source}:${sourceId} 的 ${count} 条向量记录`)
    }

    return count
}

/**
 * 将文档内容分块（用于通用内容嵌入）
 * @param content 文档内容
 * @param metadata 元数据（不含 chunkIndex）
 * @param config 分块配置
 * @returns 分块后的文档列表和 ID 列表
 */
async function splitDocumentContent(
    content: string,
    metadata: Omit<ContentEmbeddingMetadata, 'chunkIndex'>,
    config: TextSplitterConfig = defaultSplitterConfig
): Promise<{ documents: Document[]; ids: string[] }> {
    const splitter = createTextSplitter(config)

    // 分割文本
    const texts = await splitter.splitText(content)

    // 创建文档和 ID
    const documents: Document[] = []
    const ids: string[] = []

    texts.forEach((text, index) => {
        const docMetadata: ContentEmbeddingMetadata = {
            ...metadata,
            chunkIndex: index,
        }

        documents.push(
            new Document({
                pageContent: text,
                metadata: docMetadata,
            })
        )

        ids.push(uuidv7())
    })

    return { documents, ids }
}

/**
 * 向量化文档内容（新版，不需要 caseId 和 sessionId）
 *
 * 元数据结构：
 * {
 *   "source": "doc",
 *   "userId": 137,
 *   "sourceId": 431,  // ossFileId
 *   "last_embedding_at": "2025-12-16T22:47:29+08:00",
 *   "chunkIndex": 0
 * }
 *
 * @param input 文档嵌入输入
 * @param config 分块配置（可选）
 * @returns 嵌入结果
 */
export async function embedDocumentService(
    input: EmbedDocumentInput,
    config: TextSplitterConfig = defaultSplitterConfig
): Promise<EmbedDocumentResult> {
    const { content, userId, ossFileId } = input

    logger.info('开始向量化文档', {
        ossFileId,
        userId,
        contentLength: content.length,
    })

    try {
        // 删除该文档的现有向量数据（避免重复）
        await deleteContentEmbeddings('doc', ossFileId)

        // 记录嵌入时间
        const lastEmbeddingAt = dayjs().format('YYYY-MM-DDTHH:mm:ss+08:00')

        // 准备元数据
        const metadata: Omit<ContentEmbeddingMetadata, 'chunkIndex'> = {
            source: 'doc',
            userId,
            sourceId: ossFileId,
            last_embedding_at: lastEmbeddingAt,
        }

        // 分块
        const { documents, ids } = await splitDocumentContent(content, metadata, config)

        if (documents.length === 0) {
            logger.warn(`文档 ${ossFileId} 内容为空，跳过向量化`)
            return {
                ids: [],
                lastEmbeddingAt,
                chunkCount: 0,
            }
        }

        // 添加到向量存储
        await addDocumentsToVectorStore(documents, ids, caseMaterialVectorConfig)

        logger.info(`文档 ${ossFileId} 向量化完成`, {
            chunkCount: documents.length,
            ids,
        })

        return {
            ids,
            lastEmbeddingAt,
            chunkCount: documents.length,
        }
    } catch (error) {
        logger.error(`文档 ${ossFileId} 向量化失败:`, error)
        throw error
    }
}

/**
 * 检查文档是否已向量化
 * @param ossFileId OSS 文件 ID
 * @returns 是否已向量化
 */
export async function isDocumentEmbedded(ossFileId: number): Promise<boolean> {
    const pool = getPool()
    const query = `
        SELECT EXISTS(
            SELECT 1 FROM ${caseMaterialVectorConfig.tableName} 
            WHERE metadata->>'source' = 'doc' AND metadata->>'sourceId' = $1
            LIMIT 1
        ) as exists
    `
    const result = await pool.query(query, [ossFileId.toString()])
    return result.rows[0]?.exists === true
}

/**
 * 获取文档的向量 ID 列表
 * @param ossFileId OSS 文件 ID
 * @returns 向量 ID 列表
 */
export async function getDocumentEmbeddingIds(ossFileId: number): Promise<string[]> {
    const pool = getPool()
    const query = `
        SELECT id FROM ${caseMaterialVectorConfig.tableName} 
        WHERE metadata->>'source' = 'doc' AND metadata->>'sourceId' = $1
        ORDER BY (metadata->>'chunkIndex')::int ASC
    `
    const result = await pool.query(query, [ossFileId.toString()])
    return result.rows.map((row: { id: string }) => row.id)
}

/**
 * 检索用户的文档内容
 * @param userId 用户 ID
 * @param query 查询文本
 * @param k 返回结果数量（默认 5）
 * @returns 检索结果列表
 */
export async function searchUserDocumentsService(
    userId: number,
    query: string,
    k: number = 5
): Promise<Array<{
    content: string
    sourceId: number
    score: number
    chunkIndex: number
}>> {
    logger.info('检索用户文档', { userId, query, k })

    try {
        // 使用 userId 和 source 作为过滤条件
        const filter = { userId, source: 'doc' }

        // 执行向量相似度搜索
        const results = await similaritySearchWithScore(query, k, filter, caseMaterialVectorConfig)

        // 转换结果格式
        const searchResults = results.map(([doc, score]: [Document, number]) => {
            const metadata = doc.metadata as ContentEmbeddingMetadata
            return {
                content: doc.pageContent,
                sourceId: metadata.sourceId,
                score,
                chunkIndex: metadata.chunkIndex,
            }
        })

        logger.info(`用户 ${userId} 文档检索完成`, {
            resultCount: searchResults.length,
        })

        return searchResults
    } catch (error) {
        logger.error(`用户 ${userId} 文档检索失败:`, error)
        throw error
    }
}
