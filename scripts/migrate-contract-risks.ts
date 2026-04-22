/**
 * 一次性脚本：把存量 contractReviews.risks JSON 迁移到 ContractRisk/Annotation 表 + v1 快照
 *
 * 运行方式（项目根目录）：
 *   bun run scripts/migrate-contract-risks.ts
 *
 * 幂等：已迁移的 review（currentVersionId != null）会被跳过。
 * 安全：运行前请确保已备份数据（prisma:migrate 会自动建 contract_review_legacy_risks_backup 备份表）。
 */
import { PrismaClient } from '~~/generated/prisma/client'

// 在 Nuxt 之外直接 new PrismaClient（不走自动导入）
const prisma = new PrismaClient()

// 手动引用服务层（scripts 目录在 Nuxt 自动导入体系外，需要用相对路径）
// 由于服务层函数依赖 Nuxt 自动导入的 prisma 全局变量，这里通过 globalThis 注入
;(globalThis as any).prisma = prisma

async function main() {
    const { migrateAllLegacyRisksService } = await import('../server/services/assistant/contract/contractReviewMigrate.service')

    console.log('开始迁移存量 ContractReview.risks JSON...')
    const result = await migrateAllLegacyRisksService()
    console.log('迁移完成：', result)
    console.log(`  - 总处理：${result.processed} 条`)
    console.log(`  - 已迁移：${result.migrated} 条`)
    console.log(`  - 已跳过：${result.processed - result.migrated} 条（已迁移或 risks 为空）`)
}

main()
    .then(async () => {
        await prisma.$disconnect()
        process.exit(0)
    })
    .catch(async (e) => {
        console.error('迁移失败：', e)
        await prisma.$disconnect()
        process.exit(1)
    })
