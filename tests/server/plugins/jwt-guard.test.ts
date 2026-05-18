/**
 * JWT 密钥安全校验测试
 *
 * **Feature: jwt-secret-guard**
 */
import { describe, it, expect } from 'vitest'
import { assertJwtSecretConfigured } from '~~/server/utils/jwtSecretGuard'

describe('assertJwtSecretConfigured - JWT 密钥安全校验', () => {
    it('生产环境使用默认弱密钥 → 抛错拒绝启动', () => {
        expect(() => assertJwtSecretConfigured('lexseek_jwt_secret', 'production')).toThrow()
    })

    it('生产环境使用强随机密钥 → 通过', () => {
        expect(() => assertJwtSecretConfigured('s3cure-random-key-9f8a7b', 'production')).not.toThrow()
    })

    it('开发环境使用默认密钥 → 通过（仅本地开发允许）', () => {
        expect(() => assertJwtSecretConfigured('lexseek_jwt_secret', 'development')).not.toThrow()
    })

    it('NODE_ENV 未设置时使用默认密钥 → 通过（非生产不强制）', () => {
        expect(() => assertJwtSecretConfigured('lexseek_jwt_secret', undefined)).not.toThrow()
    })
})
