# Docker 镜像构建 OOM 止血方案（P0 阶段）

- 创建日期: 2026-04-29
- 范围: 只解决云效流水线 `RUN bun nuxt build` 阶段被 SIGKILL 的问题
- 决策口径: 最小改动先行，验证后再决定是否扩大范围

## 1. 背景与诊断

### 1.1 现象

云效流水线（已升至 16G 内存的实例）在 Docker 镜像构建阶段被强制终止：

```
[builder 8/10] RUN bun nuxt build
  43.76 ✓ 9968 modules transformed.
  48.56 rendering chunks...
  50.70 computing gzip size...
  76.76 error: Failed to run "nuxt" due to signal SIGKILL
  76.76 Killed
ERROR: failed to solve: process "/bin/sh -c bun nuxt build"
       did not complete successfully: exit code: 137
```

### 1.2 关键事实

1. **`exit code 137 = SIGKILL`**：被 cgroup / OS OOM Killer 杀掉，不是 V8 自己 `JavaScript heap out of memory`。这意味着 Dockerfile 第 21 行的 `ENV NODE_OPTIONS=--max-old-space-size=8192` 对本场景**无效**——堆调多大都救不了被外面强杀的进程。
2. **死亡时点：`computing gzip size...` 之后**。Vite 默认开启 `build.reportCompressedSize`，会在构建末尾对**所有 chunk** 同步 gzip 一次写入构建报告，需要把"原始 chunk 源码 + 压缩后 buffer"同时驻留内存。在 9968 modules 这种规模下是著名的内存峰值点。
3. **9968 modules transformed**：客户端 bundle 极重，包含 mermaid / pdfmake / tiptap / @vue-flow / xlsx / reka-ui / lucide-vue-next 等大依赖。
4. **副诊断**：日志里有 `Module "fs"/"path" has been externalized for browser compatibility, imported by "/app/shared/utils/logger/transports/file.ts"` 警告。说明客户端 bundle 拖入了 `FileTransport`（fs/path 的服务端模块）。这是次要问题，不直接导致 OOM，但说明 logger 入口对客户端不干净。本期暂不修。

### 1.3 已排除的因素

- **不是机器规格问题**：16G 实例同样被杀。继续升配是绕路，必须降低构建峰值。
- **不是混淆器问题**：`ENABLE_OBFUSCATOR` 默认关闭，且日志显示是在客户端构建阶段（`computing gzip size`）就死了，远没到服务端 nitro 混淆阶段。

## 2. P0 改动（本期唯一改动）

### 2.1 文件：`nuxt.config.ts`

在现有的 `vite` 块中**新增**一个 `build` 子段：

```ts
vite: {
  // ... 保留现有的 resolve / plugins / worker / optimizeDeps / server
  build: {
    reportCompressedSize: false,
  },
}
```

含义：关闭 vite 在构建末尾对每个 chunk 同步 gzip 计算大小并写报告这一步。直接消除日志里 50.70s 后被杀掉的那一阶段。

### 2.2 不动的部分（明确边界）

为了让本次改动 100% 可回滚、可归因：

- **不动 Dockerfile**：`ENV NODE_OPTIONS=--max-old-space-size=8192` 保留作为 V8 堆兜底。
- **不动 minify**：Nuxt 4 + vite 5 默认 minify 已经是 esbuild（非高内存的 terser），无需改。
- **不动 logger 客户端污染问题**：留作 P1，看 P0 通过后再评估。
- **不动客户端 bundle 拆分 / 大依赖懒加载**：留作 P1（方案 B）。
- **不动云效流水线配置 / 构建机迁移**：留作 P2（方案 C）。

## 3. 验证方案

### 3.1 本地模拟

在本机用与云效相同的内存约束跑一次：

```bash
docker build --memory=8g --memory-swap=8g -t lexseek-build-test .
```

通过条件：构建命令完整走完 `bun nuxt build`，不出现 `Killed` / `exit code 137`，进入下一阶段（`bun add ofetch defu pathe ufo`）。

### 3.2 云效流水线

直接重跑流水线（保持当前 16G 实例规格），观察日志：

- ✅ 不再出现 `computing gzip size...` 这一行
- ✅ 不再被 SIGKILL（`exit code 137`）
- ✅ `RUN bun nuxt build` 阶段成功结束

如果上述任何一项不通过，立即回到第 4 节升级路径。

### 3.3 回归

- 镜像启动后调用 `/api/health` 应返回 200。
- 客户端打开任意页面应正常加载（资源大小不变；唯一差别是构建报告里没有 gzip size 列）。

## 4. 升级路径（P0 失败时）

如果 P0 改完云效仍 OOM，按下面顺序升级：

### 4.1 P1：客户端瘦身（中等工作量）

- **修复 logger 客户端污染**：拆 `shared/utils/logger/transports/index.ts`，让 `FileTransport` 走 Node-only 懒加载，客户端 bundle 不再含 fs/path 的虚假依赖图。
- **大依赖懒加载**：`mermaid` / `pdfmake` / `xlsx` / `docx-preview` / `mammoth` / `katex` 等只在特定页面用的依赖改成路由级 `dynamic import` + `defineAsyncComponent`，砍掉首屏 bundle。
- **手动 chunk 切分**：`vite.build.rollupOptions.output.manualChunks` 按 vendor 分包，降低单 chunk 内存峰值。

### 4.2 P2：构建机迁移（重武器）

- 把 Docker 构建从云效公共集群迁到自有 ECS / ACR 构建中心 / GitHub Actions 自定义 runner。
- 或本地 `bun run build` + `docker buildx build` 后 push 镜像，云效仅做触发与部署。

### 4.3 隐含的下一道关卡

如果未来打开 `ENABLE_OBFUSCATOR=true`，服务端 nitro 阶段（langchain + agent-platform 巨型 bundle）跑 `controlFlowFlattening + transformObjectKeys + base64 stringArray` 会再次引爆内存。届时需要专门做"混淆器分包 + 排除热点模块"方案，不在本期范围内。

## 5. 风险与回滚

| 项 | 评估 |
|---|---|
| **改动面** | 1 个文件、1 行 + 1 个新增 key |
| **运行时风险** | 0（仅影响构建报告输出） |
| **可回滚性** | 删除该 key 即恢复原状 |
| **构建产物变化** | 仅"构建日志末尾的 gzip size 表"消失，`.output` 内容字节级一致 |

## 6. 验收标准

本次 spec 视作完成的判据：

1. 云效流水线 `RUN bun nuxt build` 阶段不再被 SIGKILL，构建走到下一 RUN
2. 镜像产物启动后 `/api/health` 返回 200
3. 客户端在浏览器中正常加载至少首页 + dashboard 主页

任一不达成 → 进入第 4 节升级路径。
