# AI 任务"停止 / 中断 / 队列"统一治本设计

- 日期：2026-05-14
- 范围：通用问答、文书生成、合同审查、案件分析（小索 / 模块对话 / 初始分析）全部 AI 对话入口
- 状态：设计稿，待评审通过后转实施计划

## 1. 背景

用户反馈"通用问答在分析过程中点了停止之后，再也发不出新消息"。根因排查后发现并非局部 bug，而是一组系统性问题：

- **B1：前端"停止"动作没真正传到后端**。"停止"按钮里调的是案件分析专属的取消接口（要求会话必须挂在一个案件下），对通用问答 / 独立合同审查 / 独立文书 / 任何 caseId 为空的会话直接 404 失败，真正的后端取消请求从未发出。
- **B2：后端"取消"对"AI 正在等用户做选择"这种暂停态语义不一致**。这种状态下点取消，后端按"幂等成功"什么都不做，会话被永久卡住，后续消息要么被挡（"还有进行中的分析"），要么发了无响应。
- **B3：6 个 AI 入口里有 4 个的"放弃中断"是空函数**。即使中断卡片里有"取消"按钮，业务层不接住，用户实际无法关闭。
- **B4：UI 语义混乱**。AI 在等用户选择（暂停态）时，底部仍然显示"停止"按钮 —— 用户实际上没东西可停。

## 2. 治本目标

让"停止 AI"和"放弃 AI 的选择请求"在所有 AI 入口表现一致、行为可预期：

1. **不论从哪个入口点停止**：后台任务一定真正终结，输入框立刻可用
2. **AI 等待用户选择时**：UI 表现为"暂停"，不出现停止按钮；只有卡片自身的"放弃"出口
3. **停止 / 放弃 后未发送的队列消息**：保留并暂停，由用户决定继续还是清空
4. **所有 AI 入口（4 个 vertical × 6 张中断卡）行为一致**，未来新接入的 vertical 直接复用

## 3. 业务状态机

AI 任务从用户角度只看到三个状态：

| 状态 | 含义 | 输入框 | 底部按钮 |
|---|---|---|---|
| 闲置 | AI 已完成上一轮，等待用户 | 可输入 | 单一发送按钮 |
| 正在输出 | AI 正在打字/思考 | 可输入（输入即入队） | 停止按钮 + 加入队列按钮（+N 角标） |
| 中断中 | AI 在等用户回应卡片 | 禁用，提示"请先回应上方请求" | 无任何按钮 |

状态转移：

```
闲置 ──(用户发消息)──► 正在输出
正在输出 ──(AI 跑完)──► 闲置
正在输出 ──(AI 要求选择)──► 中断中
正在输出 ──(用户点停止)──► 闲置
中断中 ──(用户在卡片确认)──► 正在输出
中断中 ──(用户在卡片点放弃)──► 闲置
```

**重要语义区分**：

- **停止（Stop）**：用户主动打断 AI 正在进行的输出。从"正在输出"状态可达，"中断中"不可达（因为本来就没在跑）。
- **放弃（Cancel/Skip）**：用户拒绝回应 AI 提出的选择请求。仅从"中断中"状态可达，归属在中断卡片自身。
- 两个动作的最终效果都是 AI 任务终结，回到"闲置"。但用户看到的入口、按钮、文案都不同。

## 4. 消息队列规则

队列规则独立于状态机，描述用户可继续输入但 AI 还没准备好接收时的行为。

- **入队条件**：仅在"正在输出"期间，用户继续输入并提交 → 入队（上限 5 条，与现状保持一致）。**中断态输入框禁用，不能入队**（业界主流做法：MUI Chat / Vercel AI SDK / Mendix 在中断态全部禁用主输入区，避免"既在选卡片又能发新消息"造成的状态混乱）
- **自动派发**：当 AI 完成进入"闲置" → 队首消息自动发送
- **用户点停止时**：队列**保留**，整体置为"已暂停"。输入框上方出现提示条：「队列中还有 N 条消息未发送」+ [继续发送] [清空队列] 双按钮
- **用户点放弃中断时**：与停止统一行为 —— 若放弃前队列已有内容（来自正在输出阶段的入队），同样**保留 + 暂停**

