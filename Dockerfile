# 多阶段构建 - 使用 Bun 构建 Nuxt 项目
# 阶段 1: 构建阶段
FROM oven/bun:1 AS builder

WORKDIR /app

# 复制依赖文件
COPY package.json bun.lock ./
COPY prisma ./prisma/

# 安装依赖（包括 devDependencies，构建需要）
RUN bun install --frozen-lockfile

# 复制源代码
COPY . .

# 生成 Prisma Client
RUN bun prisma:generate

# 构建 Nuxt 应用
RUN bun run build

# 在构建阶段安装 ipx 缺失的依赖到 .output/server/node_modules
WORKDIR /app/.output/server/node_modules/ipx
RUN bun add ofetch defu pathe ufo

# 阶段 2: 生产运行阶段
FROM oven/bun:1-slim AS runner

WORKDIR /app

# 设置生产环境
ENV NODE_ENV=production
ENV NUXT_HOST=0.0.0.0
ENV NUXT_PORT=3000

# 从构建阶段复制 Nuxt 构建产物（包含已安装的依赖）
COPY --from=builder /app/.output ./.output

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# 启动应用
CMD ["bun", "run", ".output/server/index.mjs"]
