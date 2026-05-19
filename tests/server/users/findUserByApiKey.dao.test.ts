/**
 * findUserByApiKeyDao 真实数据库测试
 *
 * 验证对外接口 apiKey 鉴权的数据层：归属过滤（软删除用户不可被查出）、
 * 字段投影（只返回 id / status，不泄露其他信息）。
 *
 * **Feature: open-api-auth**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { findUserByApiKeyDao } from '~~/server/services/users/users.dao'
import { UserStatus } from '#shared/types/user'

const createdUserIds: number[] = []

afterEach(async () => {
    if (createdUserIds.length > 0) {
        await prisma.users.deleteMany({ where: { id: { in: createdUserIds } } })
        createdUserIds.length = 0
    }
})

/** 建一个测试用户，phone 带时间戳 + 随机后缀避免唯一冲突；apiKey 由数据库默认生成 */
async function makeUser(status: number = UserStatus.ACTIVE) {
    const phone = `1${String(Date.now()).slice(-6)}${Math.floor(1000 + Math.random() * 9000)}`
    const user = await prisma.users.create({
        data: { name: 'apikey-dao-test', phone, status },
    })
    createdUserIds.push(user.id)
    return user
}

describe('findUserByApiKeyDao · apiKey 用户查询（真实数据库）', () => {
    it('用有效 apiKey 能查到对应用户', async () => {
        const user = await makeUser()
        const found = await findUserByApiKeyDao(user.apiKey!)
        expect(found?.id).toBe(user.id)
    })

    it('apiKey 不存在 → 返回 null', async () => {
        const found = await findUserByApiKeyDao('00000000-0000-0000-0000-000000000000')
        expect(found).toBeNull()
    })

    it('软删除用户即使 apiKey 正确也查不到（鉴权安全网）', async () => {
        const user = await makeUser()
        await prisma.users.update({ where: { id: user.id }, data: { deletedAt: new Date() } })
        const found = await findUserByApiKeyDao(user.apiKey!)
        expect(found).toBeNull()
    })

    it('禁用用户仍可查到，并如实返回 status 供中间件判断', async () => {
        const user = await makeUser(UserStatus.INACTIVE)
        const found = await findUserByApiKeyDao(user.apiKey!)
        expect(found?.id).toBe(user.id)
        expect(found?.status).toBe(UserStatus.INACTIVE)
    })

    it('只返回 id 与 status 两个字段（不泄露其他用户信息）', async () => {
        const user = await makeUser()
        const found = await findUserByApiKeyDao(user.apiKey!)
        expect(found).not.toBeNull()
        expect(Object.keys(found!).sort()).toEqual(['id', 'status'])
    })

    it('apiKey 为非 UUID 字符串 → DAO 抛错（api_key 为 uuid 列，拒绝非法输入）', async () => {
        // DAO 不做格式兜底，非法 apiKey 会冒泡为异常。
        // 02.auth 中间件已在调用前用 z.string().uuid() 校验格式，非法 key 不会进到这里。
        await expect(findUserByApiKeyDao('not-a-valid-uuid')).rejects.toThrow()
    })
})
