/**
 * 短信验证码 API 测试
 *
 * 测试短信验证码发送相关 API
 * 所有验证码发送都通过 API 完成
 *
 * **Feature: api-integration-tests**
 * **Validates: Requirements 3.1, 3.2, 3.3**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    createTestHelper,
    connectTestDb,
    disconnectTestDb,
    testPrisma,
    SmsType,
} from './test-api-helpers'

describe('短信验证码 API 测试', () => {
    const helper = createTestHelper()
    const client = helper.getClient()

    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    afterEach(async () => {
        await helper.cleanup()
    })

    describe('POST /api/v1/sms/send', () => {
        it('应能发送验证码到有效手机号', async () => {
            const phone = helper.generatePhone()

            // 通过 API 发送验证码
            const response = await client.post('/api/v1/sms/send', {
                phone,
                type: SmsType.LOGIN,
            })

            expect(response.success).toBe(true)
            expect(response.message).toBe('发送成功')
            expect(response.data.expiredAt).toBeDefined()

            // 验证数据库中有验证码记录（数据验证可以查数据库）
            const record = await testPrisma.smsRecords.findFirst({
                where: { phone, type: SmsType.LOGIN },
            })
            expect(record).not.toBeNull()
            expect(record?.code).toBeDefined()

            // 清理
            await testPrisma.smsRecords.deleteMany({ where: { phone } })
        })

        it('应拒绝短时间内重复发送验证码', async () => {
            const phone = helper.generatePhone()

            // 第一次通过 API 发送
            const firstResponse = await client.post('/api/v1/sms/send', {
                phone,
                type: SmsType.LOGIN,
            })
            expect(firstResponse.success).toBe(true)

            // 立即再次通过 API 发送
            const secondResponse = await client.post('/api/v1/sms/send', {
                phone,
                type: SmsType.LOGIN,
            })

            expect(secondResponse.success).toBe(false)
            expect(secondResponse.message).toContain('频率')

            // 清理
            await testPrisma.smsRecords.deleteMany({ where: { phone } })
        })

        it('应拒绝无效手机号格式', async () => {
            const invalidPhones = [
                '1234567890',    // 不是 1 开头
                '12345678901',   // 第二位不是 3-9
                '138001380001',  // 超过 11 位
                '1380013800',    // 少于 11 位
                'abcdefghijk',   // 非数字
            ]

            for (const phone of invalidPhones) {
                const response = await client.post('/api/v1/sms/send', {
                    phone,
                    type: SmsType.LOGIN,
                })

                expect(response.success).toBe(false)
            }
        })

        it('应支持不同类型的验证码', async () => {
            const phone = helper.generatePhone()
            const types = [SmsType.LOGIN, SmsType.REGISTER, SmsType.RESET_PASSWORD]

            for (const type of types) {
                // 清理之前的记录（数据清理可以操作数据库）
                await testPrisma.smsRecords.deleteMany({ where: { phone, type } })

                // 通过 API 发送验证码
                const response = await client.post('/api/v1/sms/send', {
                    phone,
                    type,
                })

                expect(response.success).toBe(true)

                // 等待一小段时间避免频率限制
                await new Promise(resolve => setTimeout(resolve, 100))
            }

            // 清理
            await testPrisma.smsRecords.deleteMany({ where: { phone } })
        })

        it('应拒绝无效的验证码类型', async () => {
            const phone = helper.generatePhone()

            const response = await client.post('/api/v1/sms/send', {
                phone,
                type: 'invalid_type',
            })

            expect(response.success).toBe(false)
        })
    })
})