不主动清空队列的理由：用户连续输入往往是一组关联问题，停止只代表"我不想看 AI 继续讲当前这条"，不代表放弃整组问题。

## 5. UI 规范

### 5.1 闲置态
- 输入框：可输入
- 底部按钮：发送
- 无队列条

### 5.2 正在输出态
- 输入框：可输入
- 底部按钮：红色方形停止按钮（`lucide-vue-next` 的 `Square` 图标 + `variant="destructive"` + `size="icon-sm"`，对齐现有 `AiPromptInput.vue:152-165`）+ 加入队列按钮（`SendHorizontal` 图标，对齐 `AiPromptInput.vue:178-189`）
- 加入队列按钮带 +N 角标显示当前队列数（队列空时 N 不显示）
- 加入队列按钮在队列满（5 条）时禁用

### 5.3 中断中态
- 输入框：禁用，placeholder 文案"请先回应上方的请求"
  - **判断依据**：`interruptData != null`（来自 `useStreamChat` 暴露的 interrupt 状态），**不依赖 `isLoading`** —— 中断态下 SDK 的 `isLoading` 仍为 true，单看 isLoading 区分不出"正在输出"与"中断中"
- 底部按钮：无（既无停止也无发送）
- 中断卡片：所有 6 张卡都必须自带"放弃"出口（积分不足卡是唯一例外，见 §7）
- 中断 Dialog 保持禁用 Esc 与遮罩点击（与现状一致）

### 5.4 停止后 / 放弃后（队列有残留）
- 输入框：可输入（用户随时可发新消息绕过队列）
- 输入框上方插入"队列提示条"组件 `QueuePausedBanner.vue`（独立组件，不嵌入 `AiPromptInput`；由各 panel 在 `<AiChat>` 上方渲染，见 §7.5）：
  - 左侧：`lucide-vue-next` 的 `AlertCircle` 图标 + 警示色调（具体走 `shadcn-vue` `Alert` 组件默认/警示变体，颜色不硬编码，由 Tailwind v4 主题变量驱动以适配深浅色） + 文案"队列中还有 N 条消息未发送"
  - 右侧：[清空队列] 次按钮（`variant="outline"`） + [继续发送] 主按钮（`variant="default"`）
- 提示条仅在队列非空且处于"已暂停"时显示
- 交互细节：
  - 点 [继续发送] → 调 `useDomainAgentSession.resumeQueue()` 立即派发队首消息（不是仅解除暂停标志，复用 `useQueueDispatcher.ts:81-146` 现有 `maybeDispatch`）
  - 点 [清空队列] → 调 `useDomainAgentSession.clearQueue()` 直接清空，不写审计日志

### 5.5 停止后 / 放弃后（无队列残留）
- 直接回到闲置态布局，无提示条

## 6. 后端能力

### 6.1 新增：通用任务控制接口（vertical 无关）

| 方法 | URL | 文件 |
|---|---|---|
| GET | `/api/v1/agent/runs/current/:sessionId` | `server/api/v1/agent/runs/current/[sessionId].get.ts` |
| POST | `/api/v1/agent/runs/cancel/:runId` | `server/api/v1/agent/runs/cancel/[runId].post.ts` |

文件命名对齐现有惯例（如 `server/api/v1/cases/analysis/runs/current/[sessionId].get.ts` / `server/api/v1/assistant/runs/cancel/[runId].post.ts`）：动作名在中间，路径参数在末尾叶子节点。

**响应格式**：使用项目通用 `resSuccess(event, msg, data)` / `resError(event, code, msg)`，与现有 `useApiFetch` 自动解包 `data` 字段的约定一致。

**归属校验逻辑**：

- 这组接口只校验"任务 / 会话归属当前登录用户"，不要求"会话必须挂在一个案件下"
- 校验链：`run.userId === auth.user.id` → 通过；否则 403
- 不读 `cases` 表，不依赖 `findCaseBySessionIdService`

**与现有接口的关系**：

- `/api/v1/cases/analysis/runs/current/:sessionId` 与 `/api/v1/cases/analysis/runs/cancel/:runId` 保留（案件分析页 `app/pages/dashboard/analysis/[sessionId].vue:208` 仍在用），但所有前端"停止"按钮的调用统一切到新通用接口
- `/api/v1/assistant/runs/cancel/[runId].post.ts` 已存在，下线时机由实施计划决定（不阻塞本次治本）

