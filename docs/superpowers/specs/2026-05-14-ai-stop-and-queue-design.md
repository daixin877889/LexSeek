# AI 任务"停止 / 中断 / 队列"统一治本设计

- 日期：2026-05-14
- 范围：法律助手、文书生成、合同审查、案件分析（小索 / 模块对话 / 初始分析）全部 AI 对话入口
- 状态：设计稿，待评审通过后转实施计划

## 1. 背景

用户反馈"法律助手在分析过程中点了停止之后，再也发不出新消息"。根因排查后发现并非局部 bug，而是一组系统性问题：

- **B1：前端"停止"动作没真正传到后端**。"停止"按钮里调的是案件分析专属的取消接口（要求会话必须挂在一个案件下），对法律助手 / 独立合同审查 / 独立文书 / 任何 caseId 为空的会话直接 404 失败，真正的后端取消请求从未发出。
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
- 底部按钮：红色方形停止按钮（icon-sm destructive） + 加入队列按钮
- 加入队列按钮带 +N 角标显示当前队列数（队列空时 N 不显示）
- 加入队列按钮在队列满（5 条）时禁用

### 5.3 中断中态
- 输入框：禁用，placeholder 文案"请先回应上方的请求"
- 底部按钮：无（既无停止也无发送）
- 中断卡片：所有 6 张卡都必须自带"放弃"出口（积分不足卡是唯一例外，见 §7）
- 中断 Dialog 保持禁用 Esc 与遮罩点击（与现状一致）

### 5.4 停止后 / 放弃后（队列有残留）
- 输入框：可输入（用户随时可发新消息绕过队列）
- 输入框上方插入"队列提示条"：
  - 左侧：橙色角标 + 文案"队列中还有 N 条消息未发送"
  - 右侧：[清空队列]次按钮 + [继续发送]主按钮
- 提示条仅在队列非空且处于"已暂停"时显示

### 5.5 停止后 / 放弃后（无队列残留）
- 直接回到闲置态布局，无提示条

## 6. 后端能力

### 6.1 新增：通用任务控制接口（vertical 无关）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/v1/agent/runs/current/:sessionId` | 查询某会话当前是否有正在跑的 AI 任务 |
| POST | `/api/v1/agent/runs/cancel/:runId` | 取消指定 AI 任务 |

**归属校验逻辑**：

- 这组接口只校验"任务 / 会话归属当前登录用户"，不要求"会话必须挂在一个案件下"
- 校验链：`run.userId === auth.user.id` → 通过；否则 403
- 不读 `cases` 表，不依赖 `findCaseBySessionIdService`

**与现有接口的关系**：

- `/api/v1/cases/analysis/runs/current/:sessionId` 与 `/api/v1/cases/analysis/runs/cancel/:runId` 保留（案件分析页 `app/pages/dashboard/analysis/[sessionId].vue:208` 仍在用），但所有前端"停止"按钮的调用统一切到新通用接口
- `/api/v1/assistant/runs/cancel/[runId].post.ts` 已存在，下线时机由实施计划决定（不阻塞本次治本）

### 6.2 修复：cancelRunService 对暂停态的处理

`server/services/agent/agentRun.service.ts:127-160` 当前对 `INTERRUPTED` 状态返回"幂等成功不改 status"。这与 `findActiveRunBySessionIdDAO` 把 `INTERRUPTED` 视为活跃状态的判定矛盾，会导致：用户对暂停态发起取消后，下次再发消息会被分支判定为"还有进行中的任务"而拒绝或卡死。

**修复**：把对 `INTERRUPTED` 的处理对齐到 `PENDING` 路径 —— 把 status 改为 `CANCELLED`、设置 `completedAt`、释放活跃锁。`COMPLETED / FAILED / CANCELLED` 这三种真正的终态保持"幂等成功不改 status"。

**配套**：cancel 路径还需要调用 `repairOrphanToolUseCheckpoint` 释放可能残留的工具调用半成品（对齐 worker catch 块的现有做法 `agentWorker.ts:418-427`）。

## 7. 前端改动清单

### 7.1 替换"停止"按钮调用入口（治 B1）

- `app/composables/useStopActiveRun.ts`：内部硬编码的 case 域端点替换为新通用端点
- `app/composables/agent-platform/useDomainAgentSession.ts:651`（停止按钮触发）：调用方不变，由 `stopActiveRun` 内部切到通用接口
- `app/composables/agent-platform/useDomainAgentSession.ts:502`（删除会话前 stop）：同上

### 7.2 接住 4 处空函数 @cancel（治 B3）

