/**
 * 一次性数据修复脚本：把 api_permissions.path 中残留的 [xxx] 字面字符全部
 * 改成 :xxx，修复 RBAC 审查 C4 发现的 158 条 dead 权限规则。
 *
 * 背景：
 * scan.post.ts 的早期版本没有把 Nuxt 文件命名 `[id]` 转成 RBAC 协议 `:id`，
 * 导致 seedData.sql 与历史导入数据中存在 158 条 path 含字面 `[]` 字符。
 * pathMatcher 把 `[` `]` 当作正则字面量转义，永远匹配不上真实请求 → 这些权限
 * 即使被分配给角色也"什么都没授"。
 *
 * 修复策略：
 * 1) 找出所有 path 包含 `[` 或 `]` 的行；
 * 2) 用 regex 把 `[xxx]` 替换为 `:xxx`；
 * 3) 校验替换后 (path, method) 是否与已有非 [] 行冲突——冲突则保留旧行（软删
 *    [] 行），并把 role_api_permissions 关联指到正确行；
 * 4) 完整审计输出：哪些行修改、哪些被合并、哪些被软删。
 *
 * 运行方式：
 *   npx tsx scripts/fix-rbac-api-paths.ts
 *
 * ⚠️ 此脚本是幂等的：重跑不会重复修改已经规范化的行。
 * ⚠️ 生产环境部署同步问题请使用 prisma migration：
 *   prisma/migrations/<ts>_fix_rbac_api_path_format/
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { config } from 'dotenv'
import { PrismaClient } from '../generated/prisma/client'

config()

const createPrismaClient = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const prisma = createPrismaClient()

/**
 * 把 [xxx] 转成 :xxx，对每个匹配段独立替换，不影响已经是 :param 的部分
 */
const normalize = (path: string): string => {
    return path.replace(/\[([^\]]+)\]/g, ':$1')
}

async function main() {
    console.log('▶️  开始修复 RBAC api_permissions 路径格式')

    // 1. 找出所有含 [] 的活权限
    const dirty = await prisma.apiPermissions.findMany({
        where: {
            deletedAt: null,
            OR: [{ path: { contains: '[' } }, { path: { contains: ']' } }],
        },
        select: {
            id: true, path: true, method: true, isPublic: true, status: true,
        },
    })

    if (dirty.length === 0) {
        console.log('✅ 未发现需要修复的路径，退出。')
        return
    }

    console.log(`🔧 共发现 ${dirty.length} 条 dead 权限路径需要修复：`)
    let modified = 0
    let mergedAndSoftDeleted = 0
    let unchanged = 0
    const conflicts: { id: number; path: string; method: string; targetId: number }[] = []

    for (const row of dirty) {
        const normalized = normalize(row.path)
        if (normalized === row.path) {
            unchanged++
            continue
        }

        // 看 (normalized, method) 是否已有"正确格式"的活行
        const conflict = await prisma.apiPermissions.findFirst({
            where: {
                path: normalized,
                method: row.method,
                deletedAt: null,
                id: { not: row.id },
            },
            select: { id: true },
        })

        if (conflict) {
            // 冲突：保留正确格式的旧行；把 role_api_permissions 指向旧行；本行软删
            await prisma.$transaction(async (tx) => {
                // 找出本行对应的所有角色关联
                const relations = await tx.roleApiPermissions.findMany({
                    where: { permissionId: row.id, deletedAt: null },
                    select: { id: true, roleId: true },
                })
                for (const rel of relations) {
                    // 如果目标角色已经关联了 conflict（去重），直接软删本关联
                    const existing = await tx.roleApiPermissions.findFirst({
                        where: {
                            roleId: rel.roleId,
                            permissionId: conflict.id,
                            deletedAt: null,
                        },
                        select: { id: true },
                    })
                    if (existing) {
                        await tx.roleApiPermissions.update({
                            where: { id: rel.id },
                            data: { deletedAt: new Date(), updatedAt: new Date() },
                        })
                    } else {
                        await tx.roleApiPermissions.update({
                            where: { id: rel.id },
                            data: { permissionId: conflict.id, updatedAt: new Date() },
                        })
                    }
                }
                // 软删本行
                await tx.apiPermissions.update({
                    where: { id: row.id },
                    data: { deletedAt: new Date(), updatedAt: new Date() },
                })
            })
            mergedAndSoftDeleted++
            conflicts.push({ id: row.id, path: row.path, method: row.method, targetId: conflict.id })
            console.log(`  ↻ 合并 #${row.id} ${row.method} ${row.path} → 已存在 #${conflict.id}`)
        } else {
            await prisma.apiPermissions.update({
                where: { id: row.id },
                data: { path: normalized, updatedAt: new Date() },
            })
            modified++
            console.log(`  ✓ 修改 #${row.id} ${row.method} ${row.path} → ${normalized}`)
        }
    }

    console.log('')
    console.log('===== 修复总结 =====')
    console.log(`修改: ${modified}`)
    console.log(`合并并软删: ${mergedAndSoftDeleted}`)
    console.log(`无变化: ${unchanged}`)
    if (conflicts.length > 0) {
        console.log('合并明细：')
        conflicts.forEach(c => console.log(`  #${c.id} (${c.method} ${c.path}) → #${c.targetId}`))
    }
    console.log('')
    console.log('🔁 请在生产环境同样运行此脚本，或使用 prisma migrate deploy 应用对应迁移。')
}

main()
    .catch(err => {
        console.error('❌ 修复失败：', err)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
