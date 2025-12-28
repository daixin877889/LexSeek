/**
 * 加密配置 API 测试
 *
 * 测试加密配置 CRUD、恢复密钥相关 API
 * 用户创建通过注册 API 完成
 * 加密配置通过 API 创建/更新
 *
 * **Feature: api-integration-tests**
 * **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    createTestHelper,
    connectTestDb,
    disconnectTestDb,
    testPrisma,
} from './test-api-helpers'

describe('加密配置 API 测试', () => {
    const helper = createTestHelper()
    const client = helper.getClient()

    // 测试用的 Age 公钥和加密私钥（仅用于测试）
    const testRecipient = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p'
    const testEncryptedIdentity = 'YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IHNjcnlwdCBzb21lLXNhbHQgMTgKdGVzdC1lbmNyeXB0ZWQtaWRlbnRpdHkK'
    const testEncryptedRecoveryKey = 'YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IHNjcnlwdCBzb21lLXNhbHQgMTgKdGVzdC1yZWNvdmVyeS1rZXkK'

    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    afterEach(async () => {
        await helper.cleanup()
    })

    describe('获取加密配置测试', () => {
        it('未认证用户获取加密配置应返回错误', async () => {
            const response = await client.get('/api/v1/encryption/config')

            expect(response.success).toBe(false)
            // 检查业务错误码
            expect(response.code).toBe(401)
        })

        it('新用户获取加密配置应返回 null', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/encryption/config')

            expect(response.success).toBe(true)
            expect(response.data).toBeNull()
        })

        it('已配置用户应能获取加密配置', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()

            // 通过 API 创建加密配置
            const createResponse = await client.post('/api/v1/encryption/config', {
                recipient: testRecipient,
                encryptedIdentity: testEncryptedIdentity,
            })
            expect(createResponse.success).toBe(true)

            // 通过 API 获取加密配置
            const response = await client.get('/api/v1/encryption/config')

            expect(response.success).toBe(true)
            expect(response.data).toHaveProperty('recipient')
            expect(response.data).toHaveProperty('encryptedIdentity')
            expect(response.data).toHaveProperty('hasRecoveryKey')
            expect(response.data.recipient).toBe(testRecipient)
            expect(response.data.hasRecoveryKey).toBe(false)

            // 清理（数据清理可以操作数据库）
            await testPrisma.userEncryptions.delete({
                where: { userId: user.id },
            })
        })
    })

    describe('保存加密配置测试', () => {
        it('未认证用户保存加密配置应返回错误', async () => {
            const response = await client.post('/api/v1/encryption/config', {
                recipient: testRecipient,
                encryptedIdentity: testEncryptedIdentity,
            })

            expect(response.success).toBe(false)
            // 检查业务错误码
            expect(response.code).toBe(401)
        })

        it('已认证用户应能保存加密配置', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()

            // 通过 API 保存加密配置
            const response = await client.post('/api/v1/encryption/config', {
                recipient: testRecipient,
                encryptedIdentity: testEncryptedIdentity,
            })

            expect(response.success).toBe(true)

            // 验证数据库中的记录（数据验证可以查数据库）
            const config = await testPrisma.userEncryptions.findUnique({
                where: { userId: user.id },
            })
            expect(config).not.toBeNull()
            expect(config?.recipient).toBe(testRecipient)

            // 清理
            await testPrisma.userEncryptions.delete({
                where: { userId: user.id },
            })
        })

        it('应能保存带恢复密钥的加密配置', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()

            // 通过 API 保存带恢复密钥的加密配置
            const response = await client.post('/api/v1/encryption/config', {
                recipient: testRecipient,
                encryptedIdentity: testEncryptedIdentity,
                encryptedRecoveryKey: testEncryptedRecoveryKey,
            })

            expect(response.success).toBe(true)

            // 验证数据库中的记录（数据验证可以查数据库）
            const config = await testPrisma.userEncryptions.findUnique({
                where: { userId: user.id },
            })
            expect(config?.encryptedRecoveryKey).toBe(testEncryptedRecoveryKey)

            // 清理
            await testPrisma.userEncryptions.delete({
                where: { userId: user.id },
            })
        })

        it('无效公钥格式应返回错误', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.post('/api/v1/encryption/config', {
                recipient: 'invalid-public-key',
                encryptedIdentity: testEncryptedIdentity,
            })

            expect(response.success).toBe(false)
            // 服务器可能返回 400 或 500
        })

        it('缺少必要参数应返回错误', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.post('/api/v1/encryption/config', {
                recipient: testRecipient,
                // 缺少 encryptedIdentity
            })

            expect(response.success).toBe(false)
            // 服务器可能返回 400 或 500
        })
    })

    describe('更新加密配置测试', () => {
        it('应能更新已有的加密配置', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()

            // 通过 API 创建配置
            await client.post('/api/v1/encryption/config', {
                recipient: testRecipient,
                encryptedIdentity: testEncryptedIdentity,
            })

            // 通过 API 更新配置
            const newEncryptedIdentity = 'bmV3LWVuY3J5cHRlZC1pZGVudGl0eQ=='
            const response = await client.post('/api/v1/encryption/config', {
                recipient: testRecipient,
                encryptedIdentity: newEncryptedIdentity,
            })

            expect(response.success).toBe(true)

            // 验证更新（数据验证可以查数据库）
            const config = await testPrisma.userEncryptions.findUnique({
                where: { userId: user.id },
            })
            expect(config?.encryptedIdentity).toBe(newEncryptedIdentity)

            // 清理
            await testPrisma.userEncryptions.delete({
                where: { userId: user.id },
            })
        })
    })

    describe('恢复密钥测试', () => {
        it('未认证用户获取恢复密钥应返回错误', async () => {
            const response = await client.get('/api/v1/encryption/recovery-key')

            expect(response.success).toBe(false)
            // 检查业务错误码
            expect(response.code).toBe(401)
        })

        it('未配置加密的用户获取恢复密钥应返回错误', async () => {
            // 通过 API 注册用户
            await helper.createAndLoginUser()

            const response = await client.get('/api/v1/encryption/recovery-key')

            expect(response.success).toBe(false)
            // 检查业务错误码
            expect(response.code).toBe(404)
        })

        it('未设置恢复密钥的用户应返回错误', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()

            // 通过 API 创建不带恢复密钥的配置
            await client.post('/api/v1/encryption/config', {
                recipient: testRecipient,
                encryptedIdentity: testEncryptedIdentity,
            })

            const response = await client.get('/api/v1/encryption/recovery-key')

            expect(response.success).toBe(false)
            // 检查业务错误码
            expect(response.code).toBe(400)

            // 清理
            await testPrisma.userEncryptions.delete({
                where: { userId: user.id },
            })
        })

        it('已设置恢复密钥的用户应能获取', async () => {
            // 通过 API 注册用户
            const user = await helper.createAndLoginUser()

            // 通过 API 创建带恢复密钥的配置
            await client.post('/api/v1/encryption/config', {
                recipient: testRecipient,
                encryptedIdentity: testEncryptedIdentity,
                encryptedRecoveryKey: testEncryptedRecoveryKey,
            })

            // 通过 API 获取恢复密钥
            const response = await client.get('/api/v1/encryption/recovery-key')

            expect(response.success).toBe(true)
            expect(response.data).toHaveProperty('encryptedRecoveryKey')
            expect(response.data.encryptedRecoveryKey).toBe(testEncryptedRecoveryKey)

            // 清理
            await testPrisma.userEncryptions.delete({
                where: { userId: user.id },
            })
        })
    })
})
