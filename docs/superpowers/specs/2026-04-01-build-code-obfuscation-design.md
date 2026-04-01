# 构建时代码混淆配置设计

## 概述

为 LexSeek 项目添加构建时代码混淆，保护前端和服务端代码不被轻易逆向。采用 `javascript-obfuscator` 生态，仅在生产构建时启用，第三方库保持原样。

## 需求

- **混淆范围**：前端（Vite 打包）+ 服务端（Nitro/Rollup 打包）
- **混淆强度**：中度 — 变量名压缩、字符串混淆、控制流扁平化
- **排除范围**：node_modules 第三方库不参与混淆
- **构建时间**：增加不超过原来的 2-3 倍

## 技术方案

### 依赖

新增 3 个开发依赖：

| 包名 | 用途 |
|------|------|
| `javascript-obfuscator` | 核心混淆引擎 |
| `vite-plugin-javascript-obfuscator` | 前端 Vite 插件 |
| `rollup-plugin-obfuscator` | 服务端 Nitro（Rollup）插件 |

### 混淆配置

创建 `config/obfuscator.ts`，定义共享混淆配置，前端和服务端复用：

```typescript
import type { ObfuscatorOptions } from 'javascript-obfuscator'

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

**配置说明：**

| 参数 | 值 | 说明 |
|------|-----|------|
| `controlFlowFlattening` | `true` | 启用控制流扁平化 |
| `controlFlowFlatteningThreshold` | `0.5` | 50% 函数参与，平衡性能和效果 |
| `stringArray` | `true` | 字符串数组混淆 |
| `stringArrayThreshold` | `0.75` | 75% 字符串参与，保留短字符串 |
| `stringArrayEncoding` | `['base64']` | Base64 编码字符串 |
| `splitStrings` | `true` | 拆分长字符串 |
| `splitStringsChunkLength` | `16` | 每 16 字符拆分一块，平衡混淆效果和产物体积 |
| `sourceMap` | `false` | 生产环境不生成 source map，防止逆向 |
| `renameGlobals` | `false` | 不重命名全局变量，避免第三方库冲突 |
| `deadCodeInjection` | `false` | 中度不需要死代码注入 |
| `debugProtection` | `false` | 不启用反调试 |

### Source Map 策略

生产构建**不生成 source map**：
- 混淆配置中 `sourceMap: false`
- Source map 会暴露原始代码结构，与混淆目标矛盾
- 如需调试生产问题，可临时关闭混淆构建一个带 source map 的版本

### Nuxt 集成

修改 `nuxt.config.ts`，分别为前端和服务端配置混淆插件：

**前端（Vite 插件）：**

`vite-plugin-javascript-obfuscator` 使用单对象参数 API：

```typescript
import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator'
import { obfuscatorConfig } from './config/obfuscator'

// nuxt.config.ts 中
vite: {
  plugins: [
    ...(process.env.NODE_ENV === 'production' ? [
      obfuscatorPlugin({
        options: obfuscatorConfig,
        apply: 'build',
        exclude: [/node_modules/],
      })
    ] : []),
  ],
}
```

**服务端（Nitro Rollup 插件）：**

通过 `nitro.rollupConfig.plugins` 添加 Rollup 插件：

```typescript
import { obfuscator as rollupObfuscator } from 'rollup-plugin-obfuscator'

// nuxt.config.ts 中
nitro: {
  rollupConfig: {
    plugins: [
      ...(process.env.NODE_ENV === 'production' ? [
        rollupObfuscator({
          options: {
            ...obfuscatorConfig,
          },
          exclude: [/node_modules/],
        })
      ] : []),
    ],
  },
}
```

**要点：**
- 通过 `process.env.NODE_ENV === 'production'` 判断，开发环境不混淆
- 前端和服务端都通过 `exclude: [/node_modules/]` 显式排除第三方库
- 前端使用 `apply: 'build'` 确保仅在构建时生效
- Nitro 默认会将依赖打包（bundle），因此服务端也需要显式排除 node_modules

### 构建验证

混淆配置完成后，需要执行以下验证步骤：

1. 运行 `bun build` 确认构建成功
2. 运行 `bun preview` 进行冒烟测试
3. 验证前端页面能正常加载和路由
4. 验证服务端 API 能正常响应
5. 对比混淆前后的产物体积（预期增大 20-40%）

## 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `config/obfuscator.ts` | 新增 | 共享混淆配置 |
| `nuxt.config.ts` | 修改 | 引入前端 + 服务端混淆插件 |
| `package.json` | 修改 | 新增 3 个 devDependencies |

## 方案选型理由

对比了三个方案：

1. **javascript-obfuscator + Vite/Nitro 插件（选定）** — 功能完整，支持中度混淆所需的全部特性
2. **Terser 高级配置** — 不支持字符串混淆和控制流扁平化，达不到中度要求
3. **构建后脚本处理** — 维护成本高，可能破坏 Nuxt 文件引用关系
