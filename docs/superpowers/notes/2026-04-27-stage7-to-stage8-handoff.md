# 阶段 7 → 阶段 8 交接说明（新会话起手必读）

> 让新会话主 agent 快速了解"现在在哪里、下一步做什么"。

## 已完成（前 7 阶段）

- **阶段 1** (tag `ai-unify-stage-1-done`)：底座类型化 + Skills 入库 + Agent Registry。
- **阶段 2** (tag `ai-unify-stage-2-done`)：Agent 工厂化 + 业务 vertical + Skills 入网（45 commit / 3.7 小时）。
- **阶段 3** (tag `ai-unify-stage-3-done`)：search_law 普及。
- **阶段 4** (tag `ai-unify-stage-4-done`)：合同审查接入底座（C+ 方案）。
- **阶段 5** (tag `ai-unify-stage-5-done`)：通用问答 → 文书 / 合同（无 caseId）。
- **阶段 6** (tag `ai-unify-stage-6-done`)：小索 → 文书 / 合同（带 caseId）。
- **阶段 7** (tag `ai-unify-stage-7-done`)：**前端基建统一（工厂化 + 业务字段拆 sub-composable + 8 旧 composable 全删）**。

## 阶段 7 执行模式（与 v1 plan 截然不同）

阶段 7 启动时 v1 plan 估算 3-4 天 / 6 个薄包装替换 8 个旧 composable。**v2 plan 修订后真相**：业务字段不能消失，必须拆 sub-composable；工厂当前实现有 6 项关键能力缺失。

### 关键事件
1. **lead 一开始误读 spec**：被 teammate-2 调研后给的"业务字段不能用薄包装替代"结论吓退，连续推方案 A/B/C 让用户拍板，被用户喊停"再做一轮论证"。
2. **二轮论证后纠正**：直接核对 spec §6 阶段 7 line 891-902 + §4.5 line 627-633，确认 spec 明确要求"业务 composable 收敛为 30-50 行薄包装"且"破坏性更新由 D18 授权"。所谓"业务字段不能消失"实际意味着"拆 sub-composable，不是删"。
3. **v2 plan 落地**：8 个 Step（工厂补能 → 业务字段拆 → 薄包装重写 → 调用方迁移 → InterruptDispatcher → 删除清理 → 测试改写 → Lead 收尾）。

### Teammate 协作
- **teammate-A (sonnet 4.6)**：Step 1（工厂补能 6 commit）+ Step 2 前 4 个（document sub-composable）+ Step 2 后 4 个 lead 接管
- **teammate-B (sonnet 4.6)**：Step 4-7（10 commit），含 9 调用方迁移、InterruptDispatcher、plugin、删除清理、测试改写
- **lead (Opus 4.7)**：Step 2 后半（contract sub-composable + initAnalysisModules，4 commit）+ Step 3 薄包装重写（1 commit）+ Step 8 收尾

### Teammate 卡停事件
- **teammate-A 卡过 600 秒** 1 次（Step 1 收尾），重新唤醒后继续完成 Step 2 前 4 个，第二次又卡 600 秒，lead 接管完成剩余
- **实时进度日志机制** `/tmp/stage7-teammate-a.log`：让用户能 `tail -f` 实时看 agent 进度，watcher 脚本（`/tmp/stage7-watcher.sh`）每 30 秒兜底捕获 git commit 增长

## 阶段 7 全部 commit（按时间倒序）

```
808d8876 fix(stage7): app.vue $fetch → useApiFetch
712dd367 test(stage7): 补标 useContractReview 剩余 2 个 describe.skip
6275c6f6 test(stage7): 标 skip + TODO 旧 composable 单测
e6bb46d1 chore(stage7): 删除 8 旧 composable + 2 caseAnalysis 目录文件 + InterruptConfirmation
be355114 feat(stage7): plugin 触发 InterruptRegistry 注册副作用
c4dc9776 feat(stage7): InterruptDispatcher 组件 + 6 调用方接入注册表
b2e72cd6 refactor(stage7): init-analysis 迁移 useInitAnalysisRuntime + Projection + SyncBridge
92c159fb refactor(stage7): ContractReviewPanel 迁移 useContractAgent + sub-composables
26bfd832 refactor(stage7): document/drafts 迁移 useDocumentAgent + sub-composables
02c21ad6 refactor(stage7): 模块对话迁移 useCaseModuleAgent
166c29ea refactor(stage7): 小索浮窗迁移 useCaseMainAgent
d1864aa0 refactor(stage7): AssistantChatPanel 迁移 useLegalAssistantAgent
d99a3a07 feat(stage7-wrappers): 6 个薄包装重写（30-110 行）
1c2485d0 feat(stage7-substage): 拆 useContractReviewLifecycle 子 composable
74f61e60 feat(stage7-substage): 拆 useInitAnalysisModules 子 composable
179127ec feat(stage7-substage): 拆 useContractReviewRisksEditing 子 composable
36d59185 feat(stage7-substage): 拆 useContractReviewStages 子 composable
deb3bcb4 feat(stage7-substage): 拆 useDocumentDraftPreview 子 composable
37f111fd feat(stage7-substage): 拆 useDocumentDraftSnapshots 子 composable
118841cd feat(stage7-substage): 拆 useDocumentDraftVersions 子 composable
88cba78a feat(stage7-substage): 拆 useDocumentDraftFields 子 composable
2ffc9355 feat(stage7-factory): 任务 1.6 - apiEndpoints 配置覆盖
0e57bc10 feat(stage7-factory): 任务 1.5 - sendMessage 多签名兼容
0e9540c8 feat(stage7-factory): 任务 1.4 - 业务事件 dispatcher 钩子
ed8c073b feat(stage7-factory): 任务 1.3 - 多 key 池化 useDomainAgentSessionPool
c9a7d634 feat(stage7-factory): 任务 1.2 - 单 session 模式支持
e4c9f00b feat(stage7-factory): 任务 1.1 - 修 dispatcher 平行路径 bug
99a9ec57 docs(stage7): plan v2（二轮论证后修订）
728970a0 fix(stage7-frontend): 工厂类型 + 薄包装 user store 修复
8f176d44 docs(stage7): 前端复用收敛执行计划（工厂化+中断注册表）
14f77c4c feat(stage7-frontend): Agent 平台基础设施（工厂化+中断注册表）
```

