/**
 * 最高人民法院民事诉讼文书样式 一次性导入脚本
 *
 * 数据来源：105 份官方 .docx 模板（路径由 --dir 参数指定）
 *
 * 行为：
 *  1. 遍历目录下所有 .docx（自动过滤 Word 临时锁文件 .~*）
 *  2. 按文件名查 FILE_TO_CATEGORY 映射拿到分类
 *  3. 规范化占位符 name：把含 `/`、`，`、`×××`、`……`、空格、中文括号等
 *     特殊字符的 name 自动改写为合法标识符（项目 scanner 正则 [一-龥\w]+）
 *  4. 幂等：name+category+scope=global+deletedAt=null 已存在则跳过
 *  5. 调 createDocumentTemplateService({ scope: 'global', ownerUserId: null })
 *  6. 输出报告：成功 / 已存在跳过 / 无占位符跳过 / 失败
 *
 * 为什么走 server/scripts/：
 *  - 与 importContractPlaybooks.ts / migrateGlobalTemplateOwnership.ts 同模式
 *  - 是已上线环境的一次性数据导入，不是 schema migration
 *  - seedData.sql 不包含 ossFiles / documentTemplates 这类用户运行时数据
 *
 * 用法：
 *   npx tsx server/scripts/importCourtTemplates.ts \
 *     --dir "/Users/daixin/Downloads/最高人民法院民事诉讼文书样式_模板" \
 *     [--dry-run]
 */

import 'dotenv/config'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import type { DocumentCategoryKey } from '#shared/types/document'

// ==================== 文件名 → 分类 映射表（105 项）====================

