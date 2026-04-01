# 构建时代码混淆 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LexSeek 项目添加构建时代码混淆，保护前端和服务端代码不被轻易逆向。

**Architecture:** 使用 `javascript-obfuscator` 生态，前端通过 `vite-plugin-javascript-obfuscator` 集成，服务端通过 `rollup-plugin-obfuscator` 集成到 Nitro。共享混淆配置抽取到 `config/obfuscator.ts`，仅生产构建启用。

**Tech Stack:** javascript-obfuscator, vite-plugin-javascript-obfuscator, rollup-plugin-obfuscator, Nuxt 4, Vite, Nitro

**Spec:** `docs/superpowers/specs/2026-04-01-build-code-obfuscation-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `config/obfuscator.ts` | 新增 | 共享混淆配置对象，前端和服务端复用 |
| `nuxt.config.ts` | 修改 | 导入混淆插件，配置到 vite.plugins 和 nitro.rollupConfig.plugins |
| `package.json` | 修改 | 新增 3 个 devDependencies（由 bun add -D 自动完成） |

---

### Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 3 个开发依赖**

```bash
bun add -D javascript-obfuscator vite-plugin-javascript-obfuscator rollup-plugin-obfuscator
```

- [ ] **Step 2: 验证安装成功**

```bash
ls node_modules/javascript-obfuscator/package.json && ls node_modules/vite-plugin-javascript-obfuscator/package.json && ls node_modules/rollup-plugin-obfuscator/package.json
```

Expected: 三个文件都存在，无报错。

- [ ] **Step 3: 提交**

```bash
git add package.json bun.lock
git commit -m "chore: 添加代码混淆依赖"
```

---

### Task 2: 创建共享混淆配置

**Files:**
- Create: `config/obfuscator.ts`

- [ ] **Step 1: 创建 config 目录和配置文件**

创建 `config/obfuscator.ts`：

```typescript
import type { ObfuscatorOptions } from 'javascript-obfuscator'

/**
 * 中度混淆配置 — 前端和服务端共用
 *
 * 包含：变量名压缩、字符串混淆、控制流扁平化
 * 不包含：死代码注入、反调试（高强度特性）
 */
export const obfuscatorConfig: ObfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  debugProtection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  sourceMap: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ['base64'],
  splitStrings: true,
  splitStringsChunkLength: 16,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
}
```

- [ ] **Step 2: 验证 TypeScript 类型无误**

```bash
npx nuxi typecheck 2>&1 | tail -20
```

Expected: 无与 `config/obfuscator.ts` 相关的类型错误。

- [ ] **Step 3: 提交**

```bash
git add config/obfuscator.ts
git commit -m "feat: 创建共享代码混淆配置"
```

---

### Task 3: 集成前端混淆插件（Vite）

**Files:**
- Modify: `nuxt.config.ts` (顶部 imports 区域和 vite.plugins 区域)

- [ ] **Step 1: 在 nuxt.config.ts 顶部添加导入**

在 `import tailwindcss from '@tailwindcss/vite'` 之后添加：

```typescript
import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator'
import { obfuscatorConfig } from './config/obfuscator'
```

- [ ] **Step 2: 在 vite.plugins 中添加混淆插件**

将现有的：

```typescript
vite: {
  plugins: [
    tailwindcss() as any,
  ],
```

改为：

```typescript
vite: {
  plugins: [
    tailwindcss() as any,
    ...(process.env.NODE_ENV === 'production' ? [
      obfuscatorPlugin({
        options: obfuscatorConfig,
        apply: 'build',
        exclude: [/node_modules/],
      }),
    ] : []),
  ],
```

- [ ] **Step 3: 验证开发服务器正常启动（不受混淆影响）**

```bash
timeout 15 bun dev 2>&1 | tail -5
```

Expected: 开发服务器正常启动，无报错。混淆插件因 `NODE_ENV !== 'production'` 不会加载。

- [ ] **Step 4: 提交**

```bash
git add nuxt.config.ts
git commit -m "feat: 集成前端代码混淆插件"
```

---

### Task 4: 集成服务端混淆插件（Nitro）

**Files:**
- Modify: `nuxt.config.ts` (顶部 imports 区域和 nitro 配置区域)

- [ ] **Step 1: 在 nuxt.config.ts 顶部添加 rollup 插件导入**

在已有的 import 之后添加：

```typescript
import { obfuscator as rollupObfuscator } from 'rollup-plugin-obfuscator'
```

- [ ] **Step 2: 在 nitro 配置中添加 rollupConfig.plugins**

在现有 `nitro` 配置块中，与 `imports` 和 `externals` 同级，添加 `rollupConfig`：

```typescript
nitro: {
  // ... 保持现有 imports 和 externals 不变
  rollupConfig: {
    plugins: [
      ...(process.env.NODE_ENV === 'production' ? [
        rollupObfuscator({
          options: {
            ...obfuscatorConfig,
          },
          exclude: [/node_modules/],
        }),
      ] : []),
    ],
  },
},
```

- [ ] **Step 3: 验证开发服务器正常启动**

```bash
timeout 15 bun dev 2>&1 | tail -5
```

Expected: 开发服务器正常启动，无报错。

- [ ] **Step 4: 提交**

```bash
git add nuxt.config.ts
git commit -m "feat: 集成服务端代码混淆插件"
```

---

### Task 5: 生产构建验证

**Files:** 无文件变更，纯验证任务

- [ ] **Step 1: 记录无混淆时的产物体积（基线）**

在 `nuxt.config.ts` 中临时注释掉两处混淆插件（vite.plugins 和 nitro.rollupConfig.plugins 中的条件展开），然后构建：

```bash
bun build 2>&1 | tail -20
du -sh .output/
```

记录 `.output/` 目录体积作为基线，然后恢复注释。

- [ ] **Step 2: 执行带混淆的生产构建**

```bash
bun build 2>&1 | tail -30
```

Expected: 构建成功，无错误。

- [ ] **Step 3: 对比产物体积**

```bash
du -sh .output/
```

Expected: 体积增大约 20-40%。

- [ ] **Step 4: 验证混淆效果**

```bash
# 查看前端产物是否被混淆（应看到十六进制变量名和 base64 字符串）
head -c 500 $(find .output/public/_nuxt -name "*.js" | head -1)
```

Expected: 代码中出现 `_0x` 前缀变量名和 base64 编码字符串。

- [ ] **Step 5: 冒烟测试**

```bash
# 启动预览服务器并测试响应
timeout 15 bun preview 2>&1 | tail -5
```

Expected: 预览服务器正常启动。

- [ ] **Step 6: 提交确认信息（如果之前有未提交的微调）**

如果在验证过程中做了配置微调，提交改动：

```bash
git add nuxt.config.ts config/obfuscator.ts
git commit -m "fix: 调整混淆配置以通过构建验证"
```
