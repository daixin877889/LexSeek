# 阶段 7 · 前端基建统一（工厂补能 + 业务拆分 + 调用方迁移）

**规划时间**：2026-04-27（v2，二轮论证后修订）
**执行工期**：1.5 天（按本项目历史节奏，阶段 2 基建大改 45 commit 实际仅 3 小时 47 分钟）
**Lead**：Opus 4.7
**Teammate**：1 × sonnet 4.6（工厂大改 + 业务拆 + 调用方迁移 串行）

---

## v2 与 v1 的差异（必读）

| 维度 | v1（已废弃） | v2 真相 |
|------|------|------|
| 业务 composable 命运 | "薄包装 30-50 行替代" | **业务字段拆 sub-composable，对话基建抽到工厂** |
| 工期 | 3-4 天 | **1.5 天**（按本项目历史节奏） |
| 工厂 521 行评价 | "已完成" | **6 项关键能力缺失**，需大改 |
| 测试处理 | 漏了 | **新增 13 个 .test.ts 改写任务** |
| 调用方数 | 9-10 | 真实 9 个（注释假阳性） |

---

## 一、二轮论证事实基础

### 1.1 spec 原文（已直接核对 line 891-902 + line 627-633）

> - `useDomainAgentSession` 工厂实现完整
> - 6 个业务 composable 收敛为薄包装（30-50 行）
> - 删除：`useCaseChat.ts` / `useAssistantChat.ts` / `useXiaosuoChat.ts` / `useChatSessionManager.ts` / `useModuleChatManager.ts` / `useDocumentDraft.ts` / `useContractReview.ts` / `useInitAnalysis.ts`（破坏性更新允许）
> - Interrupt 注册表实现 + `case/interrupt/` 各 handler 注册
> - 删除 `app/components/caseAnalysis/interrupts/` 目录（功能并入 `case/interrupt/`）
> - 删除 `app/components/caseAnalysis/promptInput.vue`（功能由 `ai/AiPromptInput.vue` 提供）
> - SSE custom event 类型化分发器在工厂内置

破坏性更新由 spec §1 D18 决策授权。

### 1.2 当前工厂 6 项缺失能力（4 份 agent 报告交叉验证）

| 缺失能力 | 影响范围 |
|---|---|
| **单 session 模式** | document / contract / legal_assistant / case_analysis_init 是单 session（draftId/reviewId/sessionId-from-route 驱动），工厂当前强假设多 session |
| **多 key 池化** | useModuleChatManager 每个 moduleName 独立 sessionManager 实例，工厂当前是单实例多 session |
| **业务事件 dispatcher 钩子** | createEventDispatcher 是空壳。draft_ready / contract_stage / analysis_result_saved 等业务事件不分发 |
| **流末回拉 hook** | useDocumentDraft.refetchLatestDraft / useContractReview.refreshReview 都需要"流完了 GET 业务实体"，工厂没钩子 |
| **sendMessage 多签名兼容** | useAssistantChat 接 `AiPromptSubmitData`、useDocumentDraft 接 `string`、useContractReview 没有 sendMessage（用 stance/submit）。dispatcher 与工厂顶层 sendMessage 是两条平行路径（已知 bug）|
| **业务专属 API 端点** | 工厂 case scope 走 xiaosuo-sessions，模块对话需要 module-sessions?moduleName=xxx；document/contract 是单 session 由 draftId/reviewId 驱动无 sessions list |

### 1.3 业务 composable 真实可收编量（agent 3 report）

| Composable | 总行数 | 对话基建（抽工厂） | 业务专属（拆 sub-composable 或下沉） |
|---|---|---|---|
| useDocumentDraft | 499 | 130 行（26%） | 369 行（拆 versions/snapshots/preview） |
| useContractReview | 479 | 90 行（19%） | 389 行（拆 stages/risks-editing/lifecycle） |
| useInitAnalysis | 122 | ~5 行（4%） | 117 行；实际基建在 useInitAnalysisRuntime 281 行需调研 |
| useModuleChatManager | 169 | 130 行（77%） | 39 行（拆 useChatInstancePool 基建 + 业务元数据） |
| useAssistantChat | 118 | 几乎全部对话 | 5-10 行业务（sessionId remount 模式） |
| useXiaosuoChat | 15 | 已是薄包装 | 0 |
| useCaseChat | 54 | 全部对话基建 | 0 |
| useChatSessionManager | 462 | 全部对话基建 | 0 |
| **合计** | **1918** | **~990 行进工厂** | **~920 行拆 sub-composable** |

### 1.4 真实调用方（注释引用已剔除）

