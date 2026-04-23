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
    // 显式设置 root 为项目根目录，使 reportsDirectory 等相对路径正确解析
    root: rootDir,
    test: {
        // 全局清理：所有测试文件结束后清理残留数据
        globalSetup: ['./tests/global-teardown.ts'],
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
            // 排除所有 git worktree 目录下的测试（避免并发 worktree 的旧代码串进主测试结果）
            '**/.worktrees/**',
            '**/tests/server/api/**',
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
        // 配置依赖项处理（inline 移到 server.deps 下）
        server: {
            deps: {
                inline: [
                    '#shared/**',
                    '~~/**',
                    '~/**',
                    '@/**',
                    '@@/**',
                ],
            },
        },
        // Vitest 4 要求 coverage 位于 test.coverage 下（旧的顶层写法在 defineVitestConfig 下部分情况会失效）
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'json-summary', 'html'],
            // 使用绝对路径，因为 vitest 在 Nuxt 环境下以 app/ 为 root，相对路径会找不到 server/ 和 shared/
            reportsDirectory: resolve(rootDir, 'coverage'),
            // 使用函数过滤排除不需要的文件（处理绝对路径）
            // v8 provider 的 exclude 使用 glob 模式，但 vitest 的 root 已改为项目根目录
            // 排除静态页面、图标组件、静态资源和服务器目录
            exclude: [
                // 基础排除
                '**/node_modules/**',
                '**/.nuxt/**',
                '**/generated/**',
                '**/*.test.ts',
                '**/test-db-helper.ts',
                '**/tests/**',
                '**/vitest.config.ts',
                '**/.env*',
                '**/tailwind.css',
                // 排除静态页面（纯 UI，无可测试逻辑）
                '**/app/pages/**',
                // 排除纯 UI 图标组件
                '**/app/components/icons/**',
                // 排除静态资源
                '**/app/assets/**',
                // 排除 lucideIcons
                '**/lucideIcons.ts',
                // 排除纯外部 SDK 包装（无业务逻辑）
                '**/server/lib/aliSms.ts',
                // 排除纯类型声明文件（无可执行代码）
                '**/*.d.ts',
                // 排除纯 re-export / alias 模块（无业务逻辑，覆盖率工具会误报 0%）
                '**/shared/utils/logger.ts',
                '**/shared/utils/toast.ts',
                '**/shared/utils/zod.ts',
                '**/shared/utils/logger/transports/index.ts',
                '**/shared/utils/tools/utils/index.ts',
                '**/shared/types/prisma.ts',
                // server/services/sse/index.ts 是一个纯注释占位文件（无导出、无逻辑）
                '**/server/services/sse/index.ts',
                // 排除 Canvas/Image 依赖的浏览器专用工具（在 happy-dom 下无法真实测试）
                '**/shared/utils/tools/imageWatermarkService.ts',
                // 排除 LangGraph 编排/Agent 运行态代码：这些是"真运行"才能覆盖的集成代码
                // （依赖模型提供商、checkpointer、外部 AI 服务），对应的整链路集成测试
                // 已在 tests/server/workflow/caseAnalysis.workflow.test.ts 存在但因 Nuxt
                // 自动导入限制被 exclude 掉。在单元测试层面强行覆盖只会产生大量打桩，
                // 没有实际价值。真正的回归保护由 E2E 测试承担。
                '**/server/services/workflow/caseAnalysisV2.workflow.ts',
                '**/server/services/workflow/caseAnalysisV2.executor.ts',
                '**/server/services/workflow/agents/caseAnalysis.ts',
                '**/server/services/workflow/agents/moduleAgent.ts',
                // workflow/state/storage.ts：checkpointer 的轻量 Storage 适配，
                // 依赖 LangGraph checkpoint 运行态，不在单测范围
                '**/server/services/workflow/state/storage.ts',
            ],
            // 只包含 app / shared / server 目录
            include: [
                resolve(rootDir, 'app/**/*.{ts,vue}'),
                resolve(rootDir, 'shared/**/*.{ts,js}'),
                resolve(rootDir, 'server/**/*.{ts,js}'),
            ],
            thresholds: {
                // 适度调低阈值，聚焦可测试代码的覆盖
                lines: 80,
                functions: 80,
                branches: 80,
                statements: 80,
                // 每个文件的阈值（低值文件不触发失败）
                perFile: false,
            },
        },
    },
    // Vite 配置用于解析别名
    resolve: {
        alias: {
            '#shared': sharedDir,
            '#shared/*': resolve(sharedDir, '*'),
            '~~': rootDir,
            '~~/*': resolve(rootDir, '*'),
            // 注意：~/server 需在 ~ 之前匹配，以便 server 代码中的 import 正确解析
            '~/server': serverDir,
            '~': appDir,
            '~/*': resolve(appDir, '*'),
            '@': appDir,
            '@/*': resolve(appDir, '*'),
            '@@': rootDir,
            '@@/*': resolve(rootDir, '*'),
        },
    },
})
