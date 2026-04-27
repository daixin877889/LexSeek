# 阶段 7 · 前端复用收敛（工厂化 + Interrupt 注册表）

**规划时间**：2026-04-27  
**执行时间**：~3-4 天（3-5 个工作日）  
**工程量**：1 × sonnet 4.6（平台层）+ 1 × sonnet 4.6（调用方迁移）+ lead 监控收尾

---

## 一、背景与目标

**现状**：8 个业务 composable（共 1918 行），分散在 `app/composables/` 各自实现流管理、中断处理、消息队列、多会话管理。
- `useStreamChat`（261 行）— 泛型流管理内核（保留）
- `useChatSessionManager`（462 行）— 会话、竞态、跨标签同步（重复、待内化）
- `useCaseChat`（54 行）— 案件分析特化（重复、待内化）
- `useAssistantChat`、`useXiaosuoChat`、`useModuleChatManager`、`useDocumentDraft`、`useContractReview`、`useInitAnalysis` — 业务特化层（6 个，待薄包装）

**目标**：收敛为 **单工厂** + **6 个薄包装**（30-50 行 × 6）+ **interrupt 注册表**
- 删除 8 个旧 composable、两个 interrupt 目录、1 个无用组件
- 消费者无感知切换（内部重构）
- `ai-elements/model-selector/` 保留（用户 D1=B 决定）

**用户感知**：无（纯技术债清理）

---

## 二、决策记录（用户拍板 2026-04-27）

| 决策 | 项目 | 选项 | 拍板 |
|------|------|------|------|
| **D1** | `ai-elements/model-selector/` 处置 | A: 删除 / B: 保留 | **B**（保留以待后续功能） |
| **D2** | teammate 组织 | A: 1× opus / B: 2× sonnet（推荐） / C: 3× haiku | **B**（平台层+调用方迁移并行） |
| **D3** | 改造方式 | A: 一次全切（推荐） / B: 分批 | **A**（一次性同步全部调用方） |

---

## 三、现状盘点（grep 真实代码）

### 3.1 待删 composable 及其调用方

| Composable | 行数 | 调用方数 | 说明 |
|---|---|---|---|
| `useCaseChat` | 54 | 0（仅内部依赖） | 内核，工厂内化 |
| `useChatSessionManager` | 462 | 3 个 composable | 内核，工厂内化 |
| `useAssistantChat` | 118 | 1 页面 | 业务，→ `useLegalAssistantAgent` |
| `useXiaosuoChat` | 15 | 2 页面 | 业务，→ `useCaseMainAgent` |
| `useModuleChatManager` | 169 | 3 页面 | 业务，→ `useCaseModuleAgent` |
| `useDocumentDraft` | 499 | 1 页面 | 业务，→ `useDocumentAgent` |
| `useContractReview` | 479 | 2 页面 | 业务，→ `useContractAgent` |
| `useInitAnalysis` | 122 | 1 页面 | 业务，→ `useCaseAnalysisInitAgent` |
| **总计** | **1918** | **8-9 个页面/组件** | |

### 3.2 调用方页面清单

8-9 个实际调用位置（某些文件有多个 composable 使用）：
1. `app/components/assistant/AssistantChatPanel.vue` — useAssistantChat
2. `app/pages/dashboard/cases/[id].vue` — useXiaosuoChat、useModuleChatManager
3. `app/components/caseDetail/CaseDetailXiaosuo.vue` — useXiaosuoChat
4. `app/components/case/AnalysisModuleChat.vue` — useModuleChatManager
5. `app/components/case/AnalysisModuleChatBar.vue` — useModuleChatManager
6. `app/pages/dashboard/document/drafts/[id].vue` — useDocumentDraft
7. `app/components/assistant/contract/ContractReviewPanel.vue` — useContractReview
8. `app/components/assistant/contract/ContractUploadNewVersionDialog.vue` — useContractReview
9. `app/pages/dashboard/cases/init-analysis/[sessionId].vue` — useInitAnalysis

### 3.3 待删目录和文件

