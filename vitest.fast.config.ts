/**
 * vitest 快速测试配置（开发期高频用）
 *
 * 跑明确不依赖 Nuxt env 的服务端 + shared 测试子集，environment='node'，
 * 避开 happy-dom 启动开销 + nuxt prepare（主配置那 ~25s/worker 的 setup 大头都消失）。
 *
 * 用法：
 *   bun run test:fast              # 默认 4 worker
 *   VITEST_MAX_WORKERS=8 bun run test:fast
 *
 * 复用 tests/_infra/ 的 globalSetup / worker-setup（database-per-worker 隔离）。
 *
 * 全量测试（含 client / app / nuxt-deps server）仍用 vitest.config.ts。
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { config } from 'dotenv'

const rootDir = resolve(__dirname)
const appDir = resolve(rootDir, 'app')
const sharedDir = resolve(rootDir, 'shared')
const serverDir = resolve(rootDir, 'server')

// 全局加载测试环境变量（与主 vitest.config.ts 保持一致）
config({ path: resolve(rootDir, '.env.testing') })

export default defineConfig({
    root: rootDir,
    test: {
        globalSetup: ['./tests/_infra/global-setup.ts'],
        environment: 'node',
        // worker-setup 复用主配置：注入 globalThis.prisma / logger / 14 个枚举常量
        setupFiles: ['./tests/_infra/worker-setup.ts'],
        include: [
            // 共享类型测试（纯函数）
            'tests/shared/types/**/*.test.ts',

            // 服务端业务模块：实测 fast 子集 isolated 全 pass 的目录
            'tests/server/membership/**/*.test.ts',
            'tests/server/redemption/**/*.test.ts',
            'tests/server/users/**/*.test.ts',
            'tests/server/audit/**/*.test.ts',
            'tests/server/cron/**/*.test.ts',
            'tests/server/legal/**/*.test.ts',
            'tests/server/system/**/*.test.ts',
            'tests/server/security/**/*.test.ts',
            'tests/server/product/**/*.test.ts',
            'tests/server/utils/**/*.test.ts',
            'tests/server/dashboard.test.ts',
        ],
        exclude: [
            '**/node_modules/**',
            '**/.nuxt/**',
            '**/.worktrees/**',
            // 主配置已 exclude 的
            '**/tests/server/api/**',
            '**/tests/eval/fixtures/buildFixture.test.ts',
            // 业务代码间接用 useRuntimeConfig 的 utils 子集（jwt / redis）
            '**/tests/server/utils/jwt.test.ts',
            '**/tests/server/utils/jwt.coverage.test.ts',
            '**/tests/server/utils/redis.test.ts',
        ],
        testTimeout: 120000,
        fileParallelism: true,
        pool: 'forks',
        // 默认 4 worker：fast 子集只有 ~86 文件，并发收益不抵 8 worker setup overhead（实测 4w=21s vs 8w=52s）
        maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 4),
        minWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 4),
        isolate: true,
        // 收窄 inline：node env 下不需要把整个项目 inline，只让 ts 别名转换走 vite
        server: {
            deps: {
                inline: [
                    '#shared/**',
                ],
            },
        },
    },
    resolve: {
        alias: {
            '#shared': sharedDir,
            '#shared/*': resolve(sharedDir, '*'),
            '~~': rootDir,
            '~~/*': resolve(rootDir, '*'),
            // ~/server 需在 ~ 之前匹配
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
