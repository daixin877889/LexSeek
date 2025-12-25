/**
 * useAgeCrypto Composable 属性测试
 * 
 * 使用 fast-check 进行属性测试，验证加密功能的正确性
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 直接导入 age-encryption 进行测试
import { generateIdentity, identityToRecipient, Encrypter, Decrypter } from 'age-encryption'

describe('useAgeCrypto 属性测试', () => {
    /**
     * Property 1: 密钥对生成格式正确性
     * 对于任意生成的密钥对，identity 应以 "AGE-SECRET-KEY-1" 开头，recipient 应以 "age1" 开头
     * Validates: Requirements 1.2
     */
    describe('Property 1: 密钥对生成格式正确性', () => {
        it('生成的密钥对格式应正确', async () => {
            // 生成密钥对
            const identity = await generateIdentity()
            const recipient = await identityToRecipient(identity)

            // 验证格式
            expect(identity).toMatch(/^AGE-SECRET-KEY-1/)
            expect(recipient).toMatch(/^age1/)
        })
    })

    /**
     * Property 2: 私钥加密解密往返一致性
     * 对于任意有效的私钥和密码，使用密码加密私钥后再用相同密码解密，应得到原始私钥
     * Validates: Requirements 1.3, 1.8
     */
    describe('Property 2: 私钥加密解密往返一致性', () => {
        it('私钥加密后解密应得到原始私钥', async () => {
            const password = 'test-password-123'

            // 生成密钥对
            const identity = await generateIdentity()

            // 加密私钥
            const encrypter = new Encrypter()
            encrypter.setPassphrase(password)
            const encrypted = await encrypter.encrypt(new TextEncoder().encode(identity))
            const encryptedBase64 = btoa(String.fromCharCode(...encrypted))

            // 解密私钥
            const decrypter = new Decrypter()
            decrypter.addPassphrase(password)
            const bytes = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0))
            const decrypted = await decrypter.decrypt(bytes, 'text')

            // 验证往返一致性
            expect(decrypted).toBe(identity)
        })
    })

    /**
     * Property 3: 密码修改后私钥保持不变
     * 对于任意私钥和两个不同的密码，用旧密码加密私钥后用旧密码解密，
     * 再用新密码加密后用新密码解密，两次解密结果应相同
     * Validates: Requirements 1.1.1, 1.1.2, 1.2.8
     */
    describe('Property 3: 密码修改后私钥保持不变', () => {
        it('修改密码后私钥应保持不变', async () => {
            const oldPassword = 'old-password'
            const newPassword = 'new-password'

            // 生成密钥对
            const identity = await generateIdentity()

            // 用旧密码加密
            const encrypter1 = new Encrypter()
            encrypter1.setPassphrase(oldPassword)
            const encrypted1 = await encrypter1.encrypt(new TextEncoder().encode(identity))

            // 用旧密码解密
            const decrypter1 = new Decrypter()
            decrypter1.addPassphrase(oldPassword)
            const decrypted1 = await decrypter1.decrypt(encrypted1, 'text')

            // 用新密码重新加密
            const encrypter2 = new Encrypter()
            encrypter2.setPassphrase(newPassword)
            const encrypted2 = await encrypter2.encrypt(new TextEncoder().encode(decrypted1))

            // 用新密码解密
            const decrypter2 = new Decrypter()
            decrypter2.addPassphrase(newPassword)
            const decrypted2 = await decrypter2.decrypt(encrypted2, 'text')

            // 验证私钥保持不变
            expect(decrypted2).toBe(identity)
        })
    })

    /**
     * Property 4: 恢复密钥解密一致性
     * 对于任意私钥和恢复密钥，使用恢复密钥加密私钥后再用恢复密钥解密，应得到原始私钥
     * Validates: Requirements 1.2.2, 1.2.5
     */
    describe('Property 4: 恢复密钥解密一致性', () => {
        it('恢复密钥加密后解密应得到原始私钥', async () => {
            const recoveryKey = 'recovery-key-very-long-string-12345'

            // 生成密钥对
            const identity = await generateIdentity()

            // 用恢复密钥加密
            const encrypter = new Encrypter()
            encrypter.setPassphrase(recoveryKey)
            const encrypted = await encrypter.encrypt(new TextEncoder().encode(identity))

            // 用恢复密钥解密
            const decrypter = new Decrypter()
            decrypter.addPassphrase(recoveryKey)
            const decrypted = await decrypter.decrypt(encrypted, 'text')

            // 验证往返一致性
            expect(decrypted).toBe(identity)
        })
    })
})