const FILE_TO_CATEGORY: Record<string, DocumentCategoryKey> = {
    // ---------- general 律师通用工具（6）----------
    '1. 法定代表人身份证明书（法人当事人用）.docx': 'general',
    '2. 主要负责人身份证明书（其他组织的当事人用）.docx': 'general',
    '3. 共同诉讼代表人推选书（共同诉讼当事人推选代表人用）.docx': 'general',
    '4. 授权委托书（公民委托诉讼代理人用）.docx': 'general',
    '5. 授权委托书（法人或者其他组织委托诉讼代理人用）.docx': 'general',
    '6. 推荐函（推荐委托诉讼代理人用）.docx': 'general',

    // ---------- litigation 起诉·应诉·上诉（16）----------
    '1.口头起诉登记表（公民口头提起民事诉讼用）.docx': 'litigation',
    '1. 民事起诉状（案外人提起执行异议之诉用）.docx': 'litigation',
    '1. 民事起诉状（提起第三人撤销之诉用）.docx': 'litigation',
    '1. 民事起诉状（提起公益诉讼用）.docx': 'litigation',
    '1. 民事上诉状（当事人提起上诉用）.docx': 'litigation',
    '1. 民事再审申请书（申请再审用）.docx': 'litigation',
    '1. 起诉书（申请确定选民资格用）.docx': 'litigation',
    '2. 民事起诉状（公民提起民事诉讼用）.docx': 'litigation',
    '2. 民事起诉状（申请执行人提起执行异议之诉用）.docx': 'litigation',
    '2.民事上诉状.docx': 'litigation',
    '2. 声明书（社会组织声明无违法记录用）.docx': 'litigation',
    '3. 申请书（其他机关和有关组织申请参加公益诉讼用）.docx': 'litigation',
    '3.民事起诉状（法人或者其他组织提起民事诉讼用）.docx': 'litigation',
    '4. 意见书（支持起诉单位提交书面意见用）.docx': 'litigation',
    '6. 民事答辩状（公民对民事起诉提出答辩用）.docx': 'litigation',
    '7. 民事答辩状（法人或者其他组织对民事起诉提出答辩用）.docx': 'litigation',

    // ---------- procedure 流程变更·程序操作（33）----------
    '1. 复议申请书（司法制裁复议案件用）.docx': 'procedure',
    '1. 申请书（申请缓交、减交或者免交诉讼费用）.docx': 'procedure',
    '1. 申请书（申请回避用）.docx': 'procedure',
    '1. 申请书（申请顺延期限用）.docx': 'procedure',
    '1. 申请书（申请支付令用）.docx': 'procedure',
    '1. 申请书（申请公示催告用）.docx': 'procedure',
    '1. 异议书（对管辖权提出异议用）.docx': 'procedure',
    '1. 异议书（对适用简易程序提出异议用）.docx': 'procedure',
    '1. 异议书（对适用小额诉讼程序提出异议用）.docx': 'procedure',
    '1. 意见书（离婚案件当事人出具书面意见用）.docx': 'procedure',
    '2. 复议申请书（申请对驳回回避申请决定复议用）.docx': 'procedure',
    '2. 悔过书（司法拘留案件具结悔过用）.docx': 'procedure',
    '2. 申请书（撤回支付令申请用）.docx': 'procedure',
    '2. 申请书（撤回公示催告申请用）.docx': 'procedure',
    '3. 申请书（申请书证提出命令用）.docx': 'procedure',
    '3. 申报书（利害关系人申报权利用）.docx': 'procedure',
    '3. 异议书（对支付令提出异议用）.docx': 'procedure',
    '4. 民事反诉状（公民提起民事反诉用）.docx': 'procedure',
    '4. 申请书（撤回支付令异议用）.docx': 'procedure',
    '4.复议申请书（当事人、利害关系人申请复议用）.docx': 'procedure',
    '5.民事反诉状（法人或者其他组织提起民事反诉用）.docx': 'procedure',
    '7. 申请书（申请通知有专门知识的人出庭用）.docx': 'procedure',
    '8. 申请书（申请追加必要的共同诉讼当事人用）.docx': 'procedure',
    '9. 申请书（无独立请求权的第三人申请参加诉讼用）.docx': 'procedure',
    '10. 申请书（申请增加诉讼请求用）.docx': 'procedure',
    '11. 申请书（申请变更诉讼请求用）.docx': 'procedure',
    '12. 声明书（放弃诉讼请求用）.docx': 'procedure',
    '13. 申请书（申请不公开审理用）.docx': 'procedure',
    '14. 申请书（申请撤回起诉用）.docx': 'procedure',
    '15. 申请书（申请撤回反诉用）.docx': 'procedure',
    '16. 申请书（申请恢复诉讼用）.docx': 'procedure',
    '17. 申请书（申请证明判决书或者裁定书的法律效力用）.docx': 'procedure',
    '28. 申请书（撤回特别程序申请用）.docx': 'procedure',

    // ---------- evidence 证据·鉴定·调查取证（7）----------
    '1. 申请书（申请延长举证期限用）.docx': 'evidence',
    '2. 申请书（申请人民法院调查收集证据用）.docx': 'evidence',
    '4. 申请书（申请通知证人出庭作证用）.docx': 'evidence',
    '5. 申请书（申请鉴定用）.docx': 'evidence',
    '6.申请书（申请返还鉴定费用）.docx': 'evidence',
    '8. 申请书（申请诉前证据保全用）.docx': 'evidence',
    '9. 申请书（申请诉讼证据保全用）.docx': 'evidence',

    // ---------- preservation 保全·冻结·先予执行（9）----------
    '1. 申请书（诉前或者仲裁前申请财产保全用）.docx': 'preservation',
    '2. 申请书（申请诉前或仲裁前行为保全用）.docx': 'preservation',
    '3. 申请书（申请诉讼财产保全用）.docx': 'preservation',
    '4. 申请书（申请诉讼行为保全用）.docx': 'preservation',
    '5. 申请书（申请解除保全用）.docx': 'preservation',
    '6. 申请书（申请变更保全标的物用）.docx': 'preservation',
    '7. 申请书（申请先予执行用）.docx': 'preservation',
    '8. 复议申请书（申请对保全或者先予执行裁定复议用）.docx': 'preservation',
    '9. 担保书（案外人提供保全或者先予执行担保用）.docx': 'preservation',

    // ---------- enforcement 执行·要钱·强制措施（8）----------
    '1. 申请书（申请执行用）.docx': 'enforcement',
    '1. 申请书（当事人申请承认和执行外国法院生效判决、裁定或仲裁裁决用）.docx': 'enforcement',
    '2. 被执行人财产状况表（申请执行人提供被执行人财产状况用）.docx': 'enforcement',
    '3. 执行异议书（当事人、利害关系人提出异议用）.docx': 'enforcement',
    '5. 申请书（申请提级执行用）.docx': 'enforcement',
    '6. 执行异议书（案外人提出异议用）.docx': 'enforcement',
    '7. 执行异议书（对财产分配方案提出异议用）.docx': 'enforcement',
    '8. 保证书（执行担保用）.docx': 'enforcement',

    // ---------- arbitration 仲裁·调解·担保物权（8）----------
    '13. 申请书（申请司法确认调解协议用）.docx': 'arbitration',
    '14. 申请书（申请撤销确认调解协议裁定用）.docx': 'arbitration',
    '15. 申请书（申请实现担保物权用）.docx': 'arbitration',
    '16. 异议书（对实现担保物权申请提出异议用）.docx': 'arbitration',
    '17. 申请书（申请撤销准许实现担保物权裁定用）.docx': 'arbitration',
    '21. 申请书（申请确认仲裁协议效力用）.docx': 'arbitration',
    '22. 申请书（申请撤销仲裁裁决用）.docx': 'arbitration',
    '23. 申请书（申请撤销劳动争议仲裁裁决用）.docx': 'arbitration',

    // ---------- protection_order 人身安全保护令（4）----------
    '24. 申请书（申请人身安全保护令用）.docx': 'protection_order',
    '25. 复议申请书（申请人对驳回人身安全保护令申请复议用）.docx': 'protection_order',
    '26. 复议申请书（被申请人对作出人身安全保护令申请复议用）.docx': 'protection_order',
    '27. 申请书（申请撤销、变更、延长人身安全保护令用）.docx': 'protection_order',

    // ---------- identity 身份·监护·失踪（14）----------
    '2. 申请书（申请宣告公民失踪用）.docx': 'identity',
    '3. 申请书（申请撤销宣告失踪用）.docx': 'identity',
    '4. 申请书（申请变更失踪人财产代管人用）.docx': 'identity',
    '5. 申请书（申请宣告公民死亡用）.docx': 'identity',
    '6. 申请书（申请撤销宣告死亡用）.docx': 'identity',
    '7. 申请书（申请宣告公民无民事行为能力用）.docx': 'identity',
    '8.申请书（申请宣告公民限制民事行为能力用）.docx': 'identity',
    '9. 申请书（申请宣告公民恢复限制民事行为能力用）.docx': 'identity',
    '10. 申请书（申请宣告公民恢复完全民事行为能力用）.docx': 'identity',
    '11. 申请书（申请认定财产无主用）.docx': 'identity',
    '12. 申请书（申请撤销认定财产无主用）.docx': 'identity',
    '18. 申请书（申请确定监护人用）.docx': 'identity',
    '19. 申请书（申请变更监护人用）.docx': 'identity',
    '20. 申请书（申请撤销监护人资格用）.docx': 'identity',
}

