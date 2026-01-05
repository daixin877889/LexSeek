/**
 * Admin 路由数据初始化脚本
 * 
 * 初始化后台管理系统的路由数据，包括菜单分组配置
 * 
 * 运行方式: npx tsx scripts/seed-admin-routers.ts
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import { config } from 'dotenv'

// 加载环境变量
config()

// 创建 Prisma 客户端实例
const createPrismaClient = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const prisma = createPrismaClient()

// Admin 路由数据定义
const ADMIN_ROUTERS = [
    // 权限管理分组
    { path: '/admin/roles', name: 'admin-roles', title: '角色管理', icon: 'ShieldIcon', menuGroup: '权限管理', menuGroupSort: 1, sort: 1, isMenu: true },
    { path: '/admin/permissions/api', name: 'admin-permissions-api', title: 'API 权限', icon: 'KeyIcon', menuGroup: '权限管理', menuGroupSort: 1, sort: 2, isMenu: true },
    { path: '/admin/permissions/routes', name: 'admin-permissions-routes', title: '路由权限', icon: 'SettingsIcon', menuGroup: '权限管理', menuGroupSort: 1, sort: 3, isMenu: true },
    { path: '/admin/users', name: 'admin-users', title: '用户管理', icon: 'UsersIcon', menuGroup: '权限管理', menuGroupSort: 1, sort: 4, isMenu: true },
    { path: '/admin/audit', name: 'admin-audit', title: '审计日志', icon: 'FileTextIcon', menuGroup: '权限管理', menuGroupSort: 1, sort: 5, isMenu: true },

    // 权益管理分组
    { path: '/admin/benefits', name: 'admin-benefits', title: '权益类型', icon: 'GiftIcon', menuGroup: '权益管理', menuGroupSort: 2, sort: 1, isMenu: true },
    { path: '/admin/benefits/membership', name: 'admin-benefits-membership', title: '会员权益', icon: 'CrownIcon', menuGroup: '权益管理', menuGroupSort: 2, sort: 2, isMenu: true },
    { path: '/admin/benefits/grant', name: 'admin-benefits-grant', title: '用户权益发放', icon: 'UserPlusIcon', menuGroup: '权益管理', menuGroupSort: 2, sort: 3, isMenu: true },

    // 运营管理分组
    { path: '/admin/products', name: 'admin-products', title: '产品管理', icon: 'PackageIcon', menuGroup: '运营管理', menuGroupSort: 3, sort: 1, isMenu: true },
    { path: '/admin/campaigns', name: 'admin-campaigns', title: '营销活动', icon: 'MegaphoneIcon', menuGroup: '运营管理', menuGroupSort: 3, sort: 2, isMenu: true },
    { path: '/admin/redemption-codes', name: 'admin-redemption-codes', title: '兑换码管理', icon: 'TicketIcon', menuGroup: '运营管理', menuGroupSort: 3, sort: 3, isMenu: true },
    { path: '/admin/redemption-codes/records', name: 'admin-redemption-codes-records', title: '兑换记录', icon: 'HistoryIcon', menuGroup: '运营管理', menuGroupSort: 3, sort: 4, isMenu: true },

    // 知识库管理分组
    { path: '/admin/legal-main', name: 'admin-legal-main', title: '法律法规', icon: 'ScaleIcon', menuGroup: '知识库管理', menuGroupSort: 4, sort: 1, isMenu: true },

    // 模型管理分组
    { path: '/admin/model-providers', name: 'admin-model-providers', title: '模型提供商', icon: 'ServerIcon', menuGroup: '模型管理', menuGroupSort: 5, sort: 1, isMenu: true },
    { path: '/admin/model-api-keys', name: 'admin-model-api-keys', title: 'API 密钥', icon: 'KeyRoundIcon', menuGroup: '模型管理', menuGroupSort: 5, sort: 2, isMenu: true },
    { path: '/admin/models', name: 'admin-models', title: '模型配置', icon: 'BotIcon', menuGroup: '模型管理', menuGroupSort: 5, sort: 3, isMenu: true },
]

async function main() {
    console.log('开始初始化 Admin 路由数据...')

    for (const router of ADMIN_ROUTERS) {
        // 使用 upsert 支持重复运行
        const result = await prisma.routers.upsert({
            where: { path: router.path },
            update: {
                title: router.title,
                icon: router.icon,
                menuGroup: router.menuGroup,
                menuGroupSort: router.menuGroupSort,
                sort: router.sort,
                isMenu: router.isMenu,
                updatedAt: new Date(),
            },
            create: {
                name: router.name,
                path: router.path,
                title: router.title,
                icon: router.icon,
                menuGroup: router.menuGroup,
                menuGroupSort: router.menuGroupSort,
                sort: router.sort,
                isMenu: router.isMenu,
                groupId: 3, // 管理后台分组
            },
        })
        console.log(`✓ 路由已更新: ${result.path} (${result.title})`)
    }

    console.log('\n✅ Admin 路由数据初始化完成!')
    console.log(`共处理 ${ADMIN_ROUTERS.length} 条路由记录`)
}

main()
    .catch((e) => {
        console.error('初始化失败:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