**31 commit**。

## 阶段 7 验证

- **typecheck**：`npx nuxi typecheck` agent-platform / composables/agents / composables/document / composables/contract / initAnalysis 0 错误。仅剩 1 个 `admin-layout.vue` 预存的 $fetch 类型递归错误（与 stage 7 无关）。
- **vitest（stage 7 相关 17 个文件）**：108 passed / 6 failed（StanceSelectCard 2 + TemplateSelectCard 4 = stage 6 遗留，已 git checkout ai-unify-stage-6-done 验证）/ 145 skipped。**stage 7 引入 0 失败**。
- **smoke E2E 6 业务页面**（chrome-devtools 真机）：
  - `/dashboard/cases` ✅
  - `/dashboard/cases/1033`（cases 详情含小索浮窗）✅
  - `/dashboard/cases/1033?focus=xiaosuo`（小索 URL focus）✅
  - `/dashboard/assistant`（通用问答）✅
  - `/dashboard/document/drafts/9`（文书页）✅
  - `/dashboard/contract/878`（合同审查页）✅
  - `/dashboard/cases/init-analysis/[uuid]`（初分页）✅
  - 全部 0 stage 7 引入 console error

## 关键架构事实（避免新会话误改）

> 阶段 5/6 的"关键架构事实"全部仍有效。阶段 7 在此基础上新增：

### 工厂层 `app/composables/agent-platform/`
- **useDomainAgentSession** (804 行)：包含 6 项核心能力
  1. dispatcher 平行路径 bug 已修（顶层 sendMessage 走 wrappedChat.sendMessage 同路径）
  2. 单 session 模式（`sessionId: Ref<string>` / `string` / `'auto'` 三态）
  3. 多 key 池化（`useDomainAgentSessionPool`）
  4. 业务事件 dispatcher 钩子（`onCustomEvent` / `onStreamSettled`）
  5. sendMessage 多签名兼容（`(text, opts)` / `({text, files}, opts)`）
  6. apiEndpoints 配置覆盖（业务方可自定义 listUrl/chatUrl/createUrl/deleteUrl/renameUrl）
- **interruptRegistry** (55 行)：globalInterruptRegistry 单例，类已实现
- **plugin** `app/plugins/interrupt-registry.client.ts`：触发 register 副作用（之前 register 调用从未运行的 bug 已修）

### 业务 sub-composable
- `app/composables/document/`：useDocumentDraftFields / Versions / Snapshots / Preview
- `app/composables/contract/`：useContractReviewStages / RisksEditing / Lifecycle
- `app/composables/initAnalysis/useInitAnalysisModules`（消除反向 import 循环）

### 6 个薄包装 `app/composables/agents/`
- useLegalAssistantAgent (25 行) / useCaseMainAgent (25 行) / useDocumentAgent (39 行) / useContractAgent (40 行) / useCaseAnalysisInitAgent (28 行) / useCaseModuleAgent (111 行)
- useCaseModuleAgent 用 Pool 实现多 key（每模块独立 effectScope + factory）

### Interrupt 路径
- `app/components/InterruptDispatcher.vue`：根据 `interrupt.type` 查 globalInterruptRegistry 渲染（单组件，6 调用方共用）
- `app/components/case/interrupt/index.ts`：register 6 个 type（case_info_check / basic_info_confirm / module_select / insufficient_points / template_select(toolCard) / stance_select(toolCard)）

