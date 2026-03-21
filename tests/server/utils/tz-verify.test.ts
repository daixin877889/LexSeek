/**
 * Prisma 时区修复验证测试
 *
 * **Feature: Prisma 时区修复**
 * **Validates: pg driver + PostgreSQL 时区处理正确性**
 *
 * 验证 @prisma/adapter-pg 时区问题已被正确处理。
 * 使用 options: '-c TimeZone=UTC' 确保 pg 会话时区为 UTC。
 * 相关 issue: https://github.com/prisma/prisma/issues/26786
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '../../../server/utils/db'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '../../../.env.testing') })

describe('Prisma 时区修复验证', () => {
    beforeAll(() => {
        // 确保使用测试数据库
    })

    afterAll(async () => {
        await prisma?.$disconnect()
    })

    it('创建记录时传入 JavaScript Date 对象应该正确存储', async () => {
        const beforeCreate = new Date()
        const testName = 'tz-verify-' + Date.now()
        const phone = '139' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0')

        const user = await prisma.users.create({
            data: {
                name: testName,
                phone,
                email: testName + '@test.com',
                createdAt: beforeCreate,
                updatedAt: beforeCreate,
            },
            select: {
                id: true,
                name: true,
                createdAt: true,
                updatedAt: true,
            }
        })

        const diff = Math.abs((user.createdAt?.getTime() || 0) - beforeCreate.getTime())
        expect(diff).toBeLessThan(1000)

        await prisma.users.delete({ where: { id: user.id } }).catch(() => {})
    })

    it('读取记录时 Date 对象应该正确反映 UTC 时间', async () => {
        const now = new Date()
        const testName = 'tz-read-verify-' + Date.now()
        const phone = '139' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0')

        const user = await prisma.users.create({
            data: {
                name: testName,
                phone,
                email: testName + '@test.com',
                createdAt: now,
                updatedAt: now,
            }
        })

        const found = await prisma.users.findFirst({
            where: { name: testName },
            select: { id: true, name: true, createdAt: true }
        })

        const diff = Math.abs((found?.createdAt?.getTime() || 0) - now.getTime())
        expect(diff).toBeLessThan(1000)

        await prisma.users.delete({ where: { id: user.id } }).catch(() => {})
    })
})
