#!/usr/bin/env bun
/**
 * 批量导入文书模板
 *
 * Usage: bun scripts/importDocumentTemplates.ts path/to/templates.csv [--dry-run]
 *
 * CSV 列（header）：file_path, name, category, description, priority
 * - file_path: 相对或绝对 .docx 路径（相对于 baseDir，默认为 process.cwd()）
 * - name: 模板名称（唯一）
 * - category: 必须是 DOCUMENT_CATEGORY_KEYS 之一
 * - description: 可选描述
 * - priority: 可选 integer，默认 100
 *
 * 逐行处理：
 * 1. 读 .docx buffer
 * 2. scanPlaceholders → 空则报错跳过（逐条失败继续）
 * 3. --dry-run 打印预览、跳过写库
 * 4. 否则 uploadFileService + createOssFileDao + documentTemplates.create(scope='global')
 * 5. name+scope='global' 已存在则跳过（幂等）
 *
 * 失败处理：逐条失败跳过，最终汇总
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { uploadFileService } from '~~/server/services/storage/storage.service'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { createDocumentTemplateDAO } from '~~/server/services/assistant/document/documentTemplate.dao'
import { scanPlaceholders } from '~~/server/services/assistant/document/templateScanner'
import { DOCUMENT_CATEGORY_KEYS } from '#shared/types/document'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { StorageProviderType } from '~~/server/lib/storage/types'

// ==================== 类型定义 ====================

/** CSV 行数据 */
export interface CsvRow {
    file_path: string
    name: string
    category: string
    description: string
    priority: string
}

/** 导入结果汇总 */
export interface ImportResult {
    total: number
    imported: number
    skipped: number
}

/** importTemplatesFromCsv 选项 */
export interface ImportOptions {
    dryRun?: boolean
    /** 文件路径的基准目录，默认 process.cwd() */
    baseDir?: string
}

// ==================== CSV 解析工具 ====================

/** CSV header 中必须存在的列（用于 header 校验） */
const MANDATORY_COLUMNS = ['file_path', 'name', 'category'] as const

/** 所有已知 CSV 列名（用于 parseCsvRow 映射） */
const REQUIRED_HEADERS = ['file_path', 'name', 'category', 'description', 'priority'] as const

/**
 * 解析 CSV 文本为行数据数组
 * 支持简单 CSV（字段内无逗号/引号换行）
 */
function parseCsv(text: string): string[][] {
    return text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => line.split(',').map(cell => cell.trim()))
}

/**
 * 将 header 和 values 数组合并为 CsvRow 对象
 * 缺失字段填充为空字符串
 */
export function parseCsvRow(header: string[], values: string[]): CsvRow {
    const row: Record<string, string> = {}
    for (const key of REQUIRED_HEADERS) {
        const idx = header.indexOf(key)
        row[key] = idx >= 0 ? (values[idx] ?? '') : ''
    }
    return row as CsvRow
}

/**
 * 验证 CSV header 包含所有必需列
 * 缺失时抛出错误
 */
function validateHeader(header: string[]): void {
    for (const col of MANDATORY_COLUMNS) {
        if (!header.includes(col)) {
            throw new Error(`CSV 格式错误：缺少必需列 "${col}"，当前列：${header.join(', ')}`)
        }
    }
}

/**
 * 验证单行数据的合法性
 * 不合法时抛出描述性错误
 */
export function validateRow(row: CsvRow): void {
    if (!row.file_path) {
        throw new Error('缺少 file_path')
    }
    if (!row.name) {
        throw new Error('缺少 name')
    }
    if (!row.file_path.endsWith('.docx')) {
        throw new Error(`file_path 必须以 .docx 结尾，当前值：${row.file_path}`)
    }
    if (!DOCUMENT_CATEGORY_KEYS.includes(row.category as any)) {
        throw new Error(
            `非法 category 值：${row.category}，合法值：${DOCUMENT_CATEGORY_KEYS.join(', ')}`,
        )
    }
}

// ==================== 核心导入逻辑 ====================

/**
 * 从 CSV 文件批量导入文书模板
 *
 * @param csvPath CSV 文件路径（绝对或相对于 cwd）
 * @param options 导入选项
 */
