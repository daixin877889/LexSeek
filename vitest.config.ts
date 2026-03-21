import { defineVitestConfig } from '@nuxt/test-utils/config'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'

// 全局加载测试环境变量
config({ path: resolve(__dirname, '.env.testing') })

// 项目根目录
const rootDir = resolve(__dirname)
const appDir = resolve(rootDir, 'app')
const sharedDir = resolve(rootDir, 'shared')
const serverDir = resolve(rootDir, 'server')
const generatedDir = resolve(rootDir, 'generated')

// 创建全局 Prisma 客户端
const createGlobalPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const adapter = new PrismaPg({
        connectionString,
        options: '-c TimeZone=UTC',
    })
    return new PrismaClient({ adapter })
}

// 延迟初始化
let _prisma: ReturnType<typeof createGlobalPrisma> | null = null
const getGlobalPrisma = () => {
    if (!_prisma) {
        _prisma = createGlobalPrisma()
    }
    return _prisma
}

export default defineVitestConfig({
    test: {
        // 使用 nuxt 环境
        environment: 'nuxt',
        environmentOptions: {
            nuxt: {
                rootDir: fileURLToPath(new URL('./', import.meta.url)),
                domEnvironment: 'happy-dom',
            }
        },
        // 排除需要特殊设置的测试
        exclude: [
            '**/node_modules/**',
            '**/.nuxt/**',
            '**/tests/server/api/**',
            '**/tests/client/**',
            // 排除需要 Nuxt 自动导入完整支持的测试
            '**/tests/server/case/case.service.test.ts',
            '**/tests/server/case/case.dao.test.ts',
            '**/tests/server/case/caseMaterialEmbedding.service.test.ts',
            '**/tests/server/case/caseMaterial.service.test.ts',
            '**/tests/server/material/embedding-status-fix.test.ts',
            '**/tests/server/workflow/caseAnalysis.workflow.test.ts',
            '**/tests/server/services/material/ocr.service.integration.test.ts',
            '**/tests/server/services/material/ocr.property.test.ts',
        ],
        include: ['**/*.test.ts'],
        testTimeout: 120000,
        setupFiles: ['./tests/server/membership/test-setup.ts'],
        fileParallelism: false,
        // 配置依赖项处理
        deps: {
            // 将 Nuxt 别名模块内联处理
            inline: [
                '#shared/**',
                '~~/**',
                '~/**',
                '@/**',
                '@@/**',
            ],
        },
    },
    // 覆盖率配置（放在顶层）
    coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        reportsDirectory: './coverage',
        exclude: [
            '**/node_modules/**',
            '**/.nuxt/**',
            '**/generated/**',
            '**/*.test.ts',
            '**/test-db-helper.ts',
            '**/tests/**',
            '**/vitest.config.ts',
            '**/.env*',
        ],
        // 仅覆盖 server 和 shared 目录（项目业务代码）
        include: [
            'server/**/*.ts',
            'shared/**/*.ts',
        ],
        thresholds: {
            lines: 95,
            functions: 95,
            branches: 95,
            statements: 95,
        },
    },
    // Vite 配置用于解析别名
    resolve: {
        alias: {
            '#shared': sharedDir,
            '#shared/*': resolve(sharedDir, '*'),
            '~~': rootDir,
            '~~/*': resolve(rootDir, '*'),
            '~': appDir,
            '~/*': resolve(appDir, '*'),
            '@': appDir,
            '@/*': resolve(appDir, '*'),
            '@@': rootDir,
            '@@/*': resolve(rootDir, '*'),
        },
    },
})