| 位置 | 内容 | 说明 |
|---|---|---|
| `app/components/caseAnalysis/interrupts/` | CaseInfoConfirm.vue（2 个简单 handler） | 简化版，功能复制到 `case/interrupt/` |
| `app/components/caseAnalysis/promptInput.vue` | 1 个组件 | 功能由 `ai/AiPromptInput.vue` 覆盖 |
| `app/components/ai-elements/model-selector/` | 15 个文件 | **保留**（D1=B，未来可用） |

### 3.4 Interrupt 类型现状

已有枚举（`shared/types/case.ts`）：
```typescript
export enum InterruptType {
  CASE_INFO_CHECK = 'case_info_check',
  BASIC_INFO_CONFIRM = 'basic_info_confirm',
  MODULE_SELECT = 'module_select',
  INSUFFICIENT_POINTS = 'insufficient_points',
  TEMPLATE_SELECT = 'template_select',  // ← 阶段 5/6 新增
  STANCE_SELECT = 'stance_select',       // ← 阶段 5/6 新增
}
```

当前 handler 分布：
- `app/components/case/interrupt/index.ts` — export 3 个 handler（CaseInfoCheckHandler / BasicInfoConfirmHandler / ModuleSelectHandler）
- `app/components/agents/document/interrupts/` — TemplateSelectCard
- `app/components/agents/contract/interrupts/` — StanceSelectCard
- 无集中注册表（各页面手工 v-if/v-else-if 分发）

---

## 四、改造架构

### 4.1 新的组合物结构

```
app/composables/
├── useStreamChat.ts                        （保留，内核）
├── useApi.ts / useApiFetch.ts              （保留）
├── agent-platform/                         🆕 （新目录，平台层工厂）
│   ├── useDomainAgentSession.ts            （工厂，~400-500 行）
│   ├── interruptRegistry.ts                （中断注册表，~50 行）
│   └── index.ts
├── agents/                                 🆕 （新目录，6 个业务薄包装）
│   ├── useCaseMainAgent.ts                 （← useXiaosuoChat，~40 行）
│   ├── useCaseModuleAgent.ts               （← useModuleChatManager，~40 行）
│   ├── useLegalAssistantAgent.ts           （← useAssistantChat，~40 行）
│   ├── useDocumentAgent.ts                 （← useDocumentDraft，~40 行）
│   ├── useContractAgent.ts                 （← useContractReview，~40 行）
│   ├── useCaseAnalysisInitAgent.ts         （← useInitAnalysis，~40 行）
│   └── index.ts
└── [旧 8 个 composable 删除] 🗑️
```

### 4.2 工厂签名（核心契约）

```typescript
export function useDomainAgentSession(config: {
  scope: 'case' | 'legal_assistant' | 'document' | 'contract' | 'case_analysis_init'
  sessionId: string
  userId: string
  caseId?: number                          // scope='case' 时必填
}): {
  messages: Ref<BaseMessage[]>
  isLoading: Ref<boolean>
  interruptData: Ref<InterruptPayload | null>
  runStatus: Ref<AgentRunStatus>
  runError: Ref<string | null>
  sessions: Ref<SessionItem[]>
  currentSessionId: Ref<string>
  
  // 核心操作
  sendMessage: (text: string, opts?: SendOpts) => Promise<void>
  resumeInterrupt: (value: any) => void
  init: () => Promise<void>
  switchSession: (sessionId: string) => Promise<void>
  createSession: () => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  stopGeneration: () => Promise<void>
  
  // 队列（case/legal_assistant/document/contract 需要）
  currentQueue: Ref<QueueItem[]>
  currentQueueLen: Ref<number>
  isQueuePaused: Ref<boolean>
  queuePauseReason: Ref<string | null>
  enqueueMessage: (text: string, files?: any[], thinking?: boolean) => boolean
  removeQueueItem: (id: string) => void
  resumeQueue: () => void
  clearQueue: () => void
}
```

### 4.3 Interrupt 注册表设计