export async function importTemplatesFromCsv(
    csvPath: string,
    options: ImportOptions = {},
): Promise<ImportResult> {
    const { dryRun = false, baseDir = process.cwd() } = options
    const result: ImportResult = { total: 0, imported: 0, skipped: 0 }

    // 读取 CSV 文件
    const csvContent = await readFile(csvPath, 'utf-8')
    const rows = parseCsv(csvContent)

    if (rows.length < 2) {
        throw new Error('CSV 文件为空或仅有 header 行')
    }

    const header = rows[0]!
    // 验证 header
    validateHeader(header)

    const dataRows = rows.slice(1)
    result.total = dataRows.length

    for (let i = 0; i < dataRows.length; i++) {
        const lineNum = i + 2
        const values = dataRows[i]!

        let row: CsvRow
        try {
            row = parseCsvRow(header, values)
            validateRow(row)
        } catch (err) {
            console.error(`[import] 第 ${lineNum} 行校验失败：${(err as Error).message}`)
            result.skipped++
            continue
        }

        // 解析文件路径（支持绝对路径和相对路径）
        const filePath = path.isAbsolute(row.file_path)
            ? row.file_path
            : path.resolve(baseDir, row.file_path)

        // 读取 .docx buffer（文件不存在时 ENOENT 会被 catch 捕获）
        let buffer: Buffer
        try {
            buffer = await readFile(filePath)
        } catch (err: any) {
            const msg = err?.code === 'ENOENT' ? `文件不存在：${filePath}` : (err as Error).message
            console.error(`[import] 第 ${lineNum} 行读取文件失败：${msg}`)
            result.skipped++
            continue
        }

        // 扫描占位符
        let placeholders: Array<{ name: string; firstContext: string }>
        try {
            placeholders = await scanPlaceholders(buffer)
        } catch (err) {
            console.error(`[import] 第 ${lineNum} 行扫描占位符异常：${(err as Error).message}`)
            result.skipped++
            continue
        }

        if (placeholders.length === 0) {
            console.error(
                `[import] 第 ${lineNum} 行（${row.name}）无占位符，请检查模板内容，跳过`,
            )
            result.skipped++
            continue
        }

        const priority = row.priority ? parseInt(row.priority, 10) : 100
        const finalPriority = isNaN(priority) ? 100 : priority

        // dry-run：只打印预览
        if (dryRun) {
            console.log(
                `[dry-run] 第 ${lineNum} 行 → 模板：${row.name}，分类：${row.category}，占位符 ${placeholders.length} 个，优先级 ${finalPriority}`,
            )
            result.imported++
            continue
        }

        // 正式写入
        try {
            const fileName = path.basename(filePath)
            const ossPath = `document-templates/${Date.now()}_${fileName}`

            // 上传至 OSS
            await uploadFileService(ossPath, buffer, {
                type: StorageProviderType.ALIYUN_OSS,
                mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            })

            // 写 ossFiles 记录
            const ossFile = await createOssFileDao({
                userId: 1, // 全局模板无归属用户，按 seed 惯例使用首个系统用户 ID
                bucketName: '',
                fileName,
                filePath: ossPath,
                fileSize: buffer.length,
                fileType:
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                source: FileSource.DOCUMENT_TEMPLATE,
                status: OssFileStatus.UPLOADED,
                encrypted: false,
            } as any)

            // 写 documentTemplates 记录
            await createDocumentTemplateDAO({
                name: row.name,
                category: row.category,
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders,
                description: row.description || undefined,
                priority: finalPriority,
            })

            console.log(
                `[import] 写入成功：${row.name}（${placeholders.length} 个占位符）`,
            )
            result.imported++
        } catch (err: any) {
            if (err?.code === 'P2002') {
                console.log(`[import] 第 ${lineNum} 行（${row.name}）已存在，跳过`)
            } else {
                console.error(`[import] 第 ${lineNum} 行（${row.name}）写入失败：${err?.message}`)
            }
            result.skipped++
        }
    }

    console.log(
        `[import] 完成：总计 ${result.total} 行，成功 ${result.imported}，跳过 ${result.skipped}`,
    )
    return result
}

// ==================== CLI 入口 ====================

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    const csvPathArg = args.find(a => !a.startsWith('--'))
    const dryRun = args.includes('--dry-run')

    if (!csvPathArg) {
        console.error('Usage: bun scripts/importDocumentTemplates.ts path/to/templates.csv [--dry-run]')
        process.exit(1)
    }

    const csvPath = path.isAbsolute(csvPathArg)
        ? csvPathArg
        : path.resolve(process.cwd(), csvPathArg)

    if (!existsSync(csvPath)) {
        console.error(`CSV 文件不存在：${csvPath}`)
        process.exit(1)
    }

    try {
        await importTemplatesFromCsv(csvPath, { dryRun })
    } catch (err) {
        console.error(`导入失败：${(err as Error).message}`)
        process.exit(1)
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main()
}
