# 多阶段构建 - 使用 Node.js + Bun
# 阶段 1: 构建阶段
FROM --platform=linux/amd64 docker.xuanyuan.run/node:24.15.0 AS builder

# 安装curl和bash
RUN apt-get update && \
    apt-get install -y curl bash && \
    rm -rf /var/lib/apt/lists/*

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

# 构建 Nuxt 应用
ENV NODE_OPTIONS=--max-old-space-size=8192
RUN bun nuxt build

# 阶段 2: 生产运行阶段
FROM --platform=linux/amd64 docker.xuanyuan.run/node:24.15.0 AS runner

# 安装 Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# 安装 Python 运行时
RUN apk add --no-cache python3

WORKDIR /app

# 设置生产环境
ENV NODE_ENV=production
ENV NUXT_HOST=0.0.0.0
ENV NUXT_PORT=9000

# 从构建阶段复制 Nuxt 构建产物
COPY --from=builder /app/.output ./.output

# 复制 Skills 目录
COPY --from=builder /app/.deepagents ./.deepagents

# 暴露端口
EXPOSE 9000

# 启动应用
ENTRYPOINT []
CMD ["bun", "run", ".output/server/index.mjs"]