```typescript
// composables/agent-platform/interruptRegistry.ts
export class InterruptRegistry {
  private handlers = new Map<string, {
    component: Component
    isToolCard?: boolean  // 区分 TemplateSelectCard/StanceSelectCard（工具卡） vs 中断卡
  }>()

  register(type: string, handler: InterruptHandler): void
  getComponent(type: string): Component | undefined
  isToolCard(type: string): boolean
  getAllTypes(): string[]
}

export const globalInterruptRegistry = new InterruptRegistry()

// case/interrupt/index.ts
globalInterruptRegistry.register('case_info_check', CaseInfoCheckHandler)
globalInterruptRegistry.register('basic_info_confirm', BasicInfoConfirmHandler)
globalInterruptRegistry.register('module_select', ModuleSelectHandler)
globalInterruptRegistry.register('insufficient_points', InsufficientPointsCard)
globalInterruptRegistry.register('template_select', TemplateSelectCard, { isToolCard: true })
globalInterruptRegistry.register('stance_select', StanceSelectCard, { isToolCard: true })
```

### 4.4 SSE Custom Event 类型化分发器

工厂内置 `createEventDispatcher(scope)` 工具函数，根据 scope 返回对应的消息处理器，处理 DRAFT_SAVED / CONTRACT_REVIEW_SAVED / ANALYSIS_RESULT_SAVED 等自定义事件流。

---

## 五、关键改造列表

### 5.1 Platform 层（teammate-1，~2-3 天）

| Task | 说明 | 交付物 |
|---|---|---|
| **A1** | 创建 `composables/agent-platform/useDomainAgentSession.ts` 工厂 | 工厂主体（~450 行）+ 契约签名 |
| **A2** | 创建 `composables/agent-platform/interruptRegistry.ts` 注册表 | InterruptRegistry class + 全局单例 |
| **A3** | 工厂内置 SSE custom event 类型化分发器 | 事件分发器逻辑 + 类型映射 |
| **A4** | 6 个薄包装 composable（`composables/agents/*.ts`） | useCaseMainAgent / useCaseModuleAgent / useLegalAssistantAgent / useDocumentAgent / useContractAgent / useCaseAnalysisInitAgent |

**技术要点**：
- A1 继承 useChatSessionManager 的所有逻辑（effectScope、竞态防护、消息队列、跨标签同步、stopGeneration 取消）
- A1 整合 useStreamChat 的流处理
- A4 中每个薄包装是工厂的 call wrapper，负责 config 组装 → 调 useDomainAgentSession（scope+sessionId+userId+caseId）→ 返回

### 5.2 Interrupt 注册注册表接入（teammate-1，A4 完成后）

| Task | 说明 |
|---|---|
| **A5** | `app/components/case/interrupt/index.ts` 改造：自动 register 3 个 handler + TemplateSelectCard / StanceSelectCard |

### 5.3 调用方迁移（teammate-2，等 A4 完成后启动，~2 天）

| Task | 调用方页面 | 迁移方向 | 说明 |
|---|---|---|---|
| **B1** | AssistantChatPanel.vue | useAssistantChat → useLegalAssistantAgent | 1 个 hook → 工厂 call |
| **B2** | CaseDetailXiaosuo.vue | useXiaosuoChat → useCaseMainAgent | 同上 |
| **B2.1** | cases/[id].vue（xiaosuo 部分） | useXiaosuoChat → useCaseMainAgent | 同上 |
| **B3** | AnalysisModuleChat.vue | useModuleChatManager → useCaseModuleAgent | 同上 |
| **B3.1** | AnalysisModuleChatBar.vue | useModuleChatManager → useCaseModuleAgent | 同上 |
| **B3.2** | cases/[id].vue（模块对话部分） | useModuleChatManager → useCaseModuleAgent | 同上 |
| **B4** | document/drafts/[id].vue | useDocumentDraft → useDocumentAgent | 同上 |
| **B5** | ContractReviewPanel.vue | useContractReview → useContractAgent | 同上 |
| **B5.1** | ContractUploadNewVersionDialog.vue | useContractReview → useContractAgent | 同上 |
| **B6** | cases/init-analysis/[sessionId].vue | useInitAnalysis → useCaseAnalysisInitAgent | 同上 |