// ==================== 占位符 name 规范化 ====================

/**
 * 规范化占位符 name：让它落到项目 scanner 允许的字符集 [一-龥\w]+
 *
 * 替换规则（按业务语义优先级）：
 *  - `/` → `或`           ：`{{法定代理人/指定代理人}}` → `{{法定代理人或指定代理人}}`
 *  - `，`/`、` → `_`       ：`{{证据和证据来源，证人姓名和住所}}` → `{{证据和证据来源_证人姓名和住所}}`
 *  - `（）()：:×…\s` → 删    ：`{{备 注}}` → `{{备注}}`、`{{××××号}}` → `{{号}}`
 *  - 兜底：剩余非法字符 → 删
 */
export function normalizePlaceholderName(name: string): string {
    let result = name
        .replace(/\//g, '或')
        .replace(/[，、]/g, '_')
        .replace(/[（）()：:×…\s]/g, '')
    // 兜底：把 [一-龥\w] 之外的字符全部去掉（极端情况）
    result = result.replace(/[^一-龥\w]/g, '')
    return result
}

/**
 * 规范化 docx Buffer 中所有占位符 name。
 *
 * 实现：借用 docxtemplater 自身的 render 流程——注册一个 parser，让每个占位符的渲染值
 * 等于 `{{normalizedName}}`，render({}) 后 docx 内所有原始占位符就被替换为规范名。
 * 副作用：docxtemplater 会把跨 w:t 的占位符合并到单个 w:t，文档格式不变。
 */
export function normalizeDocxPlaceholders(buf: Buffer): { buffer: Buffer; renames: Array<{ from: string; to: string }> } {
    const renames: Array<{ from: string; to: string }> = []
    const seen = new Set<string>()

    const zip = new PizZip(buf)
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' },
        parser: (tag: string) => ({
            get: () => {
                const normalized = normalizePlaceholderName(tag)
                if (tag !== normalized && !seen.has(tag)) {
                    seen.add(tag)
                    renames.push({ from: tag, to: normalized })
                }
                return `{{${normalized}}}`
            },
        }),
    })
    doc.render({})
    const out = doc.getZip().generate({ type: 'nodebuffer' })
    return { buffer: out, renames }
}

