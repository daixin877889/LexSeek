# 测试策略

LexSeek 使用 Vitest 作为测试框架，在独立的测试数据库上执行真实的数据库操作（非 mock），配合 fast-check 进行属性测试，覆盖率要求不低于 80%。

## 测试框架与工具

| 工具 | 用途 |
|------|------|
| Vitest | 测试运行器 |
| happy-dom | DOM 环境模拟 |
| fast-check | 属性测试（Property-Based Testing） |
| @nuxt/test-utils | Nuxt 环境集成 |
| pg | 原生 PostgreSQL 连接（用于清理） |

**关键约束**：使用 `npx vitest run` 执行测试（非 `bun test`），因为 Nuxt 自动导入在 vitest 环境下才能正确解析。全量测试使用 `bun run test` 执行。

## 测试数据库

| 配置 | 值 |
|------|-----|
| 数据库名 | `ls_new_testing` |
| 连接串 | `postgresql://daixin:daixin88@localhost:5432/ls_new_testing` |
| 环境变量文件 | `.env.testing` |
| 测试账号 | 手机号 `13064768490`，密码 `daixin88` |

数据库 schema 必须与主库保持同步。同步命令：

```bash
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing' bun run prisma:push --accept-data-loss
```

## vitest.config.ts 关键配置

```typescript
export default defineVitestConfig({
    test: {
        // 全局清理脚本
        globalSetup: ['./tests/global-teardown.ts'],

        // Nuxt 环境 + happy-dom
        environment: 'nuxt',
        environmentOptions: {
            nuxt: { domEnvironment: 'happy-dom' }
        },

        // 超时 120 秒
        testTimeout: 120000,

        // 全局 setup 文件（模拟 Nuxt 自动导入）
        setupFiles: ['./tests/server/membership/test-setup.ts'],

        // 禁用文件并行（避免数据库竞态）
        fileParallelism: false,
    },

    // 覆盖率配置
    coverage: {
        provider: 'v8',
        thresholds: {
            lines: 80,
            functions: 80,
            branches: 80,
            statements: 80,
        },
    },
})
```

**排除列表**：部分需要完整 Nuxt 环境的测试文件被排除在常规运行之外（如 case.service、workflow 等）。

## 测试目录结构

```
tests/
├── server/                    # 服务端测试
│   ├── agent/                # Agent 服务测试
│   ├── auth/                 # 认证测试
│   ├── case/                 # 案件测试
│   ├── crypto/               # 加密测试
│   ├── files/                # 文件服务测试
│   ├── legal/                # 法律服务测试
│   ├── material/             # 材料服务测试
│   ├── membership/           # 会员系统测试
│   ├── model/                # 模型管理测试
│   ├── node/                 # 节点管理测试
│   ├── payment/              # 支付系统测试
│   ├── point/                # 积分系统测试
│   ├── product/              # 产品测试
│   ├── rbac/                 # 权限系统测试
│   ├── redemption/           # 兑换码测试
│   ├── retrieval/            # 检索测试
│   ├── sms/                  # 短信测试
│   ├── sse/                  # SSE 测试
│   ├── storage/              # 存储系统测试
│   ├── system/               # 系统配置测试
│   ├── users/                # 用户测试
│   ├── utils/                # 工具函数测试
│   ├── wechat/               # 微信测试
│   └── workflow/             # 工作流测试
├── shared/                   # 共享代码测试
├── app/                      # 前端测试
├── client/                   # 客户端测试
├── e2e/                      # 端到端测试
├── debug/                    # 调试用测试
└── global-teardown.ts        # 全局清理脚本
```

## 测试助手模式

每个测试模块通常包含三个辅助文件，形成标准化的测试基础设施。

### test-db-helper.ts - 数据库操作助手

职责：创建测试 Prisma 客户端、提供测试数据 CRUD 函数、管理测试数据清理。

**核心模式**：