| # | 调用方 | 旧依赖 | 迁向 |
|---|---|---|---|
| 1 | AssistantChatPanel.vue | useAssistantChat | useLegalAssistantAgent |
| 2 | CaseDetailXiaosuo.vue | useXiaosuoChat (props) | useCaseMainAgent (props) |
| 3 | cases/[id].vue（小索部分） | useXiaosuoChat | useCaseMainAgent |
| 4 | cases/[id].vue（模块对话部分） | useModuleChatManager | useCaseModuleAgent |
| 5 | AnalysisModuleChat.vue | ModuleChatInstance (props) | ModuleAgentInstance (props) |
| 6 | AnalysisModuleChatBar.vue | ModuleChatInstance (props) | ModuleAgentInstance (props) |
| 7 | document/drafts/[id].vue | useDocumentDraft | useDocumentAgent + sub-composables |
| 8 | ContractReviewPanel.vue | useContractReview | useContractAgent + sub-composables |
| 9 | cases/init-analysis/[sessionId].vue | useInitAnalysis | useCaseAnalysisInitAgent |

### 1.5 测试文件清单（13 个 .test.ts 需改写）

```
tests/app/components/ai/composables/crossTabQueue.test.ts
tests/app/components/ai/composables/useChatSessionManager.test.ts
tests/client/composables/useChatSessionManager.test.ts
tests/client/composables/useDocumentDraft.extensions.test.ts
tests/app/composables/useContractReview.test.ts
tests/app/composables/useContractReview.debounce.test.ts
tests/app/composables/useBusinessErrorCapture.test.ts（注释提及，需核实）
tests/app/composables/useContractRiskHighlight.test.ts（注释提及，需核实）
tests/app/components/assistant/contract/ContractReviewPanel.test.ts
tests/app/components/assistant/contract/ContractReviewPanel.phaseB.test.ts
tests/client/composables/useInitAnalysis.comparison.test.ts
tests/client/composables/useInitAnalysis.modulesCompute.test.ts
（剩余 1 个待 grep 确认）
```

### 1.6 阶段 8 不依赖阶段 7

阶段 8（案件初分接 Skills + 提示词改造）是后端 StateGraph 改造，与前端工厂无关。阶段 7 失败不卡阶段 8。

---

## 二、修订后的 7 步执行顺序

### Step 1 · 工厂补能（~0.3 天）

补全 §1.2 列出的 6 项缺失能力 + 修 dispatcher 平行路径 bug。

**文件**：`app/composables/agent-platform/useDomainAgentSession.ts`

**新增工厂签名**：

```typescript
useDomainAgentSession(config: {
  scope: DomainScope
  // 单 session：sessionId 由参数提供且不变；多 session：sessionId='auto' 从后端列表选首个
  sessionId: Ref<string> | string | 'auto'
  userId: string
  caseId?: number
  moduleName?: string  // case scope，模块对话用，决定 API 端点
  // 业务方注入
  onCustomEvent?: (event: AgentCustomEvent) => void
  onStreamSettled?: () => void | Promise<void>  // 流末回拉 hook
  apiEndpoints?: {
    listUrl?: (caseId?: number, moduleName?: string) => string
    chatUrl?: string
    createUrl?: string
    deleteUrl?: (sessionId: string) => string
    renameUrl?: (sessionId: string) => string
  }  // 默认按 scope 推断，业务方可覆盖
}): {
  // ... 与原 22 个 API 一致
}
```

**多 key 池化新增 API**（用于 useModuleChatManager 替代）：

```typescript
useDomainAgentSessionPool(config): {
  getOrCreate(key: string, extraConfig?): SessionFactory
  remove(key: string): void
  keys(): string[]
}
```

### Step 2 · 业务字段拆 sub-composable（~0.4 天）

| sub-composable | 提取自 | 行数估计 |
|---|---|---|
| useDocumentDraftVersions | useDocumentDraft 行 366-424 | ~60 |
| useDocumentDraftSnapshots | useDocumentDraft 行 427-446 | ~20 |
| useDocumentDraftPreview | useDocumentDraft 行 449-457 | ~10 |
| useDocumentDraftFields | useDocumentDraft 行 165-248（mountDraft + onFieldChange） | ~80 |
| useContractReviewStages | useContractReview 行 57-154（stage/clause 状态） | ~80 |
| useContractReviewRisksEditing | useContractReview 行 381-412（patchRisks 乐观更新） | ~30 |
| useContractReviewLifecycle | useContractReview 行 249-371（onStart/mountReview/onStance/cancelReview） | ~120 |
| useInitAnalysisModules | useInitAnalysis 行 19-77（computeModuleStates + projection 接线） | ~60 |

### Step 3 · 6 个薄包装重写（~0.1 天）

每个 30-50 行：
- useCaseMainAgent（小索）
- useCaseModuleAgent（模块对话，用 useDomainAgentSessionPool）
- useLegalAssistantAgent
- useDocumentAgent
- useContractAgent
- useCaseAnalysisInitAgent

### Step 4 · 9 个调用方迁移（~0.3 天）

按依赖顺序（薄 → 重）：
1. AssistantChatPanel.vue
2. CaseDetailXiaosuo.vue + cases/[id].vue（小索部分）
3. cases/[id].vue（模块对话）+ AnalysisModuleChat + AnalysisModuleChatBar
4. document/drafts/[id].vue
5. ContractReviewPanel.vue
6. cases/init-analysis/[sessionId].vue

### Step 5 · InterruptRegistry 真接入（~0.1 天）

