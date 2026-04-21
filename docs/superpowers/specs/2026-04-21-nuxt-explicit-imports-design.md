# Nuxt 项目级自动导入取消与显式导入迁移设计

> **受众**：负责本次工程化迁移的工程师与 AI 协作代理。
>
> **目标**：在保留 Nuxt/Vue/H3 内置自动导入的前提下，取消 LexSeek 项目级自动导入与组件自动注册，统一切换到显式导入。

---

## 1. 背景与问题定义

LexSeek 当前同时依赖多层自动导入：

- [nuxt.config.ts](/Users/daixin/work/dev/LexSeek/LexSeek/nuxt.config.ts:24) 开启 `components`
- [nuxt.config.ts](/Users/daixin/work/dev/LexSeek/LexSeek/nuxt.config.ts:108) 配置 `imports.dirs: ['store']`
- [nuxt.config.ts](/Users/daixin/work/dev/LexSeek/LexSeek/nuxt.config.ts:123) 配置 `nitro.imports.dirs: ['./server/services/*/*']`
- Nuxt 4 默认扫描 `app/composables`、`app/utils`，并通过 `shared/` 机制为 `shared/utils` 注入项目级全局符号

这套机制带来的问题已经超过便利性：

- 依赖来源隐式，阅读和重构时必须借助 `.nuxt` 生成物才能知道符号来自哪里
- 项目级 `server/services`、`shared/utils`、`components` 扫描范围过大，启动和构建链路成本上升
- 测试环境需要额外模拟项目级全局，例如 [tests/server/membership/test-setup.ts](/Users/daixin/work/dev/LexSeek/LexSeek/tests/server/membership/test-setup.ts:1) 中对 `logger`、`prisma` 的注入
- 组件命名、目录层级和 Nuxt 自动命名规则耦合，容易出现“源码没写依赖，但运行依赖存在”的维护问题

本地现状数据：

- `app` 文件约 `1107` 个，其中 `.vue` 约 `903` 个
- `server` TypeScript 文件约 `599` 个
- `tests` 文件约 `565` 个
- 约 `210` 个前端文件在使用项目级 store/composable 时缺少显式 import
- 约 `501` 个服务端文件在使用项目级 `prisma`、`logger`、`resSuccess/resError`、跨模块 service/dao 时缺少显式 import
- 约 `661` 个 `.vue` 文件在模板中使用 PascalCase 项目组件，组件标签使用约 `5645` 处
- `app/components/ai-elements` 下约 `381` 个组件文件，模板中 `<AiElements...>` 使用约 `133` 处，且同时存在 `index.ts` barrel export 与少量显式 import 混用

观测到的直接信号：

- `npx nuxt prepare` 当前会出现 `unimport` 扫描 Prisma 生成物的告警：尝试解析 `generated/prisma/enums.js`，而项目实际生成的是 `generated/prisma/enums.ts`
- 当前本地基线中，`npx nuxt prepare` 约 `2.81s`，`npx nuxi typecheck` 约 `56.56s`

这说明“项目级自动导入”已经是一个需要独立治理的工程问题，而不是单纯的代码风格偏好。

---

## 2. 目标与范围

### 2.1 目标

将 LexSeek 的项目级自动导入统一切换为显式导入，达成以下结果：

- 项目组件不再依赖 Nuxt 组件自动注册
- 项目 store/composable/utils/service 不再依赖 Nuxt 项目级自动导入
- 服务端 API、service、DAO、utils 的跨模块依赖全部显式声明
- 测试基建不再模拟项目级自动注入，只保留对 Nuxt/Vue/H3 内置能力的必要支持
- 团队文档与规范更新为“默认显式导入”
- `nuxt.config.ts` 使用“保留内置、关闭项目扫描”的精确配置，而不是把 Nuxt 自身自动导入一并关闭

### 2.2 保留范围

以下 Nuxt/Vue/H3 内置自动导入保留，不在本次迁移范围：