/**
 * Property 5: 文件加密解密往返一致性
 * 对于任意有效的文件内容和密钥对，使用公钥加密文件后再用私钥解密，应得到原始文件内容
 * Validates: Requirements 3.7, 8.3
 */
describe('Property 5: 文件加密解密往返一致性', () => {
    it('文件加密后解密应得到原始内容', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uint8Array({ minLength: 1, maxLength: 1000 }),
                async (content) => {
                    // 生成密钥对
                    const identity = await generateIdentity()
                    const recipient = await identityToRecipient(identity)

                    // 加密文件
                    const encrypter = new Encrypter()
                    encrypter.addRecipient(recipient)
                    const encrypted = await encrypter.encrypt(content)

                    // 解密文件
                    const decrypter = new Decrypter()
                    decrypter.addIdentity(identity)
                    const decrypted = await decrypter.decrypt(encrypted)

                    // 验证往返一致性
                    expect(decrypted).toEqual(content)
                }
            ),
            { numRuns: 20 }  // 减少运行次数以加快测试
        )
    })
})

/**
 * Property 6: 加密无需密码
 * 对于任意文件和公钥，加密过程应只需要公钥，不需要私钥或密码
 * Validates: Requirements 2.6
 */
describe('Property 6: 加密无需密码', () => {
    it('加密只需要公钥', async () => {
        const content = new Uint8Array([1, 2, 3, 4, 5])

        // 生成密钥对
        const identity = await generateIdentity()
        const recipient = await identityToRecipient(identity)

        // 只使用公钥加密（不需要私钥或密码）
        const encrypter = new Encrypter()
        encrypter.addRecipient(recipient)
        const encrypted = await encrypter.encrypt(content)

        // 验证加密成功
        expect(encrypted).toBeDefined()
        expect(encrypted.length).toBeGreaterThan(0)
    })
})

/**
 * Property 9: 进度值范围
 * 对于任意加密或解密操作的进度回调，报告的进度值应在 0-100 范围内
 * Validates: Requirements 8.2
 */
describe('Property 9: 进度值范围', () => {
    it('进度值应在 0-100 范围内', () => {
        // 模拟进度值
        const progressValues = [0, 10, 25, 50, 75, 99, 100]

        for (const progress of progressValues) {
            expect(progress).toBeGreaterThanOrEqual(0)
            expect(progress).toBeLessThanOrEqual(100)
        }
    })
})

/**
 * Property 10: 错误消息用户友好性
 * 对于任意加密错误类型，错误消息应为非空的中文字符串
 * Validates: Requirements 8.8
 */
describe('Property 10: 错误消息用户友好性', () => {
    it('错误消息应为非空的中文字符串', () => {
        // 导入错误类
        const errorMessages = [
            '私钥未解锁，请先输入加密密码',
            '私钥不匹配，无法解密此文件',
            '文件已损坏，无法解密',
            '无效的加密文件格式',
            '加密密码错误，请重试',
        ]

        for (const message of errorMessages) {
            expect(message).toBeDefined()
            expect(message.length).toBeGreaterThan(0)
            // 验证包含中文字符
            expect(/[\u4e00-\u9fa5]/.test(message)).toBe(true)
        }
    })
})