**为什么选通用接口而非各 vertical 各自补 `/runs/current/`**：

- 现状：assistant 有 cancel 没 current；case 都有；contract / document 一个都没有
- 若各 vertical 各自补，要新增 3 个文件，鉴权 + 归属校验逻辑除了 scope 名其他完全相同，是真正的重复造轮子
- "AI 任务（agent_runs）"作为底层资源，归属只看 `run.userId`，本来就不需要走 case / scope 表
- RBAC 登记是机械工作，每新增端点都要做，不构成拒绝理由

### 6.2 修复：cancelRunService 对暂停态的处理

`server/services/agent/agentRun.service.ts:127-160` 当前对 `INTERRUPTED` 状态返回"幂等成功不改 status"。这与 `findActiveRunBySessionIdDAO` 把 `INTERRUPTED` 视为活跃状态的判定矛盾，会导致：用户对暂停态发起取消后，下次再发消息会被分支判定为"还有进行中的任务"而拒绝或卡死。

**修复**：新增 `INTERRUPTED` 分支，处理逻辑：

1. 把 status 改为 `CANCELLED`、设置 `completedAt`（释放 `findActiveRunBySessionIdDAO` 的活跃判定）
2. 调用 `repairOrphanToolUseCheckpoint(run.sessionId, '用户从暂停态取消')` 释放可能残留的 LangGraph 工具调用半成品（对齐 worker catch 块的现有做法 `agentWorker.ts:418-427`，避免下一轮 invoke 时 Anthropic API 因 orphan tool_use 返回 400）

`COMPLETED / FAILED / CANCELLED` 这三种真正的终态保持"幂等成功不改 status"。

## 7. 前端改动清单

### 7.1 替换"停止"按钮调用入口（治 B1）

- `app/composables/useStopActiveRun.ts`：
  - 内部硬编码的 case 域端点替换为新通用端点（§6.1）
  - 继续使用 `useApiFetch`（已存在，自动解包 `resSuccess` 返回的 `data` 字段），类型：`useApiFetch<{ run: { id: string } | null }>(...)`
  - 函数签名不变（仍是 `stopActiveRun(sessionId)`），调用方无感
- `app/composables/agent-platform/useDomainAgentSession.ts:651`（停止按钮触发）：调用方不变，由 `stopActiveRun` 内部切到通用接口
- `app/composables/agent-platform/useDomainAgentSession.ts:502`（删除会话前 stop）：同上 —— 注意这条仅在用户主动 `deleteSession` 时触发，**不是路由切换/离开页面**（见 §8）

### 7.2 接住 4 处空函数 @cancel（治 B3）

把 4 个 panel 文件里的 `@cancel="() => {}"` 改为接住真实的放弃路径。

`resolveInterrupt`（来自 `usePanelMessageStreamContext.ts:36-45`）返回 `Promise<void>`，不能裸用 `() => resolveInterrupt(null)`（会丢异常）。统一改成在 setup 暴露的显式 `handleCancel` 函数：

```ts
async function handleCancel() {
  try {
    await resolveInterrupt(null)
  } catch (err) {
    console.error('[interrupt] cancel failed', err)
  }
}
```

模板里：`<InterruptDispatcher ... @cancel="handleCancel" />`

需要改的 4 处：

- `app/components/assistant/AssistantChatPanel.vue:184`
- `app/components/caseDetail/CaseDetailXiaosuo.vue:289`
- `app/components/case/AnalysisModuleChat.vue:238`
- `app/pages/dashboard/document/drafts/[id].vue:803`

合同审查的 panel `ContractReviewPanel.vue:578` 当前是 `() => resolveInterrupt(null)`，本次治本同步改成 `handleCancel` 形式对齐，避免裸 Promise。

**中断卡按钮文案**：保持现状（5 张卡内的按钮文案仍是"取消"），本次不强制改文案。仅要求"行为"统一 —— 卡片 emit cancel 后业务层一定接住。

### 7.3 中断态隐藏停止按钮（治 B4）

`app/components/ai/AiPromptInput.vue:151-190` 当前用 `v-else (loading)` 显示停止 + 加入队列双按钮，需要再叠一层"非中断"判断。

**透传链路**：