- Vue：`ref`、`computed`、`watch`、`onMounted` 等
- Nuxt：`useRoute`、`useRouter`、`useFetch`、`useState`、`useRuntimeConfig` 等
- H3/Nitro：`defineEventHandler`、`readBody`、`getQuery`、`setResponseHeaders` 等

### 2.3 迁移范围

本次迁移纳入以下项目级自动导入或自动注册：

- `app/components/**` 组件自动注册
- `app/store/**` 自动导入
- `app/composables/**`、`app/utils/**` 的项目级隐式使用
- `shared/utils/**` 的项目级隐式使用
- `server/services/*/*` 的 Nitro 自动导入
- 服务端对 `prisma`、`logger`、`resSuccess`、`resError` 等项目符号的隐式使用

### 2.4 不在本次范围

- 不改业务行为
- 不重构页面结构、API 契约或数据库模型
- 不借机重命名大量组件、目录或业务模块
- 不调整 Prisma 生成目录或生成策略
- 不把 Nuxt/Vue/H3 内置自动导入也改成显式 import

---

## 3. 决策摘要

| 决策项 | 结论 |
|---|---|
| 总体策略 | 方案 A：目标状态一次性完全显式导入 |
| 落地方式 | 以最终状态为准设计，但内部拆成可独立验证、可回滚的小批次提交 |
| 自动导入范围 | 仅保留 Nuxt/Vue/H3 内置；项目级全部移除 |
| Nuxt imports 配置 | 使用 `imports.scan: false`，不使用 `imports.autoImport: false` |
| 组件策略 | 全量取消自动注册，模板中使用的项目组件全部显式导入 |
| Nuxt components 配置 | 使用 `components.dirs: []` 停止扫描项目 `~/components` |
| `ai-elements` 策略 | 作为高风险组件族单独处理，优先复用现有 `index.ts` barrel export，保留 `AiElements...` 前缀语义 |
| 服务端策略 | 关闭 `nitro.imports.dirs`，跨模块 service/dao 与 `prisma`/`logger`/`resSuccess`/`resError` 全部显式导入 |
| 文档与测试 | 同步更新，不允许迁移后新代码回到项目级自动导入模式 |

---

## 4. 目标状态

迁移完成后，LexSeek 应满足以下代码约束：

### 4.1 前端脚本

- `app/pages`、`app/layouts`、`app/components`、`app/composables` 中使用项目级 store/composable/utils 时，必须显式 import
- 推荐使用现有 alias，避免相对路径回退：
  - `~/components/...`
  - `~/composables/...`
  - `~/store/...`
  - `~/utils/...`

### 4.2 前端组件

- 模板中用到的项目组件必须在 `<script setup>` 中显式导入
- `shadcn-vue` 组件仍然可通过其目录出口导入，例如 `~/components/ui/button`
- 组件是否可解析，不再依赖 `.nuxt/components.d.ts`

### 4.3 服务端

- `server/api`、`server/services`、`server/utils` 的跨模块依赖全部显式 import
- `prisma` 统一从 [server/utils/db.ts](/Users/daixin/work/dev/LexSeek/LexSeek/server/utils/db.ts:1) 导入
- `resSuccess` / `resError` / `parseErrorMessage` 统一从 [shared/utils/apiResponse.ts](/Users/daixin/work/dev/LexSeek/LexSeek/shared/utils/apiResponse.ts:1) 导入
- `logger` 统一从 `#shared/utils/logger` 导入
- 推荐跨模块服务端路径使用 `~~/server/...` 或 `#shared/...`，避免深层相对路径继续膨胀

### 4.4 测试

- 测试不再依赖“Nuxt 项目级自动导入会替我补全项目符号”的假设
- 若测试需要 `prisma`、`logger`、service helper，应显式导入或显式 stub
- 只对 Nuxt/Vue/H3 内置层保留必要测试基建支持

