/**
 * JWT 密钥安全校验插件：启动时拦截生产环境的默认弱密钥配置。
 */
import { assertJwtSecretConfigured } from '~~/server/utils/jwtSecretGuard'

export default defineNitroPlugin(() => {
    const config = useRuntimeConfig()
    assertJwtSecretConfigured(config.jwt.secret, process.env.NODE_ENV)
})
