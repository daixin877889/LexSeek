# 部署

LexSeek 使用多阶段 Docker 构建，Bun 作为运行时，通过 Nitro 插件管理启动流程和后台任务，支持可选的服务端代码混淆。

---

## 1. Docker 构建

### 1.1 多阶段 Dockerfile

```dockerfile
# 阶段 1: 构建
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY prisma ./prisma/
RUN bun install --frozen-lockfile
COPY . .
RUN bun prisma:generate
ENV NODE_OPTIONS=--max-old-space-size=8192
RUN bun nuxt build

# 安装 ipx 缺失依赖
WORKDIR /app/.output/server/node_modules/ipx
RUN bun add ofetch defu pathe ufo

# 阶段 2: 运行
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NUXT_HOST=0.0.0.0
ENV NUXT_PORT=3000
COPY --from=builder /app/.output ./.output
EXPOSE 3000
ENTRYPOINT []
CMD ["bun", "run", ".output/server/index.mjs"]
```

关键设计：
- **构建阶段**使用完整 `oven/bun:1` 镜像（含编译工具），**运行阶段**使用 `oven/bun:1-slim`（最小体积）
- 构建时分配 8GB 内存（`--max-old-space-size=8192`），用于服务端代码混淆
- `ENTRYPOINT []` 覆盖 Bun 基础镜像的默认 entrypoint，兼容阿里云函数计算等 Serverless 平台
- `ipx`（Nuxt Image 的图片优化引擎）依赖缺失需手动补装

### 1.2 健康检查

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health')
    .then(r => r.ok ? process.exit(0) : process.exit(1))
    .catch(() => process.exit(1))"