### 4.5 Nuxt 配置目标

迁移完成后的 Nuxt 配置需要满足以下语义：

- 使用 `imports.scan: false`，关闭项目自定义 composable / utils / shared 扫描
- 不使用 `imports.autoImport: false`，因为这会连内置自动导入一起关闭，不符合本次范围
- 删除项目自定义 `imports.dirs`
- 删除项目自定义 `nitro.imports.dirs`
- 使用 `components.dirs: []` 关闭项目 `~/components` 自动注册
- 保留模块提供的能力，但项目源码不得再依赖它们替自己补齐项目组件或项目符号

---

## 5. 迁移架构

### 5.1 总体原则

本次迁移不采用“先关开关，再手工救火”的方式，而采用：

1. 先建立自动生成的依赖映射
2. 先批量补齐源码显式 import
3. 再关闭 Nuxt 项目级自动导入开关
4. 最后收口测试、文档、Lint/规范

这样做的原因是：当前仓库对自动导入依赖非常深，如果先关配置，整个仓库会瞬间进入高噪音失败状态，反而不利于准确修复。

### 5.2 迁移真相源

为了减少路径猜测，本次迁移应尽量从 Nuxt 已生成的结果反推显式导入：

- `.nuxt/imports.d.ts`：前端 composable/store/shared 类型与值导出映射
- `.nuxt/types/nitro-imports.d.ts`：服务端全局注入映射
- `.nuxt/components.d.ts`：组件名到文件路径映射

这些文件不是最终运行依赖，但它们是当前项目级自动导入“实际生效结果”的可靠快照，适合作为 codemod 输入。

### 5.3 工作包拆分

迁移按 5 个工作包推进：

1. **WP1：依赖索引与 codemod**
   - 读取 `.nuxt` 生成物
   - 构建组件名、store/composable、service/global helper 的映射表
   - 生成可重复执行的 codemod 或迁移脚本

2. **WP2：服务端显式化**
   - 扫描 `server/api`、`server/services`、`server/utils`
   - 显式引入 `prisma`、`logger`、`resSuccess/resError`
   - 显式引入跨模块 service/dao/helper

3. **WP3：前端脚本显式化**
   - 处理 `app/pages`、`app/layouts`、`app/components`、`app/composables`、`app/store`
   - 补齐 `~/composables/*`、`~/store/*`、`~/utils/*` 显式导入

4. **WP4：组件显式化**
   - 扫描模板中 PascalCase 项目组件
   - 依据 `.nuxt/components.d.ts` 生成显式 import
   - 将 `components.dirs` 设为 `[]`

5. **WP5：测试与文档收口**
   - 精简测试中的项目级全局模拟
   - 更新技术文档与开发规范
   - 增加“禁止依赖项目级自动导入”的后续约束

### 5.4 先补源码再关配置

迁移配置关闭顺序固定为：

1. 先让源码在“同时兼容自动导入与显式导入”的状态下通过
2. 再关闭 `nitro.imports.dirs`
3. 再关闭 `imports.dirs`
4. 最后关闭 `components`

原因：

- 服务端跨模块全局是测试与运行时风险最大的部分，应最先收拢
- 组件层接触面最大，应最后切换，减少前期噪音

虽然本次总体上属于“方案 A”，但执行顺序必须按风险从高到低推进，而不是一次性同时关掉所有配置。

---

## 6. `ai-elements` 专项设计

`app/components/ai-elements` 是本次迁移中最需要单独设计的组件族。

### 6.1 为什么要专项处理

已确认的现状：

- 目录下约 `381` 个 `.vue` 组件文件
- 目录下存在大量 `index.ts` 与 `context.ts`
- 模板中 `<AiElements...>` 使用约 `133` 处
- 代码中已存在少量显式 import，且既有从单文件导入，也有从子目录 barrel export 导入

这意味着 `ai-elements` 不是普通的“一个组件对应一个文件”的场景，而是一套带前缀命名约定、目录级导出和上下文模块的组件系统。

