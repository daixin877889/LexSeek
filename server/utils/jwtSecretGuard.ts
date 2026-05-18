/**
 * JWT 密钥安全校验
 *
 * 默认密钥 'lexseek_jwt_secret' 写死在 nuxt.config.ts 并随代码仓库公开，
 * 生产环境若漏配 NUXT_JWT_SECRET 会沿用它，导致任何人都能伪造登录态。
 */

/** nuxt.config.ts runtimeConfig.jwt.secret 的默认值，仅允许本地开发使用 */
export const INSECURE_DEFAULT_JWT_SECRET = 'lexseek_jwt_secret'

/**
 * 校验 JWT 密钥：生产环境禁止使用默认弱密钥，违反时抛错以阻止启动。
 */
export function assertJwtSecretConfigured(secret: string, nodeEnv: string | undefined): void {
    if (nodeEnv === 'production' && secret === INSECURE_DEFAULT_JWT_SECRET) {
        throw new Error(
            '生产环境检测到默认 JWT 密钥，已拒绝启动：请将环境变量 NUXT_JWT_SECRET 配置为强随机值。',
        )
    }
}
