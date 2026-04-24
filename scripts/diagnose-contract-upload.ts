/**
 * 合同审查客户回传 docx 批注诊断工具
 *
 * 用途：
 *   当客户上传的 v2 docx 出现"AI 批注被误判为客户已移除" / "外部新增异常多" 时，
 *   用这个脚本直接解析那份 docx，对照 DB 里的 annotation 表，一眼看清每条 comment
 *   是"LEXSEEK 识别成功 / LEXSEEK 但 id 不在 DB / 压根没 LEXSEEK"中的哪一种。
 *
 * 用法：
 *   # 1. 基于 reviewId + 最近一次上传的 ossFileId
 *   npx tsx scripts/diagnose-contract-upload.ts --review 863 --oss-file <ossFileId>
 *
 *   # 2. 只基于本地 docx 文件（不查 DB）
 *   npx tsx scripts/diagnose-contract-upload.ts --file path/to/v2.docx
 */

import { readFile } from 'node:fs/promises'
import { PrismaClient } from '../generated/prisma/client'
import { parseWordComments } from '../server/services/assistant/contract/docx/wordCommentParser'
import { parseWordCommentRef } from '../server/services/assistant/contract/utils/wordCommentRef'

function parseArgs() {
    const args = process.argv.slice(2)
    const opts: { review?: number; ossFile?: number; file?: string } = {}
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--review') opts.review = Number(args[++i])
        else if (args[i] === '--oss-file') opts.ossFile = Number(args[++i])
        else if (args[i] === '--file') opts.file = args[++i]
    }
    return opts
}

async function readDocxFromOss(prisma: PrismaClient, ossFileId: number): Promise<Buffer> {
    const row = await prisma.ossFiles.findUnique({ where: { id: ossFileId } })
    if (!row?.filePath) throw new Error(`OSS file ${ossFileId} not found`)
    console.log(`[OSS] filePath=${row.filePath} fileName=${row.fileName}`)
    // 走项目内 storage.service 获取 buffer；这里为简化不复用 service，直接让用户 --file 传本地
    throw new Error('请先把 docx 下到本地（见 OSS 控制台），然后用 --file 传入')
}

async function main() {
    const opts = parseArgs()
    if (!opts.file && !(opts.review && opts.ossFile)) {
        console.error('Usage: --file <local-path> 或 --review <id> --oss-file <id>')
        process.exit(1)
    }

    const prisma = new PrismaClient()

    let docxBuffer: Buffer
    if (opts.file) {
        docxBuffer = await readFile(opts.file)
        console.log(`[file] ${opts.file}, size=${docxBuffer.byteLength}`)
    } else {
        docxBuffer = await readDocxFromOss(prisma, opts.ossFile!)
    }

    const { comments, annotationRefsByWId } = await parseWordComments(docxBuffer)
    console.log(`\n=== 解析出 ${comments.length} 条 comment ===`)

    const dbAnnotations = opts.review
        ? await prisma.contractAnnotations.findMany({
            where: { reviewId: opts.review, deletedAt: null },
            select: {
                id: true,
                authorType: true,
                authorName: true,
                wordCommentRef: true,
                removedByClient: true,
                content: true,
            },
        })
        : []
    const dbIds = new Set(dbAnnotations.map(a => a.id))
    if (opts.review) {
        console.log(`\n=== review ${opts.review} DB 中有 ${dbAnnotations.length} 条 annotation ===`)
        for (const a of dbAnnotations) {
            console.log(
                `  id=${a.id} type=${a.authorType} name=${a.authorName} removed=${a.removedByClient} ref=${a.wordCommentRef ?? '(null)'}`,
            )
        }
    }

    console.log('\n=== 每条 comment 的匹配状态 ===')
    let lexseekMatched = 0
    let lexseekStale = 0
    let noLexseek = 0
    for (const c of comments) {
        const refFromInitials = parseWordCommentRef(c.wInitials)
        let status: string
        if (refFromInitials) {
            if (opts.review) {
                status = dbIds.has(refFromInitials.annotationId)
                    ? `[命中] LEXSEEK 命中 annotationId=${refFromInitials.annotationId}`
                    : `[待核] LEXSEEK 但 id=${refFromInitials.annotationId} 不在 DB（可能跨 review 或已硬删）`
            } else {
                status = `[LEXSEEK id=${refFromInitials.annotationId}]`
            }
            if (opts.review && !dbIds.has(refFromInitials.annotationId)) lexseekStale++
            else lexseekMatched++
        } else {
            status = '[失败] 非 LEXSEEK 格式（会被当外部新增 external_new）'
            noLexseek++
        }
        const paraIdxStr = c.anchorParagraphIndex === null ? 'null' : String(c.anchorParagraphIndex)
        console.log(
            `  wId=${c.wId} author="${c.wAuthor}" initials="${c.wInitials}" paraIdx=${paraIdxStr}`,
        )
        console.log(`    ${status}`)
        console.log(`    content[0..60]: ${(c.content ?? '').slice(0, 60).replace(/\n/g, ' ')}`)
    }

    console.log('\n=== 汇总 ===')
    console.log(`  comment 总数: ${comments.length}`)
    console.log(`  LEXSEEK 命中: ${lexseekMatched}`)
    console.log(`  LEXSEEK 但 id 不在 DB: ${lexseekStale}`)
    console.log(`  非 LEXSEEK 格式（w:initials 被编辑工具清除 / 非 LexSeek 产生的 docx）: ${noLexseek}`)

    if (opts.review) {
        const matchedIds = new Set<number>()
        for (const c of comments) {
            const r = parseWordCommentRef(c.wInitials)
            if (r && dbIds.has(r.annotationId)) matchedIds.add(r.annotationId)
        }
        const removed = dbAnnotations.filter(a => !matchedIds.has(a.id))
        console.log(`\n  将被判定为"客户已移除"的 annotation 数: ${removed.length}`)
        for (const a of removed) {
            console.log(`    id=${a.id} name=${a.authorName} content[0..60]="${(a.content ?? '').slice(0, 60)}"`)
        }
        console.log(`\n  将被判定为"外部新增"的 comment 数: ${noLexseek + lexseekStale}`)
    }

    console.log('\n常见诊断结论：')
    console.log('  - 如果"LEXSEEK 命中"=0 且"非 LEXSEEK"很多 → 客户用 WPS/Google Docs/在线工具编辑清掉了 w:initials')
    console.log('  - 如果"LEXSEEK 但 id 不在 DB"很多 → 客户上传的可能是另一个 review 的 docx，或跨环境串了')
    console.log('  - 如果"LEXSEEK 命中"正常但仍有问题 → 看具体 paraIdx 是否正确、anchorQuote 是否匹配')

    await prisma.$disconnect()
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
