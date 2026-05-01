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


/** 材料向量存储配置 */
export const caseMaterialVectorConfig: VectorStoreConfig = {
    tableName: 'case_material_embeddings',
    vectorColumnName: 'embedding',
    contentColumnName: 'text',
    metadataColumnName: 'metadata',
}

/**
 * 通用内容嵌入元数据（新版）
 * 支持多种来源类型：doc（文档）、audio（音频）、image（图片）、text（文本材料）
 */
export interface ContentEmbeddingMetadata {
    /** 来源类型：doc=文档, audio=音频, image=图片, text=文本材料 */
    source: 'doc' | 'audio' | 'image' | 'text'
    /** 用户 ID */
    userId: number
    /** 来源 ID（如 ossFileId 或 materialId） */
    sourceId: number
    /** 来源名称（原始文件名或材料名称） */
    sourceName: string
    /** 最后嵌入时间 */
    last_embedding_at: string
    /** 分块索引 */
    chunkIndex: number
}

/** 材料检索结果 */
export interface MaterialSearchResult {
    /** 内容片段 */
    content: string
    /** 来源 ID */
    sourceId: number
    /** 来源名称 */
    sourceName: string
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
    chunkSize: 1500,
    chunkOverlap: 200,
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
 * 批量删除多个材料的向量数据（单次 DELETE 替代 N 次 round-trip）
 */
export async function deleteMaterialsEmbeddings(materialIds: number[]): Promise<number> {
    if (materialIds.length === 0) return 0
    const pool = getPool()
    const query = `
        DELETE FROM ${caseMaterialVectorConfig.tableName}
        WHERE metadata->>'materialId' = ANY($1::text[])
        RETURNING id
    `
    const result = await pool.query(query, [materialIds.map(String)])
    const count = result.rowCount || 0
    if (count > 0) {
        logger.info(`已批量删除 ${materialIds.length} 个材料的 ${count} 条向量记录`)
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
    k: number = 5,
    sourceIds?: number[],
): Promise<MaterialSearchResult[]> {
    logger.info('检索案件材料', { userId, caseId, query, k, sourceIds })

    try {
        // 使用 userId 作为基础过滤条件，确保用户只能检索自己的材料
        // 支持 sourceIds 精确限定检索范围
        const filter: Record<string, any> = { userId }
        if (sourceIds && sourceIds.length > 0) {
            filter.sourceId = { in: sourceIds.map(String) }
        }

        // 执行向量相似度搜索
        const results = await similaritySearchWithScore(query, k, filter, caseMaterialVectorConfig)

        // 转换结果格式
        const searchResults: MaterialSearchResult[] = results.map(([doc, score]: [Document, number]) => {
            const metadata = doc.metadata as ContentEmbeddingMetadata
            return {
                content: doc.pageContent,
                sourceId: metadata.sourceId,
                sourceName: metadata.sourceName,
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
// 文本内容嵌入服务（用于 CASE_CONTENT 类型材料）
// ============================================

/** 文本嵌入输入参数 */
export interface EmbedTextInput {
    /** 文本内容 */
    content: string
    /** 用户 ID */
    userId: number
    /** 材料 ID（case_materials 表中的 ID） */
    materialId: number
    /** 材料名称 */
    materialName: string
}

/** 文本嵌入结果 */
export interface EmbedTextResult {
    /** 生成的向量 ID 列表 */
    ids: string[]
    /** 最后嵌入时间 */
    lastEmbeddingAt: string
    /** 分块数量 */
    chunkCount: number
}

/**
 * 向量化文本内容（用于 CASE_CONTENT 类型材料）
 *
 * 元数据结构：
 * {
 *   "source": "text",
 *   "userId": 137,
 *   "sourceId": 123,  // materialId（case_materials 表中的 ID）
 *   "sourceName": "案情描述",  // 材料名称
 *   "last_embedding_at": "2025-12-16T22:47:29+08:00",
 *   "chunkIndex": 0
 * }
 *
 * @param input 文本嵌入输入
 * @param config 分块配置（可选）
 * @returns 嵌入结果
 */
export async function embedTextService(
    input: EmbedTextInput,
    config: TextSplitterConfig = defaultSplitterConfig
): Promise<EmbedTextResult> {
    const { content, userId, materialId, materialName } = input

    logger.info('开始向量化文本材料', {
        materialId,
        userId,
        materialName,
        contentLength: content.length,
    })

    try {
        // 删除该文本材料的现有向量数据（避免重复）
        await deleteContentEmbeddings('text', materialId)

        // 记录嵌入时间
        const lastEmbeddingAt = dayjs().format('YYYY-MM-DDTHH:mm:ss+08:00')

        // 准备元数据
        const metadata: Omit<ContentEmbeddingMetadata, 'chunkIndex'> = {
            source: 'text',
            userId,
            sourceId: materialId,
            sourceName: materialName,
            last_embedding_at: lastEmbeddingAt,
        }

        // 分块
        const { documents, ids } = await splitDocumentContent(content, metadata, config)

        if (documents.length === 0) {
            logger.warn(`文本材料 ${materialId} 内容为空，跳过向量化`)
            return {
                ids: [],
                lastEmbeddingAt,
                chunkCount: 0,
            }
        }

        // 添加到向量存储
        await addDocumentsToVectorStore(documents, ids, caseMaterialVectorConfig)

        logger.info(`文本材料 ${materialId} 向量化完成`, {
            chunkCount: documents.length,
            ids,
        })

        return {
            ids,
            lastEmbeddingAt,
            chunkCount: documents.length,
        }
    } catch (error) {
        logger.error(`文本材料 ${materialId} 向量化失败:`, error)
        throw error
    }
}

/**
 * 检查文本材料是否已向量化
 * @param materialId 材料 ID（case_materials 表中的 ID）
 * @returns 是否已向量化
 */
export async function isTextEmbedded(materialId: number): Promise<boolean> {
    const pool = getPool()
    const query = `
        SELECT EXISTS(
            SELECT 1 FROM ${caseMaterialVectorConfig.tableName} 
            WHERE metadata->>'source' = 'text' AND metadata->>'sourceId' = $1
            LIMIT 1
        ) as exists
    `
    const result = await pool.query(query, [materialId.toString()])
    return result.rows[0]?.exists === true
}

/**
 * 获取文本材料的向量 ID 列表
 * @param materialId 材料 ID（case_materials 表中的 ID）
 * @returns 向量 ID 列表
 */
export async function getTextEmbeddingIds(materialId: number): Promise<string[]> {
    const pool = getPool()
    const query = `
        SELECT id FROM ${caseMaterialVectorConfig.tableName} 
        WHERE metadata->>'source' = 'text' AND metadata->>'sourceId' = $1
        ORDER BY (metadata->>'chunkIndex')::int ASC
    `
    const result = await pool.query(query, [materialId.toString()])
    return result.rows.map((row: { id: string }) => row.id)
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
    /** 原始文件名 */
    fileName: string
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
 * @param sourceId 来源 ID（如 ossFileId 或 materialId）
 * @returns 删除的记录数
 */
export async function deleteContentEmbeddings(
    source: 'doc' | 'audio' | 'image' | 'text',
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
 *   "sourceName": "证据材料.docx",  // 原始文件名
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
    const { content, userId, ossFileId, fileName } = input

    logger.info('开始向量化文档', {
        ossFileId,
        userId,
        fileName,
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
            sourceName: fileName,
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


// ============================================
// 图像内容嵌入服务
// ============================================

/** 图像嵌入输入参数 */
export interface EmbedImageInput {
    /** 图像识别内容（Markdown 格式） */
    content: string
    /** 用户 ID */
    userId: number
    /** OSS 文件 ID */
    ossFileId: number
    /** 原始文件名 */
    fileName: string
}

/** 图像嵌入结果 */
export interface EmbedImageResult {
    /** 生成的向量 ID 列表 */
    ids: string[]
    /** 最后嵌入时间 */
    lastEmbeddingAt: string
    /** 分块数量 */
    chunkCount: number
}

/**
 * 向量化图像识别内容
 *
 * 元数据结构：
 * {
 *   "source": "image",
 *   "userId": 137,
 *   "sourceId": 431,  // ossFileId
 *   "sourceName": "证据照片.jpg",  // 原始文件名
 *   "last_embedding_at": "2025-12-16T22:47:29+08:00",
 *   "chunkIndex": 0
 * }
 *
 * @param input 图像嵌入输入
 * @param config 分块配置（可选）
 * @returns 嵌入结果
 */
export async function embedImageService(
    input: EmbedImageInput,
    config: TextSplitterConfig = defaultSplitterConfig
): Promise<EmbedImageResult> {
    const { content, userId, ossFileId, fileName } = input

    logger.info('开始向量化图像识别内容', {
        ossFileId,
        userId,
        fileName,
        contentLength: content.length,
    })

    try {
        // 删除该图像的现有向量数据（避免重复）
        await deleteContentEmbeddings('image', ossFileId)

        // 记录嵌入时间
        const lastEmbeddingAt = dayjs().format('YYYY-MM-DDTHH:mm:ss+08:00')

        // 准备元数据
        const metadata: Omit<ContentEmbeddingMetadata, 'chunkIndex'> = {
            source: 'image',
            userId,
            sourceId: ossFileId,
            sourceName: fileName,
            last_embedding_at: lastEmbeddingAt,
        }

        // 分块
        const { documents, ids } = await splitDocumentContent(content, metadata, config)

        if (documents.length === 0) {
            logger.warn(`图像 ${ossFileId} 识别内容为空，跳过向量化`)
            return {
                ids: [],
                lastEmbeddingAt,
                chunkCount: 0,
            }
        }

        // 添加到向量存储
        await addDocumentsToVectorStore(documents, ids, caseMaterialVectorConfig)

        logger.info(`图像 ${ossFileId} 向量化完成`, {
            chunkCount: documents.length,
            ids,
        })

        return {
            ids,
            lastEmbeddingAt,
            chunkCount: documents.length,
        }
    } catch (error) {
        logger.error(`图像 ${ossFileId} 向量化失败:`, error)
        throw error
    }
}

/**
 * 检查图像是否已向量化
 * @param ossFileId OSS 文件 ID
 * @returns 是否已向量化
 */
export async function isImageEmbedded(ossFileId: number): Promise<boolean> {
    const pool = getPool()
    const query = `
        SELECT EXISTS(
            SELECT 1 FROM ${caseMaterialVectorConfig.tableName} 
            WHERE metadata->>'source' = 'image' AND metadata->>'sourceId' = $1
            LIMIT 1
        ) as exists
    `
    const result = await pool.query(query, [ossFileId.toString()])
    return result.rows[0]?.exists === true
}

/**
 * 获取图像的向量 ID 列表
 * @param ossFileId OSS 文件 ID
 * @returns 向量 ID 列表
 */
export async function getImageEmbeddingIds(ossFileId: number): Promise<string[]> {
    const pool = getPool()
    const query = `
        SELECT id FROM ${caseMaterialVectorConfig.tableName} 
        WHERE metadata->>'source' = 'image' AND metadata->>'sourceId' = $1
        ORDER BY (metadata->>'chunkIndex')::int ASC
    `
    const result = await pool.query(query, [ossFileId.toString()])
    return result.rows.map((row: { id: string }) => row.id)
}

/**
 * 检索用户的图像内容
 * @param userId 用户 ID
 * @param query 查询文本
 * @param k 返回结果数量（默认 5）
 * @returns 检索结果列表
 */
export async function searchUserImagesService(
    userId: number,
    query: string,
    k: number = 5
): Promise<Array<{
    content: string
    sourceId: number
    score: number
    chunkIndex: number
}>> {
    logger.info('检索用户图像', { userId, query, k })

    try {
        // 使用 userId 和 source 作为过滤条件
        const filter = { userId, source: 'image' }

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

        logger.info(`用户 ${userId} 图像检索完成`, {
            resultCount: searchResults.length,
        })

        return searchResults
    } catch (error) {
        logger.error(`用户 ${userId} 图像检索失败:`, error)
        throw error
    }
}


// ============================================
// 音频内容嵌入服务
// ============================================

/** ASR 识别结果句子信息 */
interface AsrSentence {
    /** 句子文本 */
    text: string
    /** 开始时间（毫秒） */
    begin_time: number
    /** 结束时间（毫秒） */
    end_time: number
    /** 说话人 ID */
    speaker_id: number
    /** 句子 ID */
    sentence_id?: number
}

/** ASR 说话人信息 */
interface AsrSpeaker {
    /** 说话人 ID */
    id: number
    /** 说话人名称 */
    name: string
}

/**
 * 格式化时间戳（毫秒转 MM:SS 格式）
 * @param timeMs 毫秒时间
 * @returns 格式化的时间字符串，如 "01:03"
 */
function formatTimestamp(timeMs: number): string {
    const totalSeconds = Math.floor(timeMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

/**
 * 将 ASR 识别结果转换为向量化所需的文本格式
 *
 * 输出格式示例：
 * [00:00-00:03]说话人1：我家里的情况是，我的母亲他一手操持我们的这个家庭。
 * [00:03-00:11]说话人1：我父亲他目前是欠债一百多W的状态，我是已经已婚了...
 *
 * @param sentences ASR 识别结果句子列表
 * @param speakers 说话人信息列表（可选，用于获取说话人名称）
 * @returns 格式化后的文本内容
 */
export function formatAsrResultForEmbedding(
    sentences: AsrSentence[],
    speakers?: AsrSpeaker[]
): string {
    if (!sentences || sentences.length === 0) {
        return ''
    }

    // 构建说话人 ID 到名称的映射
    const speakerNameMap = new Map<number, string>()
    if (speakers && speakers.length > 0) {
        speakers.forEach(speaker => {
            speakerNameMap.set(speaker.id, speaker.name)
        })
    }

    // 获取说话人名称
    const getSpeakerName = (speakerId: number): string => {
        return speakerNameMap.get(speakerId) || `说话人${speakerId + 1}`
    }

    // 按开始时间排序
    const sortedSentences = [...sentences].sort((a, b) => a.begin_time - b.begin_time)

    // 格式化每个句子
    const formattedLines = sortedSentences.map(sentence => {
        const startTime = formatTimestamp(sentence.begin_time)
        const endTime = formatTimestamp(sentence.end_time)
        const speakerName = getSpeakerName(sentence.speaker_id)
        return `[${startTime}-${endTime}]${speakerName}：${sentence.text}`
    })

    return formattedLines.join('\n')
}

/** 音频嵌入输入参数 */
export interface EmbedAudioInput {
    /** 音频识别内容（转录文本） */
    content: string
    /** 用户 ID */
    userId: number
    /** OSS 文件 ID */
    ossFileId: number
    /** 原始文件名 */
    fileName: string
}

/** 音频嵌入结果 */
export interface EmbedAudioResult {
    /** 生成的向量 ID 列表 */
    ids: string[]
    /** 最后嵌入时间 */
    lastEmbeddingAt: string
    /** 分块数量 */
    chunkCount: number
}

/**
 * 向量化音频识别内容
 *
 * 元数据结构：
 * {
 *   "source": "audio",
 *   "userId": 137,
 *   "sourceId": 431,  // ossFileId
 *   "sourceName": "录音证据.mp3",  // 原始文件名
 *   "last_embedding_at": "2025-12-16T22:47:29+08:00",
 *   "chunkIndex": 0
 * }
 *
 * Requirements: 6.5（音频识别向量化嵌入）
 *
 * @param input 音频嵌入输入
 * @param config 分块配置（可选）
 * @returns 嵌入结果
 */
export async function embedAudioService(
    input: EmbedAudioInput,
    config: TextSplitterConfig = defaultSplitterConfig
): Promise<EmbedAudioResult> {
    const { content, userId, ossFileId, fileName } = input

    logger.info('开始向量化音频识别内容', {
        ossFileId,
        userId,
        fileName,
        contentLength: content.length,
    })

    try {
        // 删除该音频的现有向量数据（避免重复）
        await deleteContentEmbeddings('audio', ossFileId)

        // 记录嵌入时间
        const lastEmbeddingAt = dayjs().format('YYYY-MM-DDTHH:mm:ss+08:00')

        // 准备元数据
        const metadata: Omit<ContentEmbeddingMetadata, 'chunkIndex'> = {
            source: 'audio',
            userId,
            sourceId: ossFileId,
            sourceName: fileName,
            last_embedding_at: lastEmbeddingAt,
        }

        // 分块
        const { documents, ids } = await splitDocumentContent(content, metadata, config)

        if (documents.length === 0) {
            logger.warn(`音频 ${ossFileId} 识别内容为空，跳过向量化`)
            return {
                ids: [],
                lastEmbeddingAt,
                chunkCount: 0,
            }
        }

        // 添加到向量存储
        await addDocumentsToVectorStore(documents, ids, caseMaterialVectorConfig)

        logger.info(`音频 ${ossFileId} 向量化完成`, {
            chunkCount: documents.length,
            ids,
        })

        return {
            ids,
            lastEmbeddingAt,
            chunkCount: documents.length,
        }
    } catch (error) {
        logger.error(`音频 ${ossFileId} 向量化失败:`, error)
        throw error
    }
}

/**
 * 检查音频是否已向量化
 * @param ossFileId OSS 文件 ID
 * @returns 是否已向量化
 */
export async function isAudioEmbedded(ossFileId: number): Promise<boolean> {
    const pool = getPool()
    const query = `
        SELECT EXISTS(
            SELECT 1 FROM ${caseMaterialVectorConfig.tableName} 
            WHERE metadata->>'source' = 'audio' AND metadata->>'sourceId' = $1
            LIMIT 1
        ) as exists
    `
    const result = await pool.query(query, [ossFileId.toString()])
    return result.rows[0]?.exists === true
}

/**
 * 获取音频的向量 ID 列表
 * @param ossFileId OSS 文件 ID
 * @returns 向量 ID 列表
 */
export async function getAudioEmbeddingIds(ossFileId: number): Promise<string[]> {
    const pool = getPool()
    const query = `
        SELECT id FROM ${caseMaterialVectorConfig.tableName} 
        WHERE metadata->>'source' = 'audio' AND metadata->>'sourceId' = $1
        ORDER BY (metadata->>'chunkIndex')::int ASC
    `
    const result = await pool.query(query, [ossFileId.toString()])
    return result.rows.map((row: { id: string }) => row.id)
}

/**
 * 检索用户的音频内容
 * @param userId 用户 ID
 * @param query 查询文本
 * @param k 返回结果数量（默认 5）
 * @returns 检索结果列表
 */
export async function searchUserAudiosService(
    userId: number,
    query: string,
    k: number = 5
): Promise<Array<{
    content: string
    sourceId: number
    score: number
    chunkIndex: number
}>> {
    logger.info('检索用户音频', { userId, query, k })

    try {
        // 使用 userId 和 source 作为过滤条件
        const filter = { userId, source: 'audio' }

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

        logger.info(`用户 ${userId} 音频检索完成`, {
            resultCount: searchResults.length,
        })

        return searchResults
    } catch (error) {
        logger.error(`用户 ${userId} 音频检索失败:`, error)
        throw error
    }
}


// ============================================
// 统一材料嵌入入口
// ============================================

/**
 * 统一材料嵌入入口
 *
 * 根据材料类型分发到对应嵌入服务，自动管理识别记录的 lastEmbeddingAt。
 *
 * @param materialId case_materials.id
 * @param userId 用户 ID
 * @returns 嵌入结果
 */
export async function embedMaterialUnifiedService(
    materialId: number,
    userId: number,
): Promise<{ success: boolean; chunkCount?: number; error?: string }> {
    // 1. 查询材料信息
    const material = await prisma.caseMaterials.findFirst({
        where: { id: materialId, deletedAt: null },
    })

    if (!material) {
        return { success: false, error: '材料不存在' }
    }

    // 2. 按类型分发（使用动态 import 确保可测试性）
    switch (material.type) {
        case 1: { // CASE_CONTENT
            const { embedTextContentByMaterialIdService } = await import('./textContentRecords.service')
            return embedTextContentByMaterialIdService(materialId, userId)
        }

        case 2: { // DOCUMENT
            if (!material.ossFileId) {
                return { success: false, error: '文档材料缺少 ossFileId' }
            }
            const docRecord = await prisma.docRecognitionRecords.findFirst({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                select: { markdownContent: true },
                orderBy: { createdAt: 'desc' },
            })
            if (!docRecord?.markdownContent) {
                return { success: false, error: '文档识别记录内容为空' }
            }
            const docResult = await embedDocumentService({
                content: docRecord.markdownContent,
                userId,
                ossFileId: material.ossFileId,
                fileName: material.name,
            })
            await prisma.docRecognitionRecords.updateMany({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                data: { lastEmbeddingAt: new Date() },
            })
            return { success: true, chunkCount: docResult.chunkCount }
        }

        case 3: { // IMAGE
            if (!material.ossFileId) {
                return { success: false, error: '图片材料缺少 ossFileId' }
            }
            const imgRecord = await prisma.imageRecognitionRecords.findFirst({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                select: { markdownContent: true },
                orderBy: { createdAt: 'desc' },
            })
            if (!imgRecord?.markdownContent) {
                return { success: false, error: '图片识别记录内容为空' }
            }
            const imgResult = await embedImageService({
                content: imgRecord.markdownContent,
                userId,
                ossFileId: material.ossFileId,
                fileName: material.name,
            })
            await prisma.imageRecognitionRecords.updateMany({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                data: { lastEmbeddingAt: new Date() },
            })
            return { success: true, chunkCount: imgResult.chunkCount }
        }

        case 4: { // AUDIO
            if (!material.ossFileId) {
                return { success: false, error: '音频材料缺少 ossFileId' }
            }
            const asrRecord = await prisma.asrRecords.findFirst({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                select: { summary: true },
                orderBy: { createdAt: 'desc' },
            })
            if (!asrRecord?.summary) {
                return { success: false, error: '音频识别记录内容为空' }
            }
            const audioResult = await embedAudioService({
                content: asrRecord.summary,
                userId,
                ossFileId: material.ossFileId,
                fileName: material.name,
            })
            await prisma.asrRecords.updateMany({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                data: { lastEmbeddingAt: new Date() },
            })
            return { success: true, chunkCount: audioResult.chunkCount }
        }

        default:
            return { success: false, error: `不支持的材料类型: ${material.type}` }
    }
}


// ============================================
// 统一嵌入状态查询
// ============================================

/**
 * 批量查询材料的嵌入状态
 *
 * 按材料类型查对应识别记录表的 lastEmbeddingAt：
 * - CASE_CONTENT (1) → textContentRecords.lastEmbeddingAt
 * - DOCUMENT (2) → docRecognitionRecords.lastEmbeddingAt
 * - IMAGE (3) → imageRecognitionRecords.lastEmbeddingAt
 * - AUDIO (4) → asrRecords.lastEmbeddingAt
 *
 * @param materialIds case_materials.id[]
 * @returns Map<materialId, isEmbedded>
 */
export async function batchCheckMaterialEmbeddedService(
    materialIds: number[]
): Promise<Map<number, boolean>> {
    const result = new Map<number, boolean>()
    if (materialIds.length === 0) return result

    // 1. 查询所有材料的类型和 ossFileId
    const materials = await prisma.caseMaterials.findMany({
        where: { id: { in: materialIds }, deletedAt: null },
        select: { id: true, type: true, ossFileId: true },
    })

    // 初始化所有 materialIds 为 false
    for (const id of materialIds) {
        result.set(id, false)
    }

    // 2. 按类型分组
    const textMaterialIds: number[] = []
    const docOssFileMap = new Map<number, number>()     // ossFileId -> materialId
    const imageOssFileMap = new Map<number, number>()
    const audioOssFileMap = new Map<number, number>()

    for (const m of materials) {
        switch (m.type) {
            case 1: // CASE_CONTENT
                textMaterialIds.push(m.id)
                break
            case 2: // DOCUMENT
                if (m.ossFileId) docOssFileMap.set(m.ossFileId, m.id)
                break
            case 3: // IMAGE
                if (m.ossFileId) imageOssFileMap.set(m.ossFileId, m.id)
                break
            case 4: // AUDIO
                if (m.ossFileId) audioOssFileMap.set(m.ossFileId, m.id)
                break
        }
    }

    // 3. 并行查询各类型的嵌入状态
    const queries: Promise<void>[] = []

    if (textMaterialIds.length > 0) {
        queries.push(
            prisma.textContentRecords.findMany({
                where: {
                    materialId: { in: textMaterialIds },
                    deletedAt: null,
                },
                select: { materialId: true, lastEmbeddingAt: true },
            }).then(records => {
                for (const r of records) {
                    if (r.materialId && r.lastEmbeddingAt) {
                        result.set(r.materialId, true)
                    }
                }
            })
        )
    }

    if (docOssFileMap.size > 0) {
        queries.push(
            prisma.docRecognitionRecords.findMany({
                where: {
                    ossFileId: { in: [...docOssFileMap.keys()] },
                    deletedAt: null,
                },
                select: { ossFileId: true, lastEmbeddingAt: true },
            }).then(records => {
                for (const r of records) {
                    const materialId = docOssFileMap.get(r.ossFileId)
                    if (materialId && r.lastEmbeddingAt) {
                        result.set(materialId, true)
                    }
                }
            })
        )
    }

    if (imageOssFileMap.size > 0) {
        queries.push(
            prisma.imageRecognitionRecords.findMany({
                where: {
                    ossFileId: { in: [...imageOssFileMap.keys()] },
                    deletedAt: null,
                },
                select: { ossFileId: true, lastEmbeddingAt: true },
            }).then(records => {
                for (const r of records) {
                    const materialId = imageOssFileMap.get(r.ossFileId)
                    if (materialId && r.lastEmbeddingAt) {
                        result.set(materialId, true)
                    }
                }
            })
        )
    }

    if (audioOssFileMap.size > 0) {
        queries.push(
            prisma.asrRecords.findMany({
                where: {
                    ossFileId: { in: [...audioOssFileMap.keys()] },
                    deletedAt: null,
                },
                select: { ossFileId: true, lastEmbeddingAt: true },
            }).then(records => {
                for (const r of records) {
                    const materialId = audioOssFileMap.get(r.ossFileId)
                    if (materialId && r.lastEmbeddingAt) {
                        result.set(materialId, true)
                    }
                }
            })
        )
    }

    await Promise.all(queries)
    return result
}

/**
 * 查询单个材料的嵌入状态
 *
 * @param materialId case_materials.id
 * @returns 是否已嵌入
 */
export async function isMaterialEmbeddedService(
    materialId: number
): Promise<boolean> {
    const result = await batchCheckMaterialEmbeddedService([materialId])
    return result.get(materialId) ?? false
}