### 5.4 清理删除（teammate-2，B1-B6 完成后）

| Task | 删除项 | 说明 |
|---|---|---|
| **B7.1** | 8 个旧 composable | useCaseChat.ts / useChatSessionManager.ts / useAssistantChat.ts / useXiaosuoChat.ts / useModuleChatManager.ts / useDocumentDraft.ts / useContractReview.ts / useInitAnalysis.ts |
| **B7.2** | caseAnalysis 目录 | `app/components/caseAnalysis/interrupts/` (2 文件) + `app/components/caseAnalysis/promptInput.vue` |
| **B7.3** | 孤儿导入清理 | 各文件中对上述 composable/组件的导入行 |

---

## 六、任务依赖与时间线

```
Day 1 (teammate-1):  A1 工厂 → A2 注册表 → A3 分发器
Day 2 (teammate-1):  A4 薄包装 × 6
       (teammate-2): 准备期——read 8 个调用方现状 + 写迁移记录 + 待命 A4 完成

Day 3 (teammate-1):  A5 interrupt 注册
       (teammate-2):  B1-B6 调用方同步迁移（可并行改多个页面）

Day 4 (teammate-2):  B7 删除清理

Lead : L1 plan/dispatch (Day 1) → L2-L3 监控 (Day 1-4) → L4 smoke (Day 4) → L5 typecheck + vitest (Day 4) → L6 commit+tag+handoff+kill dev (Day 4)
```

---

## 七、DoD（完成定义）

### 7.1 Teammate-1 验收标准

- [ ] `useDomainAgentSession` 工厂实现完整（覆盖 6 个 scope、5 个业务 composable 的全部调用方式）
- [ ] `interruptRegistry` 能正确注册 7 个 interrupt 类型（case_info_check 等）
- [ ] 6 个薄包装 composable 能替代旧 composable（签名兼容或文档说明差异）
- [ ] 文件结构符合规范：`composables/agent-platform/`、`composables/agents/` 两个新目录
- [ ] **不能**跑全量 typecheck / vitest（teammate 权限限制），仅检查相关文件编译

### 7.2 Teammate-2 验收标准

- [ ] 8-9 个调用方页面都已从旧 composable 迁移到新 agent 工厂
- [ ] 旧 8 个 composable、caseAnalysis 两个路径已删除
- [ ] 孤儿导入已清理
- [ ] **不能**跑全量 typecheck / vitest

### 7.3 Lead 验收标准

- [ ] `npx nuxi typecheck` exit 0
- [ ] `npx vitest run` 全绿（或已标跳跃）
- [ ] **6 个业务页面 smoke 全绿**：
  - `init-analysis/1` — 初分流程启动
  - `cases/1` 案件详情 — 模块对话 + 小索浮窗
  - `assistant` 页面 — 法律助手对话
  - `document/drafts/1` — 文书编辑页
  - `dashboard/contract/1` — 合同审查页
  - 其他 1 个补充（如 cases/1?focus=xiaosuo 小索 E2E）
- [ ] commit + tag `ai-unify-stage-7-done`
- [ ] handoff 文档至 stage 8

---

## 八、风险与缓解

| 风险 | 级别 | 描述 | 缓解 |
|---|---|---|---|
| 工厂签名变更导致调用方大批改写失败 | 高 | A4 中途如果调整薄包装的参数列表，teammate-2 的迁移工作要重做 | A1-A4 完成后冻结签名，teammate-2 开始前 lead 核对一遍 |
| 中断注册表初始化时机问题 | 中 | register() 在页面加载前必须完成，否则 interrupt 无法分发 | 在 app.vue 全局 setup 中调用 case/interrupt/index.ts（触发 register） |
| cases/[id].vue 同时使用 xiaosuo + moduleChatManager | 中 | 同一页面两个 agent scope 可能相互干扰（effectScope 隔离） | 各 agent 独立 effectScope，测试时重点验证切换 session 场景 |
| useStreamChat 内核依赖未迁移完整 | 中 | useStreamChat getter 特性（与 interruptComputed 的 bug 关系） | A1 必须保留对 useStreamChat 的依赖，不删除 |
| 消息队列逻辑散落在多个 composable（useCaseChat / useChatSessionManager） | 中 | 收敛后如果遗漏某条分支，队列行为变更 | 写完 A4 后 grep 源码对标，确保 enqueueMessage / resumeQueue / clearQueue 逻辑完整转移 |

