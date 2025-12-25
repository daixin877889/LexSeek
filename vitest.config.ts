import { defineConfig } from 'vitest/config'

export default defineConfig({
    server: {
        allowedHosts: true  // 允许所有主机
    },
    test: {
        include: ['**/*.test.ts'],
        exclude: ['node_modules', '.nuxt'],
        testTimeout: 60000,  // 60秒超时
    },
})
