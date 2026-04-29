# 多阶段构建 - 使用 Node.js + Bun
# 阶段 1: 构建阶段（使用 Bun 编译）
FROM --platform=linux/amd64 docker.1ms.run/node:24.15.0-alpine AS builder

# Alpine 需要安装 curl 和 bash 才能安装 Bun
RUN apk add --no-cache curl bash

# 安装 Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app

# 复制依赖文件
COPY package.json bun.lock ./
COPY prisma ./prisma/

# 安装依赖
RUN bun install --frozen-lockfile

# 复制源代码
COPY . .

# 生成 Prisma Client
RUN bun prisma:generate

# 构建 Nuxt 应用（生成 Node.js 产物）
ENV NODE_OPTIONS=--max-old-space-size=8192
RUN bun nuxt build

# 阶段 2: 生产运行阶段（纯 Node.js 环境，不需要 Bun）
FROM --platform=linux/amd64 docker.1ms.run/node:24.15.0-alpine AS runner

# 安装 Python 运行时（如需支持 Python Skills）
RUN apk add --no-cache python3

WORKDIR /app

# 设置生产环境变量
ENV NODE_ENV=production
ENV NUXT_HOST=0.0.0.0
# 【关键】函数计算要求监听 9000 端口，Nuxt Nitro 会读取 PORT 环境变量
ENV PORT=3000

# 从构建阶段复制编译好的产物
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/.deepagents ./.deepagents

# 暴露端口
EXPOSE 3000

# 使用 Node.js 直接启动（不需要 Bun）
CMD ["node", ".output/server/index.mjs"]