```typescript
// 1. 独立的测试 Prisma 客户端（PrismaPg 适配器）
const createTestPrismaClient = () => {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
    return new PrismaClient({ adapter })
}

// 2. 懒加载单例
let _testPrisma = null
export const getTestPrisma = () => {
    if (!_testPrisma) _testPrisma = createTestPrismaClient()
    return _testPrisma
}

// 3. 测试数据标记前缀（用于清理时识别）
export const TEST_USER_PHONE_PREFIX = '199'
export const TEST_LEVEL_NAME_PREFIX = '测试级别_'
export const TEST_CODE_PREFIX = 'TEST_'

// 4. 测试 ID 追踪
export interface TestIds {
    userIds: number[]
    membershipLevelIds: number[]
    // ... 所有测试创建的记录 ID
}

// 5. 测试数据创建函数
export const createTestUser = async (data = {}) => { ... }
export const createTestMembershipLevel = async (data = {}) => { ... }

// 6. 清理函数（按外键依赖反序删除）
export const cleanupTestData = async (testIds: TestIds) => { ... }
export const cleanupAllTestData = async () => { ... }

// 7. 连接管理
export const connectTestDb = async () => { ... }
export const disconnectTestDb = async () => { ... }
```

**清理策略**：
- `cleanupTestData(testIds)`：按 ID 精确清理，遵循外键依赖拓扑排序（叶表 -> 父表）
- `cleanupAllTestData()`：按前缀批量清理所有测试数据，用于清理残留数据
- 清理顺序示例：`membershipUpgradeRecords` -> `pointRecords` -> `userMemberships` -> `orders` -> `users`

### test-setup.ts - 环境设置

职责：模拟 Nuxt 自动导入的全局变量，使 Service / DAO 函数可在测试环境中直接运行。

**设置内容**：

```typescript
// 1. 注入全局 prisma 和 logger
;(globalThis as any).prisma = getTestPrisma()
;(globalThis as any).logger = mockLogger

// 2. 注入业务枚举常量
;(globalThis as any).MembershipStatus = { INACTIVE: 0, ACTIVE: 1 }
;(globalThis as any).RedemptionCodeStatus = { VALID: 1, USED: 2, ... }
// ... 其他枚举

// 3. Mock localStorage（happy-dom 可能未提供）
;(globalThis as any).localStorage = { getItem, setItem, ... }

// 4. 重置数据库序列（避免与种子数据冲突）
resetDatabaseSequences()
```

### test-generators.ts - 属性测试数据生成器

职责：使用 fast-check 创建随机但有约束的测试数据生成器。

**约定**：

```typescript
// 标准配置：100 轮 + 确定性 seed
export const PBT_CONFIG = { numRuns: 100, seed: 42 }

// 快速配置（耗时测试）
export const PBT_CONFIG_FAST = { numRuns: 5 }

// 基础生成器
export const chineseNameArb = fc.string({ minLength: 2, maxLength: 10 })
export const validDateArb = fc.date({ ... }).filter(d => !isNaN(d.getTime()))

// 业务生成器
export const membershipLevelDataArb = fc.record({ name, description, sortOrder, status })
export const redemptionCodeDataArb = fc.oneof(membershipOnly, pointsOnly, membershipAndPoints)
```

## 属性测试要点

### Deterministic Seed

所有属性测试必须配置确定性 seed，避免跨运行不稳定：

```typescript
fc.assert(
    fc.property(someArb, (value) => {
        // 测试逻辑
    }),
    { numRuns: 100, seed: 42 }  // 必须指定 seed
)
```

### 日期生成器过滤

日期生成器必须过滤无效日期：

```typescript
const validDateArb = fc.date({
    min: new Date('2024-01-01'),
    max: new Date('2030-12-31'),
}).filter(d => !isNaN(d.getTime()))
```

### 字典键排除保留字

生成对象键时排除 JavaScript 保留字：

```typescript
const keyArb = fc.string().filter(k => !['__proto__', 'constructor', 'prototype'].includes(k))
```

