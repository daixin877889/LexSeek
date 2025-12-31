/**
 * RBAC 权限系统种子数据脚本
 * 
 * 创建超级管理员角色和默认公共 API 权限
 * 
 * 运行方式: npx tsx scripts/seed-rbac.ts
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

// 超级管理员角色
const SUPER_ADMIN_ROLE = {
    name: '超级管理员',
    code: 'super_admin',
    description: '拥有系统所有权限的超级管理员角色',
    status: 1,
}

// 默认公共 API 权限（无需登录即可访问）
const PUBLIC_API_PERMISSIONS = [
    // 健康检查
    { path: '/api/health', method: '*', name: '健康检查', description: '系统健康检查接口', isPublic: true },
    // 认证相关
    { path: '/api/v1/auth/login', method: '*', name: '用户登录', description: '用户登录相关接口', isPublic: true },
    { path: '/api/v1/auth/register', method: 'POST', name: '用户注册', description: '用户注册接口', isPublic: true },
    { path: '/api/v1/auth/reset-password', method: '*', name: '重置密码', description: '重置密码相关接口', isPublic: true },
    // 短信
    { path: '/api/v1/sms/send', method: 'POST', name: '发送短信', description: '发送短信验证码', isPublic: true },
    // 回调
    { path: '/api/v1/callback', method: '*', name: '回调接口', description: '第三方回调接口', isPublic: true },
    { path: '/api/v1/storage/callback', method: '*', name: '存储回调', description: 'OSS 存储回调接口', isPublic: true },
    { path: '/api/v1/payments/callback', method: '*', name: '支付回调', description: '支付回调接口', isPublic: true },
    // 公开调试接口
    { path: '/api/public', method: '*', name: '公开调试', description: '公开调试接口', isPublic: true },
]

// API 权限分组
const API_PERMISSION_GROUPS = [
    { name: '认证管理', description: '用户认证相关接口', sort: 1 },
    { name: '用户管理', description: '用户信息管理接口', sort: 2 },
    { name: '会员管理', description: '会员系统相关接口', sort: 3 },
    { name: '支付管理', description: '支付订单相关接口', sort: 4 },
    { name: '存储管理', description: '文件存储相关接口', sort: 5 },
    { name: '系统管理', description: '系统配置相关接口', sort: 6 },
]

async function main() {
    console.log('开始初始化 RBAC 种子数据...')

    // 1. 创建超级管理员角色
    console.log('创建超级管理员角色...')
    const superAdminRole = await prisma.roles.upsert({
        where: { code: SUPER_ADMIN_ROLE.code },
        update: {},
        create: SUPER_ADMIN_ROLE,
    })
    console.log(`✓ 超级管理员角色已创建: ${superAdminRole.name} (ID: ${superAdminRole.id})`)

    // 2. 创建 API 权限分组
    console.log('创建 API 权限分组...')
    for (const group of API_PERMISSION_GROUPS) {
        const created = await prisma.apiPermissionGroups.upsert({
            where: { name: group.name },
            update: {},
            create: group,
        })
        console.log(`✓ 权限分组已创建: ${created.name} (ID: ${created.id})`)
    }

    // 3. 创建默认公共 API 权限
    console.log('创建默认公共 API 权限...')
    for (const permission of PUBLIC_API_PERMISSIONS) {
        // 检查是否已存在
        const existing = await prisma.apiPermissions.findFirst({
            where: {
                path: permission.path,
                method: permission.method,
                deletedAt: null,
            },
        })

        if (existing) {
            console.log(`- 权限已存在，跳过: ${permission.method} ${permission.path}`)
            continue
        }

        const created = await prisma.apiPermissions.create({
            data: permission,
        })
        console.log(`✓ 公共权限已创建: ${permission.method} ${permission.path} (ID: ${created.id})`)
    }

    console.log('\n✅ RBAC 种子数据初始化完成!')
}

main()
    .catch((e) => {
        console.error('初始化失败:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