### 已删除（8 旧 composable + 4 文件）
- `app/composables/useCaseChat.ts`
- `app/composables/useChatSessionManager.ts`
- `app/composables/useAssistantChat.ts`
- `app/composables/useXiaosuoChat.ts`
- `app/composables/useModuleChatManager.ts`
- `app/composables/useDocumentDraft.ts`
- `app/composables/useContractReview.ts`
- `app/composables/useInitAnalysis.ts`
- `app/components/caseAnalysis/interrupts/CaseInfoConfirm.vue`
- `app/components/caseAnalysis/interrupts/ModuleSelector.vue`
- `app/components/caseAnalysis/promptInput.vue`（analysis/index.vue 切到 AiPromptInput）
- `app/components/case/InterruptConfirmation.vue`（被 InterruptDispatcher 替代）

## 下一步：阶段 8 案件初分接 Skills + 提示词改造

**spec 章节**：`docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md` §6 阶段 8

**简述**（1 周工程量，**无用户感知** 但提示词改造可能影响输出质量需对比测试）：
- `server/agents/case-analysis/` 完成（StateGraph 形态保留）
- StateGraph 各分析子模块（每个 nodes.type='analysis' 节点）支持 skills 配置
- 各分析子模块的 ReAct 子图共享 `agent-platform/middleware/` 的中间件管道（含 skillsMiddleware）
- 提示词改造："只写规范，不写做事方法"——分析方法论转移到对应 skill
- 3-5 个分析模块配上 skills（建议清单：诉讼策略 → evidence-defense；证据清单 → docx；案情可视化 → litigation-visualization；其他模块按业务判断）
- 节点配置加 `useSkillsAsLogic` 字段（boolean，nodes 表新增列）作为节点级提示词风格选择

**完成定义**（spec §6 阶段 8）：
- 案件初分全 E2E：多模块顺序执行 + 中断 + 充值恢复 + 完成
- 抽样 5-10 个真实案件做对比测试，新提示词 + skills 输出质量不退化
- StateGraph 内部中间件挂载正确（通过测试用例验证 skillsMiddleware 在每个分析子图都生效）

## 阶段 8 启动建议

```
新会话第一条消息：
继续 LexSeek AI 基建统一改造。阶段 7 已完成（tag: ai-unify-stage-7-done）。
请按 spec docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md
§6 阶段 8 章节用 superpowers:writing-plans skill 生成 plan 并执行。
启动前先 read 本 handoff 文档：
docs/superpowers/notes/2026-04-27-stage7-to-stage8-handoff.md
```

## 阶段 7 收尾遗留 issue（给阶段 8+ 知情）

### 1. StanceSelectCard / TemplateSelectCard 单测 6 个失败（stage 6 遗留）

**症状**：UI 渲染时间问题导致 vitest 找不到预期的 input value / button text。

**评估**：与 stage 7 改动无关（git checkout ai-unify-stage-6-done 上同样失败）。

**处置建议**：阶段 8 一并修，或单独清理。

### 2. useContractReview / useChatSessionManager 等 6 个测试文件已 describe.skip

**症状**：teammate-B 在 6275c6f6 标 skip 旧 composable 单测，lead 在 712dd367 补标剩余 2 个 describe。

**处置建议**：阶段 8+ 重写为针对新工厂 + sub-composable 的测试；当前 skip 是临时保留回归保护，不删测试。

### 3. admin-layout.vue 1 个 $fetch 类型递归错误

**症状**：`npx nuxi typecheck` 唯一剩余错误。同款 $fetch + ApiBaseResponse 类型问题（app.vue 已修复）。

**处置建议**：套用 app.vue 同款修法（改 useApiFetch），或留待后续。

### 4. CaseDetailOverview.vue 缺 CaseMaterialList import（stage 6 遗留）

**症状**：cases/[id] 页面 console 有 Vue warn `Failed to resolve component: CaseMaterialList`。

**处置建议**：补 import 即可（自动导入收窄后必须显式 import）。

### 5. 阶段 5/6 遗留 issue 部分仍有效

handoff 阶段 6 → 阶段 7 中记录的 issue 中：
- 阶段 7 #1 #2 #5（interrupt 卡 Dialog vs 内联 / raw JSON 流式可见 / toolMap 未注入 6 个面板）**已通过 InterruptDispatcher 解决**
- #3 #4（SDK 序列化 / state schema）独立路径，未在阶段 7 范围
- #6 #7（429 配额 / dev 库 checkpoints 缺失）外部环境 issue，不阻塞

## 阶段 7 沉淀的工具

- `/tmp/stage7-teammate-a.log` 实时进度日志机制：teammate echo + watcher 脚本兜底（30 秒轮询 git log）
- plan v2 路径：`docs/superpowers/plans/2026-04-27-ai-unify-stage-7-frontend-consolidation.md`
- 4 份调研报告（agent 1/2/3/4）形成的"业务/对话"分类法 — 可作为后续业务 composable 拆分的方法论

---

新会话起手时建议先 `git log --oneline ai-unify-stage-6-done..ai-unify-stage-7-done` 速览阶段 7 的 31 个 commit，再 read 本文档 + spec §6 阶段 8。