---

## 九、技术参考

### 现有代码引用
- **useStreamChat**：app/composables/useStreamChat.ts（保留，getter 机制）
- **useChatSessionManager**：app/composables/useChatSessionManager.ts:232（sendMessage 双轨 additional_kwargs）
- **InterruptType**：shared/types/case.ts:203
- **SSECustomEventType + SSECustomEventMap**：shared/types/agentEvent.ts:43-152
- **现有 interrupt handler**：app/components/case/interrupt/（3 个 handler）

### 关键约束
1. 所有 composable 必须手动 import（自动导入已收窄）
2. 类型必须 import type from `#shared/types/*`
3. 工厂内化 useChatSessionManager 的全部逻辑：effectScope / 消息队列 / 竞态防护 / 跨标签同步 / stopGeneration
4. 不可删除 useStreamChat，只是整合进工厂
5. 薄包装与旧 composable 的对应关系要在对照表中文档化

---

## 十、对照表（旧 composable → 新 agent 工厂映射）

| 旧 Composable | 行数 | 新 Agent | 行数 | 主要职责 | 迁移注意点 |
|---|---|---|---|---|---|
| useAssistantChat | 118 | useLegalAssistantAgent | ~40 | 法律助手对话入口 | scope='legal_assistant' |
| useXiaosuoChat | 15 | useCaseMainAgent | ~40 | 小索浮窗入口 | scope='case', caseId 必填 |
| useModuleChatManager | 169 | useCaseModuleAgent | ~40 | 案件模块对话 | scope='case', 多 session 管理 |
| useDocumentDraft | 499 | useDocumentAgent | ~40 | 文书生成对话 | scope='document' |
| useContractReview | 479 | useContractAgent | ~40 | 合同审查对话 | scope='contract' |
| useInitAnalysis | 122 | useCaseAnalysisInitAgent | ~40 | 案件初分分析 | scope='case_analysis_init' |
| useCaseChat | 54 | 内化进工厂 | - | 案件分析对话基座 | 不直接暴露 |
| useChatSessionManager | 462 | 内化进工厂 | - | 会话管理 / 消息队列 / effectScope | 不直接暴露 |

---

## 十一、附录：smoke E2E 检查清单

```
- [ ] `localhost:3000/dashboard/cases/init-analysis/1` — 初分流程：启动 → 各分析模块顺序执行 → 完成
- [ ] `localhost:3000/dashboard/cases/1` — 案件详情：
  - [ ] 小索浮窗能打开、发消息、显示工具卡
  - [ ] 模块对话能切换、历史消息加载正常
  - [ ] 两个会话互不影响
- [ ] `localhost:3000/assistant` — 法律助手：
  - [ ] 能发送消息、工具卡正常显示
  - [ ] 多 session 切换正常
- [ ] `localhost:3000/dashboard/document/drafts/1` — 文书编辑页：
  - [ ] 能发消息、工具卡显示
  - [ ] 返回链接（来源条）能跳回对应原点
- [ ] `localhost:3000/dashboard/contract/1` — 合同审查页：同上
- [ ] `localhost:3000/dashboard/cases/1?focus=xiaosuo&xiaosuoSessionId=xxx` — 小索 URL focus：浮窗自动展开、session 自动定位
```

---

**完成时间估计**：3-4 个工作日（平台层 2 天 + 调用方迁移 1-2 天 + 收尾 < 1 天）