```

通过 `/api/health` 端点检测应用健康状态。

### 1.3 Docker Compose

**生产部署** (`docker-compose.yml`)：
- 单服务 `lexseek`，映射端口 3000
- 所有环境变量通过 `.env` 文件注入
- 使用 `lexseek-network` 桥接网络

**开发环境** (`docker-compose.dev.yml`)：
- 仅包含 PostgreSQL 服务
- 基于 `docker/postgres/Dockerfile` 构建（pgvector + zhparser）
- 数据持久化到 `lexseek-pgdata` Volume

---

## 2. 构建混淆

### 2.1 配置 (`config/obfuscator.ts`)

通过环境变量 `ENABLE_OBFUSCATOR=true` 显式开启（默认关闭）：

```typescript
// nuxt.config.ts
rollupConfig: {
    plugins: [
        ...(process.env.ENABLE_OBFUSCATOR === 'true' ? [
            rollupObfuscator({
                global: true,
                options: obfuscatorConfig,
            }),
        ] : []),
    ],
}
```

### 2.2 混淆策略

使用 `rollup-plugin-obfuscator`（基于 `javascript-obfuscator`），采用中度混淆配置：

| 特性 | 配置 | 说明 |
|------|------|------|
| 代码压缩 | `compact: true` | 移除空白和换行 |
| 控制流扁平化 | `controlFlowFlattening: true` (50%) | 混淆代码执行流程 |
| 变量名混淆 | `identifierNamesGenerator: 'hexadecimal'` | 变量名替换为十六进制 |
| 字符串混淆 | `stringArray: true` (75%) | 字符串提取到数组 |
| 字符串编码 | `stringArrayEncoding: ['base64']` | Base64 编码字符串 |
| 字符串分割 | `splitStrings: true` (16 字符) | 长字符串拆分 |
| 对象键转换 | `transformObjectKeys: true` | 混淆对象属性名 |
| 死代码注入 | `deadCodeInjection: false` | 不注入（避免体积膨胀） |
| 反调试 | `debugProtection: false` | 不启用（影响调试） |
| 自我防御 | `selfDefending: false` | 不启用 |
| Source Map | `sourceMap: false` | 不生成（安全考虑） |

---

## 3. Nitro 插件启动顺序

Nitro 插件位于 `server/plugins/` 目录，在服务启动时自动加载执行。

### 3.1 插件列表

| 插件 | 文件 | 职责 |
|------|------|------|
| Logger | `logger.ts` | 根据 `runtimeConfig.public.logLevel` 设置日志级别 |
| Agent Worker | `agent-worker.ts` | 启动 Agent 后台任务 Worker |
| Cron Scheduler | `cron-scheduler.ts` | 注册和启动所有定时任务 |

### 3.2 Logger 插件

```typescript
export default defineNitroPlugin(() => {
    const config = useRuntimeConfig()
    const logLevelName = (config.public.logLevel as string || 'DEBUG').toUpperCase()
    const level = LOG_LEVELS[logLevelName]
    if (level !== undefined) {
        logger.setLevel(level)
    }
})
```

### 3.3 Agent Worker 插件

```typescript
export default defineNitroPlugin((nitroApp) => {
    const { redis: redisConfig } = useRuntimeConfig()

    if (!redisConfig.url) {
        logger.warn('Redis URL 未配置，Agent Worker 不启动')
        return
    }

    worker = new AgentWorker()
    worker.start()

    // 优雅关闭
    nitroApp.hooks.hook('close', async () => {
        if (worker) {
            await worker.shutdown()
            worker = null
        }
    })
})
```

依赖 Redis。如果 `NUXT_REDIS_URL` 未配置，插件跳过启动。

### 3.4 优雅关闭顺序

通过 Nitro 的 `close` hook 实现，关闭顺序为：

```
1. Agent Worker 停止（agent-worker.ts）
2. 定时任务调度器停止（cron-scheduler.ts）
3. Agent 数据库连接池关闭
4. Redis 连接关闭
```

资源关闭由 `cron-scheduler.ts` 统一管理，确保 Redis 连接在所有依赖任务停止后才关闭。

---

## 4. 定时任务

定时任务调度器 (`server/plugins/cron-scheduler.ts`) 使用 `CronScheduler` 类统一管理，配合 Redis 分布式锁确保多实例部署下不重复执行。

### 任务列表

| 任务名 | 间隔 | 锁超时 | 说明 |
|--------|------|--------|------|
| `asr-polling` | 5 分钟 | 120 秒 | ASR 语音识别保底轮询，检查 pending 状态任务 |
| `mineru-polling` | 5 分钟 | 120 秒 | MinerU PDF 转换保底轮询 |
| `payment-cleanup` | 10 分钟 | 60 秒 | 清理超时未支付的支付事务 |
| `analysis-cleanup` | 15 分钟 | 60 秒 | 清理僵死的 IN_PROGRESS 分析记录 |
| `agent-runs-cleanup` | 24 小时 | 300 秒 | 清理 90 天前的已终结 Agent 运行记录（启动时立即执行一次） |

### 注册方式

```typescript
scheduler.register({
    name: 'asr-polling',
    intervalMs: 5 * 60 * 1000,
    lockTtlSeconds: 120,
    fn: pollPendingAsrTasksService,  // 自动导入的服务函数
})
```

---

## 5. Redis 连接管理

Redis 用于：
- **Agent Worker**：任务队列管理（入队/出队/状态跟踪）
- **定时任务**：分布式锁（多实例防重复）
- **其他**：缓存等

连接配置：
- URL 通过 `NUXT_REDIS_URL` 环境变量配置
- 未配置时，Agent Worker 和定时任务均不启动（降级运行）

关闭流程（`cron-scheduler.ts`）：

```typescript
nitroApp.hooks.hook('close', async () => {
    scheduler.shutdown()           // 停止定时任务
    await closeAgentDbPool()       // 关闭 Agent 专用 DB 连接池
    await closeRedisConnections()  // 关闭 Redis 连接
})
```

---

## 6. 数据库连接

### 6.1 主连接

通过 `server/utils/db.ts` 创建 Prisma Client，使用 `PrismaPg` adapter 连接 PostgreSQL：

```typescript
const adapter = new PrismaPg({
    connectionString,
    options: '-c TimeZone=UTC',
})
```

### 6.2 Agent 专用连接

Agent Worker 使用独立的数据库连接（`NUXT_AGENT_DATABASE_URL`），默认回退到 `DATABASE_URL`。这允许 Agent 任务使用独立的连接池，避免影响主应用的数据库性能。

---

## 7. 环境变量加载

| 环境 | 加载方式 | 变量文件 |
|------|---------|---------|
| 开发 | Nuxt 自动加载 | `.env` |
| 生产 | Docker 环境变量注入 | `docker-compose.yml` 的 `environment` |
| 测试 | `dotenv` 手动加载 | `.env.testing` |
| 构建 | Dockerfile `ENV` 指令 | 无文件，仅构建时变量 |

---

## 8. 生产部署检查清单

- [ ] `DATABASE_URL` 指向生产数据库（含 pgvector 扩展）
- [ ] `NUXT_JWT_SECRET` 已设置为安全的随机值
- [ ] `NUXT_REDIS_URL` 已配置（Agent Worker 和定时任务需要）
- [ ] `NUXT_STORAGE_ALIYUN_OSS_*` 系列配置完整
- [ ] `NUXT_WECHAT_PAY_*` 微信支付配置完整（如需要）
- [ ] `NUXT_PUBLIC_BASE_URL` 设置为正确的 HTTPS 域名
- [ ] Prisma migration 已在生产数据库执行
- [ ] `ENABLE_OBFUSCATOR=true` 按需开启代码混淆
- [ ] 健康检查端点 `/api/health` 可访问