把 4 个 panel 文件里的 `@cancel="() => {}"` 改为 `@cancel="() => resolveInterrupt(null)"`，让"放弃中断"真正生效：

- `app/components/assistant/AssistantChatPanel.vue:184`
- `app/components/caseDetail/CaseDetailXiaosuo.vue:289`
- `app/components/case/AnalysisModuleChat.vue:238`
- `app/pages/dashboard/document/drafts/[id].vue:803`

合同审查的 panel `ContractReviewPanel.vue:578` 已经实现，对齐即可。

### 7.3 中断态隐藏停止按钮（治 B4）

`app/components/ai/AiPromptInput.vue:151-190` 当前用 `v-else (loading)` 显示停止 + 加入队列双按钮，需要再叠一层"非中断"判断：

- 新增 prop：`isInterrupted: boolean`（已从 `AiChat.vue` 传入，需要透传到 `AiPromptInput`）
- 渲染逻辑：
  - `loading && !isInterrupted` → 显示停止 + 加入队列双按钮
  - `loading && isInterrupted` → 输入框置灰禁用，不显示任何按钮
  - `!loading` → 显示发送按钮（现状）

### 7.4 InsufficientPointsCard 例外说明（不改）

按你的拍板，积分不足卡片**保持现有逻辑，不补"放弃"按钮**。用户必须充值或退出页面。这张卡是产品上的故意硬卡，不属于"治本范围"。

需要在代码注释里写清楚这个例外，避免后续维护者按"所有中断卡都该有放弃"的统一规则误改。

### 7.5 队列提示条 UI（治本配套）

`app/components/ai/AiPromptInput.vue` 顶部新增可选插槽 / prop 渲染"队列提示条"：

- 显示条件：`queueLength > 0 && queuePaused`
- 元素：橙色角标显示 N + 文案"队列中还有 N 条消息未发送" + [清空队列] [继续发送]
- 事件：`@queue-resume` / `@queue-clear` 由 `useDomainAgentSession` 暴露的 `resumeQueue` / `clearQueue` 接住（已存在，line 628-642）

## 8. 不在本次治本范围（YAGNI）

明确列出避免实施时偷塞：

- **不重构现有的 case 域旧端点**（`/api/v1/cases/analysis/runs/*`）。它们仍被 `app/pages/dashboard/analysis/[sessionId].vue:208` 使用，本次只让停止按钮的入口切走。
- **不改造业务逻辑层的 cancel 调用方**。`server/agents/contract/contractReview.service.ts` 等内部主动 cancel 的代码保持不变。
- **不引入新的"暂停 / 恢复"状态**。中断态本质是 LangGraph 的 interrupt，不在数据层新增 PAUSED status。
- **不做"输入即拒绝"风格**（Cursor 那种）。法律行业 B2B 工具用户对隐式动作敏感。

## 9. 回归用例（验收清单）

每条 vertical × 4 个场景共 24 项必须全过：

**4 条 vertical**：
- 法律助手对话
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

## 10. 风险与遗留

- **风险 1：新增 `/api/v1/agent/runs/*` 通用接口需要在 RBAC 权限表登记**。按 `server/middleware/03.permission.ts` 的默认拒绝兜底，未登记的接口会 403。实施计划必须把"权限扫描 + 角色授权"作为单独步骤。
- **风险 2：现有用例中"停止后队列暂停"的 UI 提示条之前不存在**。新增提示条后，已有 E2E / 集成测试可能依赖"停止后队列直接消失"的旧假设，需要补回归。
- **遗留 1：案件分析页 `[sessionId].vue:208` 仍直连 case 域端点**。本次不动，长期可统一切到通用接口。
- **遗留 2：cancel 接口的"删除会话前先 stop"路径（`useDomainAgentSession.ts:502`）原本就 catch 吞错**。本次同步切到通用接口后会真正生效，需要观察是否有原本被掩盖的副作用。

## 11. 实施顺序建议

按依赖关系给出顺序，具体拆分到任务由后续实施计划处理：

1. 后端：cancelRunService 修 INTERRUPTED 状态处理（独立可上线）
2. 后端：新增 `/api/v1/agent/runs/*` 通用接口 + RBAC 权限登记
3. 前端：`useStopActiveRun.ts` 切到通用接口
4. 前端：4 处空函数 @cancel 接住
5. 前端：AiPromptInput 加 isInterrupted 判定，中断态隐藏停止按钮 + 禁用输入框
6. 前端：队列提示条 UI
7. 回归：跑完 §9 的 24 项验收清单