- `AiChat.vue` 已接收 `isInterrupted` prop（line 29），需透传到 `<AiPromptInput>`（line 206 与 245 两处都要加 `:is-interrupted="isInterrupted"`）
- `AiPromptInput.vue` 新增 prop：`isInterrupted?: boolean`，默认 false

**渲染逻辑**（防守性：即使未来 `isLoading` 的取值规则改变，也保证不在中断态露停止按钮）：

- `loading && !isInterrupted` → 显示停止 + 加入队列双按钮（现状）
- `loading && isInterrupted` → 输入框 `disabled` 置灰，不显示任何按钮，placeholder 切换为"请先回应上方的请求"
- `!loading` → 显示发送按钮（现状）

**为什么基于 `isInterrupted` 而非 `isLoading`**：当 LangGraph 进入 interrupt 状态时，SDK 暴露的 `isLoading` 仍为 true（SSE 流还在连接，等用户回应），所以单凭 `isLoading` 无法区分"正在输出"和"中断中"。必须叠加 `isInterrupted` 显式判断。

### 7.4 InsufficientPointsCard 例外说明（不改）

积分不足卡片是产品上的"故意硬卡"：**保持现有逻辑，不补"放弃"按钮**。用户必须充值或退出页面，这是产品策略而非 UX 缺陷。

需要在代码注释里写清楚这个例外，避免后续维护者按"所有中断卡都该有放弃"的统一规则误改。

### 7.5 队列提示条 UI（新组件 + panel 渲染）

新增独立组件 `app/components/ai/QueuePausedBanner.vue`，**不嵌入** `AiPromptInput`，保持后者单一职责（`AiPromptInput` 已有 7+ prop，再加队列状态会越发臃肿）。队列状态本质属于 panel 级（跨输入框与消息列表），归 panel 拥有更清晰。

**组件接口**：

```vue
<QueuePausedBanner
  :queue-length="number"
  @resume="() => void"
  @clear="() => void"
/>
```

**视觉基础**：复用 `app/components/ui/alert/`（shadcn-vue 已有），warning 样式 + `AlertCircle` 图标 + 两个按钮（`variant="outline"` + `variant="default"`）。

**渲染位置**：5 个 panel 都在 `<AiChat>` 上方插入 `<QueuePausedBanner>`，由 `v-if="currentQueueLen > 0 && isQueuePaused"` 控制显示：

- `app/components/assistant/AssistantChatPanel.vue`
- `app/components/caseDetail/CaseDetailXiaosuo.vue`
- `app/components/case/AnalysisModuleChat.vue`
- `app/pages/dashboard/document/drafts/[id].vue`
- `app/components/assistant/contract/ContractReviewPanel.vue`

各 panel 从 `useDomainAgentSession` 暴露的 `currentQueueLen` / `isQueuePaused` / `resumeQueue` / `clearQueue`（`useDomainAgentSession.ts:794-799` 已存在）注入。

**派发策略**（明确）：

- `@resume` → 调 `resumeQueue()` 立即触发 `maybeDispatch()` 派发队首消息（不是仅解除暂停标志）。复用 `useQueueDispatcher.ts:81-146`
- `@clear` → 调 `clearQueue()` 直接清空，不写审计日志

## 8. 不在本次治本范围（YAGNI）

明确列出避免实施时偷塞：

- **不重构现有的 case 域旧端点**（`/api/v1/cases/analysis/runs/*`）。它们仍被 `app/pages/dashboard/analysis/[sessionId].vue:208` 使用，本次只让停止按钮的入口切走。
- **不改造业务逻辑层的 cancel 调用方**。`server/agents/contract/contractReview.service.ts` 等内部主动 cancel 的代码保持不变。
- **不引入新的"暂停 / 恢复"状态**。中断态本质是 LangGraph 的 interrupt，不在数据层新增 PAUSED status。
- **不做"输入即拒绝"风格**（Cursor 那种）。法律行业 B2B 工具用户对隐式动作敏感。
- **不在路由切换 / 离开页面时自动停止任务**（产品原则）。AI 任务在后台继续跑，用户回到会话后通过 SSE checkpointer 恢复展示。当前 `useDomainAgentSession` 没有 `beforeRouteLeave` 自动 stop 逻辑，本次治本不引入。仅 `deleteSession`（用户主动删除会话）才触发 stop。