// ==================== 主流程辅助 ====================

/** 文件名 → 模板 name：去掉前缀编号 `N. ` 或 `N.`，去掉 `.docx` */
function fileNameToTemplateName(fileName: string): string {
    return fileName.replace(/^\d+\.\s*/, '').replace(/\.docx$/i, '')
}

interface CliArgs {
    dir: string
    dryRun: boolean
}

function parseArgs(): CliArgs {
    const argv = process.argv.slice(2)
    let dir = '/Users/daixin/Downloads/最高人民法院民事诉讼文书样式_模板'
    let dryRun = false
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '--dir') {
            dir = argv[++i] ?? dir
        } else if (a === '--dry-run') {
            dryRun = true
        }
    }
    return { dir, dryRun }
}

// ==================== 主流程 ====================

async function main() {
    const { dir, dryRun } = parseArgs()
    console.log(`[importCourtTemplates] 启动，dir=${dir}，dryRun=${dryRun}`)

    // ---- 脚本引导：独立运行不在 Nitro 运行时，先挂全局依赖再动态 import 服务层 ----
    // 参考 server/scripts/migrateOssBasePath.ts 的模式
    const { prisma } = await import('../utils/db')
    const { logger } = await import('../../shared/utils/logger/index')
    const g = globalThis as Record<string, unknown>
    g.prisma = prisma
    g.logger = logger
    g.useRuntimeConfig = () => ({
        storage: {
            basePath: process.env.NUXT_STORAGE_BASE_PATH || '',
            callbackUrl: process.env.NUXT_STORAGE_CALLBACK_URL || '',
            defaultType: process.env.NUXT_STORAGE_DEFAULT_TYPE || 'aliyun_oss',
            aliyunOss: {
                accessKeyId: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID || '',
                accessKeySecret: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_SECRET || '',
                bucket: process.env.NUXT_STORAGE_ALIYUN_OSS_BUCKET || '',
                region: process.env.NUXT_STORAGE_ALIYUN_OSS_REGION || '',
                customDomain: process.env.NUXT_STORAGE_ALIYUN_OSS_CUSTOM_DOMAIN || '',
            },
            storageConfigEncryptionKey: process.env.NUXT_STORAGE_CONFIG_ENCRYPTION_KEY
                || process.env.STORAGE_CONFIG_ENCRYPTION_KEY
                || '',
        },
    })

    const { createDocumentTemplateService } = await import('../agents/document/documentTemplate.service')

    const allFiles = readdirSync(dir)
        .filter(f => f.endsWith('.docx') && !f.startsWith('.~'))
        .sort()
    console.log(`[importCourtTemplates] 发现 ${allFiles.length} 个 .docx 文件`)

    // 1. 校验：所有文件都必须在映射表里
    const unknownFiles = allFiles.filter(f => !(f in FILE_TO_CATEGORY))
    if (unknownFiles.length > 0) {
        console.error('[importCourtTemplates] 以下文件未在 FILE_TO_CATEGORY 映射表中，请补全后重跑：')
        unknownFiles.forEach(f => console.error(`  - ${f}`))
        process.exit(1)
    }
    // 反向校验：映射表里有但目录里没有的文件（提示用，不阻塞）
    const mappedKeys = Object.keys(FILE_TO_CATEGORY)
    const missingFiles = mappedKeys.filter(k => !allFiles.includes(k))
    if (missingFiles.length > 0) {
        console.warn('[importCourtTemplates] 以下文件在映射表里但目录中缺失（已跳过）：')
        missingFiles.forEach(f => console.warn(`  - ${f}`))
    }

    const stats = {
        total: allFiles.length,
        success: 0,
        existed: 0,
        noPlaceholders: 0,
        failed: 0,
    }
    const failures: Array<{ file: string; reason: string }> = []
    const successes: Array<{ file: string; templateId: number; renames: number }> = []

    for (const fileName of allFiles) {
        const category = FILE_TO_CATEGORY[fileName]!
        const templateName = fileNameToTemplateName(fileName)
        const filePath = join(dir, fileName)

        // 幂等：已存在则跳过
        const existed = await prisma.documentTemplates.findFirst({
            where: {
                name: templateName,
                category,
                scope: 'global',
                deletedAt: null,
            },
            select: { id: true },
        })
        if (existed) {
            console.log(`[skip-existed] ${fileName} → id=${existed.id}`)
            stats.existed++
            continue
        }

        // 读 & 规范化
        let normalizedBuf: Buffer
        let renames: Array<{ from: string; to: string }> = []
        try {
            const rawBuf = readFileSync(filePath)
            const r = normalizeDocxPlaceholders(rawBuf)
            normalizedBuf = r.buffer
            renames = r.renames
        } catch (err) {
            stats.failed++
            failures.push({ file: fileName, reason: `规范化失败：${(err as Error).message?.split('\n')[0]}` })
            continue
        }

        if (renames.length > 0) {
            console.log(`[normalize] ${fileName}：${renames.length} 处占位符 name 规范化`)
            renames.slice(0, 3).forEach(r => console.log(`    ${r.from} → ${r.to}`))
            if (renames.length > 3) console.log(`    ... 另 ${renames.length - 3} 处`)
        }

        if (dryRun) {
            console.log(`[dry-run] ${fileName} → category=${category}, name=${templateName}`)
            stats.success++
            continue
        }

        // 调 service
        try {
            const result = await createDocumentTemplateService({
                scope: 'global',
                ownerUserId: null,
                file: normalizedBuf,
                fileName,
                fileSize: normalizedBuf.length,
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                name: templateName,
                category,
                description: undefined,
            })
            if ('templateId' in result) {
                stats.success++
                successes.push({ file: fileName, templateId: result.templateId, renames: renames.length })
                console.log(`[ok] ${fileName} → templateId=${result.templateId}（规范化 ${renames.length} 处）`)
            } else if (result.code === 400 && result.error.includes('未扫描到占位符')) {
                stats.noPlaceholders++
                failures.push({ file: fileName, reason: '无占位符（已跳过）' })
                console.warn(`[skip-no-placeholder] ${fileName}`)
            } else {
                stats.failed++
                failures.push({ file: fileName, reason: `service 错误 code=${result.code}: ${result.error}` })
                console.error(`[fail] ${fileName}: ${result.error}`)
            }
        } catch (err) {
            stats.failed++
            const msg = (err as Error).message?.split('\n')[0] || String(err)
            failures.push({ file: fileName, reason: `异常：${msg}` })
            logger.error(`[importCourtTemplates] 文件处理异常`, { file: fileName, err })
        }
    }

    console.log('\n=========== 导入报告 ===========')
    console.log(`总文件: ${stats.total}`)
    console.log(`✓ 成功: ${stats.success}`)
    console.log(`- 已存在跳过: ${stats.existed}`)
    console.log(`- 无占位符跳过: ${stats.noPlaceholders}`)
    console.log(`✗ 失败: ${stats.failed}`)
    if (failures.length > 0) {
        console.log('\n失败明细：')
        failures.forEach(f => console.log(`  - ${f.file}：${f.reason}`))
    }
    if (dryRun) {
        console.log('\n（dry-run 模式，未实际入库）')
    }
}

main()
    .catch((err) => {
        console.error('[importCourtTemplates] 失败', err)
        process.exit(1)
    })
    .finally(() => process.exit(0))