### 6.2 迁移策略

`ai-elements` 的显式导入遵循以下优先级：

1. **优先使用现有子目录 `index.ts` 出口**
   - 例如 `~/components/ai-elements/prompt-input`
   - 例如 `~/components/ai-elements/confirmation`
   - 这样能同时保留现有的分组语义和前缀命名

2. **必要时使用根级 `~/components/ai-elements` barrel export**
   - 适合在同一文件中使用多个子模块组件的场景
   - 适合作为 codemod 的稳定 fallback

3. **只有在目录出口缺失或存在命名冲突时，才回退到单文件路径**
   - 避免把 `AiElements` 迁移成一堆脆弱的深层文件路径 import

### 6.3 迁移约束

- 不改变 `<AiElements...>` 组件标签命名
- 不改写 `ai-elements` 目录结构
- 不把 `context.ts` 暴露成模板组件导入项
- codemod 必须把 `AiElements` 组件和 `types/context` 普通模块导入分开处理

### 6.4 风险控制

`ai-elements` 相关文件的改动必须独立校验，至少覆盖：

- `AiPromptInput` / `caseAnalysis/promptInput`
- `AiMessageList` / `AiMessageListVirtualItem`
- `case` 与 `caseAnalysis` 下使用 `AiElementsConfirmation*` 的中断组件
- 任何使用 `PromptInput`、`Confirmation`、`Queue`、`Tool` 等高频家族的页面或组件

---

## 7. 详细迁移设计

### 7.1 WP1：依赖索引与 codemod

输出物：

- 组件映射表：`ComponentName -> import path`
- 前端项目符号映射表：`useXxx/useXxxStore/工具函数 -> import path`
- 服务端项目符号映射表：`logger/prisma/resSuccess/.../service helper -> import path`

要求：

- 脚本可重复执行
- 对已存在的显式 import 采取“合并而非覆盖”
- 对冲突映射输出审计报告，而不是静默猜测

### 7.2 WP2：服务端显式化

处理范围：

- `server/api/**`
- `server/services/**`
- `server/utils/**`

强制显式导入的对象：

- `prisma`
- `logger`
- `resSuccess`
- `resError`
- `parseErrorMessage`
- 跨模块 service/dao/helper

关闭项：

- `nitro.imports.dirs`

### 7.3 WP3：前端脚本显式化

处理范围：

- `app/pages/**`
- `app/layouts/**`
- `app/components/**`
- `app/composables/**`
- `app/store/**`

强制显式导入的对象：

- `useXxx` 项目 composable
- `useXxxStore` 项目 store
- `app/utils` 工具函数
- 其他项目模块中的显式值导出

关闭项：

- `imports.scan: false`
- 删除 `imports.dirs: ['store']`

### 7.4 WP4：组件显式化

处理方式：

- 仅把项目组件纳入显式导入
- Nuxt 内置组件如 `NuxtPage`、`NuxtLayout` 保留自动能力
- 基于模板解析而不是纯文本 grep 生成 import，避免误把类型名、注释、slot prop 当作组件

关闭项：

- `components.dirs: []`

### 7.5 WP5：测试与文档收口

文档更新至少覆盖：

- [docs/tech-docs/architecture/auto-imports.md](/Users/daixin/work/dev/LexSeek/LexSeek/docs/tech-docs/architecture/auto-imports.md:1)
- [docs/tech-docs/frontend/overview.md](/Users/daixin/work/dev/LexSeek/LexSeek/docs/tech-docs/frontend/overview.md:238)
- [docs/tech-docs/patterns/service-dao.md](/Users/daixin/work/dev/LexSeek/LexSeek/docs/tech-docs/patterns/service-dao.md:173)
- 任何把“无需手动 import”作为前提的 checklist / guide

测试基建调整至少覆盖：

