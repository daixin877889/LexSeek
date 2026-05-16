import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { resolveContractExportSignatureService } from '~~/server/services/users/contractSignature.service'

const createdIds: number[] = []

async function createUser(name: string, signature: string | null) {
    // 手机号：139 + 7 位时间戳尾段 + 序号，11 位且并发不碰撞
    const phone = `139${String(Date.now()).slice(-7)}${createdIds.length}`
    const u = await prisma.users.create({
        data: { name, phone, contractExportSignature: signature },
    })
    createdIds.push(u.id)
    return u
}

afterEach(async () => {
    if (createdIds.length) {
        await prisma.users.deleteMany({ where: { id: { in: createdIds } } })
        createdIds.length = 0
    }
})

describe('resolveContractExportSignatureService', () => {
    it('设置了署名时返回署名', async () => {
        const u = await createUser('张三', '张三律师')
        expect(await resolveContractExportSignatureService(u.id)).toBe('张三律师')
    })

    it('署名为空白时回退账号姓名', async () => {
        const u = await createUser('李四', '   ')
        expect(await resolveContractExportSignatureService(u.id)).toBe('李四')
    })

    it('未设置署名时回退账号姓名', async () => {
        const u = await createUser('王五', null)
        expect(await resolveContractExportSignatureService(u.id)).toBe('王五')
    })

    it('用户不存在时返回安全默认值', async () => {
        expect(await resolveContractExportSignatureService(999999999)).toBe('审查人')
    })
})