1. 写 `app/components/InterruptDispatcher.vue`：根据 `interrupt.type` 查 registry 并渲染对应组件
2. 在 `app/plugins/initInterruptRegistry.ts` 中 `import '~/components/case/interrupt'` 触发副作用
3. 6 个调用方页面/组件用 `<InterruptDispatcher>` 替换 `<CaseInterruptConfirmation>` + `<InterruptHandler>`
4. 6 个 handler props 协议统一（约定 `:interrupt :on-resolve` 单一接口）
5. 删 `app/components/case/InterruptConfirmation.vue`（被 Dispatcher 替代）

### Step 6 · 删除清理（~0.1 天）

按依赖反向顺序删：
1. 8 个旧 composable
2. `app/components/caseAnalysis/interrupts/`（0 引用孤儿）
3. `app/components/caseAnalysis/promptInput.vue` + 适配 `analysis/index.vue`（迁到 AiPromptInput）
4. 检查 `model-selector/` 决策（D1=B 保留，不动）

### Step 7 · 测试改写（~0.2 天，与 Step 6 并行）

13 个 .test.ts 全部改到针对新工厂 / 新 sub-composable / 新薄包装。**不删测试**，保留回归保护。

### Step 8 · Lead 收尾（~0.1 天）

1. `npx nuxi typecheck` exit 0
2. `npx vitest run` 全绿
3. 6 业务页面 smoke E2E（init-analysis / cases / xiaosuo / assistant / document / contract）
4. commit + tag `ai-unify-stage-7-done`
5. 写 stage 7 → stage 8 handoff 文档
6. **kill -9 dev server**（feedback memory 铁律）

---

## 三、风险与缓解

| 风险 | 级别 | 缓解 |
|---|---|---|
| 工厂改造期间业务跑不动 | 中 | 先补工厂能力（Step 1），不动旧 composable；新工厂能力就绪才迁调用方（Step 4）。每补一个能力立即 commit，可独立回退 |
| 13 测试改写丢失回归保护 | 中 | 改写顺序：先把测试切到新工厂跑通，再删旧 composable。**不删测试**，只改测试 import |
| useInitAnalysisRuntime 281 行未拆 | 低 | Step 1 前快速调研 281 行的对话/业务比例，按需调整 Step 2 工期 |
| useContractReview 乐观更新+回滚机制搬迁破坏行为 | 中 | sub-composable 写完后立即跑 `useContractReview.test.ts`，验证 onEditRisks debounce 500ms 行为不变 |
| useModuleChatManager 多实例池语义复杂 | 中 | useDomainAgentSessionPool 实现后先跑 cross-tab queue 测试 + 多模块同时打开场景 |
| 9 个调用方有签名差异 | 低 | 工厂 sendMessage 多签名兼容；薄包装 props 严格按旧 composable 签名做适配层 |
| 工厂 dispatcher 平行路径 bug | 低 | Step 1 第一件事就是修这个：dispatcher 内 currentChat.sendMessage 改为调工厂的 sendMessage |

---

## 四、决策记录

| 决策 | 拍板 | 时间 |
|------|------|------|
| D1 · model-selector 处置 | B（保留） | 2026-04-27 |
| D2 · teammate 组织 | 单 teammate 串行（v1 选 B 双 teammate，v2 改为单 teammate，因任务强依赖） | 2026-04-27 v2 |
| D3 · 业务字段处理 | 拆 sub-composable（不删，不下沉调用方） | 2026-04-27 v2 |
| D4 · 测试处理 | 改写不删 | 2026-04-27 v2 |
| D5 · 阶段 8 依赖性 | 阶段 8 不依赖阶段 7，本阶段失败可降级 | 2026-04-27 v2 |

---

## 五、DoD（完成定义，与 spec §6 阶段 7 对齐）

- [ ] `useDomainAgentSession` 工厂含 §1.2 全部 6 项能力
- [ ] 8 个旧 composable 全部删除
- [ ] 6 个业务薄包装在 30-50 行
- [ ] 业务 sub-composable 全部就绪（Step 2 列出的 8 个）
- [ ] InterruptRegistry 副作用触发 + 6 调用方接入 InterruptDispatcher
- [ ] `caseAnalysis/interrupts/` 删除
- [ ] `caseAnalysis/promptInput.vue` 删除（analysis/index.vue 已切到 AiPromptInput）
- [ ] 13 测试改写到新结构 + 全绿
- [ ] `npx nuxi typecheck` exit 0
- [ ] 6 业务页面 smoke E2E 全绿
- [ ] tag `ai-unify-stage-7-done` + handoff 文档
- [ ] dev server killed

---

## 六、附录：4 份调研报告引用

- Agent 1（spec + 历史）：spec §6 阶段 7 全文 + 6 阶段 handoff 已读完
- Agent 2（接口对照）：8 旧 composable + 9 调用方 + 工厂 三方对照表
- Agent 3（业务/对话拆分）：4 个重业务 composable 行数级分类
- Agent 4（UI 卡片现状）：中断卡 / promptInput / model-selector 盘点

---

**v2 完成**。lead 立即按 Step 1 启动 teammate-A。