## 全局清理（global-teardown.ts）

在所有测试文件结束后运行，使用原生 SQL 按前缀清理残留数据：

```typescript
export async function teardown() {
    const client = new pg.Client({ connectionString })
    await client.connect()

    // 按模块清理
    await client.query(`DELETE FROM nodes WHERE name LIKE 'test_node_%'`)
    await client.query(`DELETE FROM models WHERE name LIKE 'test_model_%'`)
    await client.query(`DELETE FROM case_types WHERE name LIKE '测试类型_%'`)
    // ...

    await client.end()
}
```

**设计要点**：
- 使用原生 `pg` 库直接执行 SQL（不依赖 Prisma）
- 按前缀匹配删除，不需要追踪具体 ID
- 仅清理公共数据（节点、模型、案件类型等），模块内部数据由各自 `afterAll` 清理

## 测试编写规范

### 必须遵守

1. **真实数据库操作**：不使用 mock，所有数据库操作真实执行
2. **测试隔离**：每个测试用例独立，不依赖执行顺序
3. **数据清理**：`afterEach` / `afterAll` 中清理所有创建的测试数据
4. **中文描述**：测试描述和注释使用中文
5. **业务逻辑测试**：测试自定义业务逻辑，不测试 ORM 本身

### 禁止模式

```typescript
// 禁止：占位符测试
it('should work', () => { expect(true).toBe(true) })

// 禁止：ORM 代理测试
it('should save user', async () => {
    const user = await prisma.user.create({ data })
    expect(user.id).toBeDefined()  // 这只是测试 Prisma
})

// 禁止：脚本式测试
process.exit(0)  // 不要在测试中使用
console.log()    // 不要用 console.log 驱动测试
```

### 推荐模式

```typescript
describe('会员升级服务', () => {
    const testIds = createEmptyTestIds()

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    it('升级时应正确计算差价', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        // ... 测试业务逻辑
        const price = await calculateUpgradePriceService(...)
        expect(price).toBeGreaterThan(0)
    })

    it('不允许降级', async () => {
        await expect(
            upgradeService(userId, lowerLevelId)
        ).rejects.toThrow('不允许降级')
    })
})
```

## 覆盖率要求

| 指标 | 阈值 |
|------|------|
| 行覆盖率 (lines) | 80% |
| 函数覆盖率 (functions) | 80% |
| 分支覆盖率 (branches) | 80% |
| 语句覆盖率 (statements) | 80% |

**覆盖率排除**：
- `app/pages/`（纯 UI 页面）
- `app/components/icons/`（纯 UI 图标）
- `app/assets/`（静态资源）
- `server/lib/aliSms.ts`（外部 SDK 封装）
- `tests/`、`node_modules/`、`.nuxt/`、`generated/`

**实际执行标准**：server 和 shared 目录的测试覆盖率应达到 90% 以上。

## 常用命令

```bash
# 运行单个测试文件
npx vitest run tests/server/membership/membership.service.test.ts --reporter=verbose

# 运行单个模块
npx vitest run tests/server/membership --reporter=verbose

# 全量测试
bun run test

# 带覆盖率
npx vitest run --coverage

# 注意：不要使用以下命令
# bun test          ← Nuxt 自动导入不生效
# jest              ← 项目使用 Vitest
```

## 常见问题

### 主/测试数据库 schema 不同步

新增 Prisma model 后，测试数据库需要手动同步：

```bash
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing' bun run prisma:push --accept-data-loss
```

### 全量测试时节点名称冲突

测试数据命名不能使用硬编码固定名称，应使用 UUID 或时间戳 + 随机数生成唯一名称：

```typescript
// 正确
const name = `test_node_${crypto.randomUUID()}`

// 错误
const name = 'test_node_1'  // 多个测试文件可能冲突
```

### afterEach 未清理导致测试间干扰

确保每个 `describe` 块都有完整的清理逻辑，并跟踪所有创建的记录 ID。
