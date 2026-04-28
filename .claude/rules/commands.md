# 运行命令

## 开发命令

```bash
bun install         # 安装依赖（postinstall 会自动跑 nuxt prepare）
bun dev             # 启动开发服务器（含热重载，监听 0.0.0.0）
bun run build       # 生产构建（NODE_OPTIONS 已带 max-old-space-size=16384）
bun preview         # 预览生产构建
bun run reset       # 清理 .nuxt / node_modules / .output 后重装并重新生成 prisma client
```

## 类型检查

```bash
bun run typecheck   # ✅ 优先用这个 — 等价于 `npx nuxi typecheck`
# ❌ 不要用 tsc — Nuxt 的虚拟模块（auto-imports、#shared、#components 等）只有 nuxi 能解析
```

## 测试命令

**重要**：测试一律使用 `npx vitest run` 或 `bun run test`。**禁止使用 `bun test`**（bun 内置 runner 不解析 Nuxt 自动导入与 vitest config）。

```bash
bun run test          # 全量测试（默认 4 worker，含 vitest.config.ts 中的 globalSetup）
bun run test:fast     # 轻量子集快速测试（vitest.fast.config.ts，开发阶段自检用）
bun run test:server   # 仅 tests/server/
bun run test:client   # 仅 tests/client/
bun run test:shared   # 仅 tests/shared/
bun run coverage      # 覆盖率报告（裁剪到最后 100 行）

# 单文件
npx vitest run tests/server/case/xxx.test.ts --reporter=verbose

# 指定 worker 并发数（CPU 充足时可拉到 6-8）
VITEST_MAX_WORKERS=8 bun run test
```

> 测试基建：每个 vitest worker 启动时，`tests/_infra/global-setup.ts` 会从 `ls_new_testing` 模板库 `CREATE DATABASE ls_test_w<id>`，进程退出时 DROP。**业务测试代码无需手动建库**，直接 `import { prisma } from '~~/server/utils/db'`。详见 `.claude/rules/testing.md`。

## Prisma 命令

```bash
bun run prisma:generate    # 生成 Prisma 客户端到 generated/prisma/
bun run prisma:migrate     # ✅ 正式变更唯一入口（= prisma migrate dev）
bun run prisma:deploy      # 生产部署应用迁移（CI/CD 跑，不手工执行）
bun run prisma:studio      # 数据库 GUI（只读浏览安全）
bun run prisma:push        # ⚠️ 仅临时验证 schema 想法，不用于 commit
bun run db:setup           # prisma:push + 跑 setupRetrievalInfra.ts（初始化检索基建/扩展）
```

> 数据库变更必须走 `prisma migrate dev`，禁止手工写 SQL 或修改 `prisma/migrations/`。详见 `.claude/rules/database.md`。

## 维护脚本

```bash
# 重建法律法规向量嵌入（schema 变化或重新拉取数据后）
npx tsx server/scripts/rebuildLawEmbeddings.ts

# 初始化检索基建（pgvector / pg_trgm / zhparser 扩展、索引）
npx tsx server/scripts/setupRetrievalInfra.ts
```

## E2E / 评测

```bash
# 评测（连接独立的 ls_eval 库）
bun run eval:context

# E2E 优先用 chrome-devtools MCP，调浏览器验证关键路径
```