- 服务端 `test-setup.ts` 中对 `logger`、`prisma` 等项目级全局的模拟方式
- 受影响最大的前端组件测试与服务端 API/service 测试

---

## 8. 验收标准

迁移完成后，必须同时满足以下条件：

1. `nuxt.config.ts` 使用 `imports.scan: false` 与 `components.dirs: []`，且不再保留项目级 `imports.dirs`、`nitro.imports.dirs`
2. 项目源码不再依赖项目级自动导入的 `store`、`composables`、`shared/utils`、`server/services`
3. 模板中使用的项目组件全部具备显式 import
4. `npx nuxt prepare` 不再因为项目级自动导入扫描而生成本次迁移所依赖的隐式映射，且不再出现当前 Prisma `enums.js` 扫描告警
5. `npx nuxi typecheck` 通过
6. 关键测试通过，至少覆盖服务端 API、服务层、前端重组件页与 `ai-elements` 高频组件族
7. 技术文档更新完成，新增代码默认遵循显式导入规范

---

## 9. 风险与缓解

| 风险 | 描述 | 缓解措施 |
|---|---|---|
| 组件映射冲突 | 组件名到路径并非总是唯一，尤其是目录前缀命名与局部重名 | 以 `.nuxt/components.d.ts` 为真相源；冲突时输出审计清单并人工裁决 |
| `ai-elements` 迁移脆弱 | 同时存在前缀标签、barrel export、types/context 模块 | 单列专项工作包；优先使用 `index.ts` 出口，不直接铺开深层单文件导入 |
| 服务端全局依赖暴露 | 取消 Nitro 自动导入后，隐藏的跨模块依赖会大量显现 | 先做服务端显式化，再关配置；使用批量 codemod 而不是人工逐个修 |
| 测试回归范围大 | 现有测试对 `globalThis.prisma/logger` 假设很深 | 测试基建收口单独成包，优先验证核心服务与 API |
| 与并行开发冲突 | 大面积改 import，容易和其他分支冲突 | 在独立迁移窗口执行；按小批次提交，避免一个超大提交长期悬挂 |

---

## 10. 验证与回归计划

最低验证集合：

1. `npx nuxt prepare`
2. `npx nuxi typecheck`
3. 受影响最大的服务端测试
4. 受影响最大的前端组件测试
5. 手工验证以下高价值路径：
   - 登录页与应用入口
   - Dashboard 主入口
   - 至少一个重 `ai-elements` 页面
   - 至少一个重表单页面
   - 至少一条典型服务端 API 链路

回归重点不是“全仓库逐页点一遍”，而是确认三条关键链路都真实可用：

- 前端脚本依赖解析
- 模板组件解析
- 服务端 handler 与 service 依赖解析

---

## 11. 工作量估算

按当前仓库规模与依赖深度，建议按以下区间评估：

- 依赖索引与 codemod：`0.5-1` 天
- 服务端显式化：`1-1.5` 天
- 前端脚本显式化：`0.5-1` 天
- 组件显式化：`1.5-2.5` 天
- 测试、文档、回归与边角修复：`1.5-2` 天

综合估算：

- **理想下限**：约 `5` 个开发日
- **更现实区间**：约 `5-8` 个开发日
- **若需低风险并行推进**：约 `1-2` 周日历时间

`ai-elements`、测试基建和组件映射冲突，是决定区间上下限的主要变量。

---

## 12. 最终建议

这次工作值得做，但必须被当作一次独立的工程化迁移，而不是顺手清理。

推荐执行原则：

- 目标状态按“完全显式导入”一次性收口
- 落地上按服务端、前端脚本、组件、测试/文档四段推进
- `ai-elements` 作为专项单独治理
- 在类型检查和关键回归全部通过前，不与其他大规模重构混合提交

只要按本 spec 执行，LexSeek 可以从“依赖 Nuxt 项目级魔法维持运转”切换到“源码本身完整声明依赖”的状态，后续维护、测试和性能治理都会更可控。
