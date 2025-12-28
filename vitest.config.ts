import { defineVitestConfig } from '@nuxt/test-utils/config'
import { fileURLToPath } from 'node:url'

export default defineVitestConfig({
    test: {
        // 为服务端测试启用 Nuxt 环境，支持自动导入
        environment: 'nuxt',
        environmentOptions: {
            nuxt: {
                rootDir: fileURLToPath(new URL('./', import.meta.url)),
                domEnvironment: 'happy-dom',
                // 尝试启用完整的 Nuxt 配置
                overrides: {
                    // 确保 Nitro 的自动导入配置被加载
                }
            }
        },
        include: ['**/*.test.ts'],
        exclude: ['node_modules', '.nuxt'],
        testTimeout: 60000,  // 60秒超时
        setupFiles: ['./tests/server/membership/test-setup.ts'],
    },
})