## 9. 回归用例（验收清单）

每条 vertical × 4 个场景共 24 项必须全过：

**4 条 vertical**：
- 通用问答对话
- 独立文书起草（draftId 未关联 caseId）
- 独立合同审查（reviewId 未关联 caseId）
- 案件分析（小索 / 模块对话 / 初始分析中任选一条主流路径）

**每条 vertical 跑 4 个场景**：

1. AI 正在打字时点停止 → 输入框立刻可用 → 立刻发新问题 → 收到正常回答
2. AI 弹出"请选模板/立场"卡片时，**确认底部停止按钮不显示**，**输入框禁用**；点卡片"放弃"按钮 → 卡片消失 → 输入框可用 → 立刻发新问题 → 收到正常回答
3. AI 正在打字时连续输入 2 条入队 → 点停止 → 队列提示条显示"还有 2 条" → 点 [继续发送] → 2 条依次发出
4. AI 正在打字时连续输入 2 条入队 → 点停止 → 队列提示条显示"还有 2 条" → 点 [清空队列] → 提示条消失，输入框可用

补充：
- 连点两次停止：第二次按"已经停了"幂等处理，不报错
- 删除一个还在跑的会话：后台任务确认已终结（不再继续消耗）
- **跨标签同步**：在标签 A 与 B 同时打开同一会话；A 中点停止 → 队列暂停 → B 立即看到队列提示条；在 B 中点 [继续发送] → A 同步看到队列发出。验证 `useQueueDispatcher.broadcastState` + `useCrossTabListener('chat-queue:sync')` 现有基建按预期工作（不引入新逻辑，仅回归）
- **离开页面继续运行**（产品原则验证）：通用问答会话 AI 正在打字 → 路由切换到其他页 → 等若干秒 → 回到会话页 → 看到 AI 已完成的回答，证明路由切换不触发 stop

## 10. 风险与遗留

- **风险 1：新增 `/api/v1/agent/runs/*` 通用接口需要在 RBAC 权限表登记**。按 `server/middleware/03.permission.ts` 的默认拒绝兜底，未登记的接口会 403。实施计划必须把"权限扫描 + 角色授权"作为单独步骤。
- **风险 2：现有用例中"停止后队列暂停"的 UI 提示条之前不存在**。新增提示条后，已有 E2E / 集成测试可能依赖"停止后队列直接消失"的旧假设，需要补回归。
- **遗留 1：案件分析页 `[sessionId].vue:208` 仍直连 case 域端点**。本次不动，长期可统一切到通用接口。
- **遗留 2：删除会话前 stop 路径的行为变化**（`useDomainAgentSession.ts:502`）。本路径原本就 catch 吞错（因为对无 caseId 的 vertical 都直接 404），实际等于不 stop。本次切到通用接口后将真正生效（用户删除会话时后台任务会被取消），这是符合产品预期的行为修正而非副作用，但实施后建议观察一周确认无未发现的依赖。

## 11. 实施顺序建议

按依赖关系给出顺序，具体拆分到任务由后续实施计划处理：

1. **后端**：`cancelRunService` 修 INTERRUPTED 状态处理（独立可上线，是后续步骤的前置）
2. **后端**：新增 `/api/v1/agent/runs/*` 通用接口（两个文件）
3. **后端**：RBAC 权限登记 —— 先查 `prisma/seeds/seedData.sql` 与 `server/middleware/03.permission.ts` 的权限表结构，按其规则在 seedData 中追加新端点 + 给"已认证用户"角色（如 `user` / `admin` / `editor` 等所有登录角色）授权；具体登记格式由实施计划在查清 RBAC 表 schema 后细化
4. **前端**：`useStopActiveRun.ts` 切到通用接口
5. **前端**：4 处空函数 `@cancel` 改为 `handleCancel` 异步函数
6. **前端**：`AiChat` → `AiPromptInput` 透传 `isInterrupted`，`AiPromptInput` 加防守性 `v-if`，中断态禁用输入框
7. **前端**：新增 `QueuePausedBanner.vue` 组件 + 5 个 panel 顶部渲染
8. **回归**：跑完 §9 的 24 项验收清单 + 跨标签 + 离开页面 + 幂等
