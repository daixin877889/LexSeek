import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
    server: {
        allowedHosts: true  // 允许所有主机
    },
    resolve: {
        alias: {
            '~~/': resolve(__dirname, './') + '/',
            '~~': resolve(__dirname, './'),
            '@/': resolve(__dirname, './') + '/',
            '@': resolve(__dirname, './')
        }
    },
    test: {
        include: ['**/*.test.ts'],
        exclude: ['node_modules', '.nuxt'],
        testTimeout: 60000,  // 60秒超时
    },
})
