# 阶段 5 → 阶段 6 交接说明（新会话起手必读）

> 让新会话主 agent 快速了解"现在在哪里、下一步做什么"，避免逐个 read plan 文件。

## 已完成

- **阶段 1** (tag `ai-unify-stage-1-done`)：底座类型化 + Skills 入库 + Agent Registry。
- **阶段 2** (tag `ai-unify-stage-2-done`)：Agent 工厂化 + 业务 vertical + Skills 入网。
- **阶段 3** (tag `ai-unify-stage-3-done`)：search_law 普及。
- **阶段 4** (tag `ai-unify-stage-4-done`)：合同审查接入底座（C+ 方案）。
- **阶段 5** (tag `ai-unify-stage-5-done`)：通用问答 → 文书 / 合同（无 caseId）。

## 阶段 5 执行模式

阶段 5 用 **TeamCreate (`ai-unify-s5`)** + 4 teammate（tools-impl / admin-api / frontend-cards / frontend-pages）+ 主 lead 收尾。

工程量：原 plan 估 2-3 周，实际 1 天（**E2E 多次迭代 + 体验优化迭代**占了 ⅔ 时间）。

关键事件：
- **tools-impl 卡死**：第一任 tools-impl 在 LangGraph interrupt 透传方案上走了"创建独立 HTTP 接口 + 自定义 SSE 事件"的复杂路径，无进度反馈 → 被 shutdown，由 tools-impl-v2 接手并诊断出走错路（项目内 `parseAndAskStance.tool.ts` 早就有原生 LangGraph interrupt 范式）。tools-impl-v2 删掉前任的 3 件冗余实现（HTTP 接口 / SSE 旁路 / SUB_AGENT_INTERRUPT 类型），改回 `interrupt({ type, toolCallId, ...payload })` 原生抛出 + LangGraph 自然透到主 agent streamValues 的 `__interrupt__`。
- **E2E 期间发现并修复 7 个集成问题**（详见下文）
- **附件渲染设计迭代**：从最初"用 user message content 嵌技术性后缀"演进到最终"独立气泡 + 多张可预览卡片 + 调起 CaseAnalysisDocPreviewDialog"（与案件详情页材料预览体验完全一致）

## 阶段 5 验证

E2E 完整闭环（chrome-devtools 真机跑通）：
- **E2E 1（文书）**：通用问答对话 → "帮我起草起诉状" → 弹模板选择卡 → 选民事起诉状 → 起草完成 → 工具卡显示标题/字数/摘要 → 跳文书页 → 顶部"返回 通用问答 + 关联案件" → 关联到"朱某与某保安公司劳动合同纠纷" → "已关联"徽章
- **E2E 2（合同）**：通用问答对话 → 上传材料弹框选 docx → "帮我审一下这份合同" → 弹立场选择卡（甲乙方自动预填"上海坑人科技有限公司 / 杨白劳"）→ 选乙方 → 90 秒分析 → 工具卡显示 Top 3 风险（试用期违规 / 单方调岗权滥用 / 排除法定救济权利）→ 跳合同工作台 → 7 条高风险全部识别 → 关联案件成功

**E2E 期间修复的 7+ 个集成 bug**：
1. LangGraph sub-agent interrupt resume value 的双层包装（command.resume + toolCallId 路由）→ 工具内手动解包
2. 通用问答 `enable-file-upload="false"` 导致上传按钮缺失 → 改 true
3. 上传材料按钮点不开（hidden file input 触发不稳）→ 接 MaterialSelector，参照创建案件页模式
4. LLM 把 ossFileId 传成字符串 "1012" → schema 改 z.coerce.number
5. review_contract 工具 href 路径错（`/dashboard/assistant/contract/`）→ 改成 `/dashboard/contract/`
6. 立场卡甲乙方未预填（StanceSelectCard 读 `payload.partyAHint` 但 LangGraph 透出的 interrupt 是平铺结构）→ 去掉 `.payload` 中间层
7. Top 3 风险显示"风险 1/2/3"占位（工具发 `{quote}` 但卡片读 `{title}`）→ 工具改用 `{title: r.problem || r.category}`
8. 工具卡 output-available 但 result 为空时未切失败 → 加兜底分支
9. 助手 prompt v4：约束 LLM 不要复述工具结果链接、不输出 emoji、按 sentinel 协议解析附件 ossFileId

## 下一步：阶段 6 小索 / 模块对话 → 文书 / 合同（带 caseId）

**spec 章节**：`docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md` §6 阶段 6

**简述**（1 周工程量，**用户可见**）：
- caseMain 节点（小索）配置加 `draft_document` + `review_contract`
- caseId 透传链路验证（小索的 ToolContext.caseId 非空 → 工具内自动带入 createDraft / createReview）
- 文书生成接入 docx skill（修补"docx skill 本是为文书造的，但文书没接"的产品缺位）
- 文书页 / 合同工作台识别 `from=xiaosuo` + caseId 不为空时**不显示**"+ 关联案件"按钮（小索路径默认已绑案件）
- 复用阶段 5 的工具卡片 / interrupt 卡片（DraftDocumentCard / ReviewContractCard / TemplateSelectCard / StanceSelectCard）

**完成定义**（spec §6 阶段 6）：
- 小索对话内输入"帮我起草这个案件的起诉状" → 工具卡片"已完成" → 跳文书页 → 来源条显示「来自小索 · 已关联 [案件名]」（无关联按钮）
- 小索对话内"审一下这份合同"（拖 docx）→ 工具卡片含 Top 风险 → 跳合同工作台 → 同款来源条
- 案件模块对话同样行为

## 阶段 6 启动建议

```
新会话第一条消息：
继续 LexSeek AI 基建统一改造。阶段 5 已完成（tag: ai-unify-stage-5-done）。
请按 spec docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md
§6 阶段 6 章节用 superpowers:writing-plans skill 生成 plan 并执行。
启动前先 read 本 handoff 文档：
docs/superpowers/notes/2026-04-27-stage5-to-stage6-handoff.md
```

## 阶段 5 收尾遗留 issue（给阶段 6+ 知情，不阻塞）

### 1. 子代理 interrupt 卡片仍走 Dialog 弹框，未内联到消息流

**症状**：用户在助手对话里看到模板选择卡 / 立场选择卡是**居中弹 Dialog**，不是消息列表内联（用户期望的是"卡片就出现在消息流中"）。

**评估**：阶段 5 时间紧，按用户决策**并入阶段 7「前端复用收敛」**。spec §4.3 的 interrupt 注册表设计本就在阶段 7 范围。

**处置建议**：阶段 7 把 interrupt dialog 改为消息流内联（影响 6 个对话窗口：小索 / 案件模块 / 案件分析 / 通用问答 / 合同 / 文书）。卡片组件本身（TemplateSelectCard / StanceSelectCard）零改动，只是 chat panel 的渲染入口换。

### 2. 工具调用过程的 raw JSON 在消息流中可见

**症状**：流式过程中，子代理工具的 input/output 中间态可能短暂以 raw JSON 显示。

**评估**：与 #1 同源，阶段 7 改造 toolMap 渲染层时一并解决。

### 3. LangGraph SDK 序列化 plain object messages 时丢 additional_kwargs

**症状**：`stream.submit({ messages: [{ type: 'human', content, additional_kwargs }] })` 时 SDK 把 plain object 转成 Message 实例时丢字段，后端持久化的 `additional_kwargs: {}` 是空的。

**当前规避**：useAssistantChat 双轨承载（content sentinel + additional_kwargs），useMessageParser 优先 metadata fallback content sentinel。功能不受影响，仅 token 浪费一点（sentinel 占 50-200 token/消息）。

**长期方案**：
- 选项 A：用 `new HumanMessage({ content, additional_kwargs })` 类实例代替 plain object
- 选项 B：升级 LangGraph SDK 到支持 plain object additional_kwargs 透传的版本
- 选项 C：保持双轨（当前）+ 后端中间件读 metadata 注入 system context（清空 content sentinel）

**记录**：`memory/feedback_message_metadata_first.md`（项目级长期规则）。

### 4. 附件 metadata 走 user message 不够"纯净"

**症状**：附件 metadata 实际上还是发在 user message 里（content sentinel + additional_kwargs），未通过 LangGraph state 独立字段（`state.attachments`）传递。

**评估**：阶段 7 路径 2 改造（state schema 扩展 + 后端 system prompt 拼接）。当前方案足够支撑产品体验。

### 5. 工具卡 `interrupt 透传 → resume`链路只有通用问答 chat panel 实现

**症状**：阶段 5 只在 AssistantChatPanel.vue 注入了 toolMap + interrupt 分发，小索 / 案件模块 / 文书的 chat panel 没接。

**处置建议**：阶段 6 接小索 + 案件模块时同步注入；阶段 7 整体收敛到 useDomainAgentSession。

### 6. LangSmith 429 配额耗尽（外部服务，stage 4 已记录）

**症状**：`Failed to send multipart request. Received status [429]: tenant exceeded usage limits`

**影响**：仅 telemetry，业务不依赖。

### 7. LangGraph checkpoints 表不存在 dev 库（stage 4 已记录）

**症状**：每次 chat 启动报 `relation "checkpoints" does not exist`。

**根因**：dev 库 ls_new 从来没初始化 LangGraph PostgresSaver 的 checkpoints 表。功能没受影响（lazy repair try/catch 后跳过）。

## 关键架构事实（避免新会话误改）

- **通用问答 vertical 走 createAgent 路径**（`server/agents/legal-assistant/agent.config.ts`），自动跑全栈中间件 + 自动挂 4 个 skill 工具 + skills middleware
- **assistantMain 节点**（id=15）tools = `["search_law", "draft_document", "review_contract"]`，关联 6 个 skill
- **子代理工具的 stream**：用 `runAndDrainStream(stream)` 消费整个 ReadableStream，从最终持久化结果反查（不依赖 stream 中间事件）
- **interrupt 透传**：子代理工具 `throw interrupt({ type, toolCallId, ...payload })` → LangGraph 自然透到主 agent streamValues 的 `__interrupt__` → 前端 `useStreamChat.interruptData` 现成读取 → 按 type 分发到卡片 → 用户提交 → `resumeInterrupt(value)` → `stream.submit({ command: { resume: value } })` → LangGraph 自动把 value 透回到 `interrupt()` 返回值（**注意双层包装：command.resume + toolCallId 路由，工具内手动解包**）
- **runContractReviewChat 加了 `skipStanceInterrupt` 选项**：default false 向后兼容老 /stance 端点；子代理工具走 true 路径（直接从 review.stance 读，跳过 awaiting_stance）
- **review_contract / draft_document 工具的 ossFileId 来源**：用户上传文件时，前端 `useAssistantChat.sendMessage` 把附件元数据通过双轨承载（content sentinel `__ATTACHMENTS__\n[json]` + `additional_kwargs.attachments`）发给 LLM；LLM 从 sentinel JSON parse 出 ossFileId 调工具
- **附件渲染**：`AiMessageListVirtualItem` 检测 `msg.attachments` → 走 `AttachmentMessageBubble`（独立白色气泡，去掉 user 默认 `bg-secondary` 灰底）→ 卡片点击调 `CaseAnalysisDocPreviewDialog` / `AudioPreviewDialog`（与案件详情页统一体验）
- **关联案件 Dialog**：`app/components/cases/CaseLinkerDialog.vue` 用 `GET /api/v1/cases/active`（排除已删除 + 已归档 + 非自己），文书页 / 合同页通过 `useCaseLinker` composable 接入
- **顶部"来源条"**：`from=assistant` 时显示「← 返回 通用问答 + + 关联案件」，**返回链接始终回助手对话**（即使后续关联了案件也不切到案件页 — 用户决策）；阶段 6 加 `from=xiaosuo` 分支

## 阶段 5 沉淀的工具

- `scripts/stage5-apply-assistant-config.ts`：assistantMain tools + node_skills 一次性同步脚本（幂等）
- `scripts/stage5-regression.sh`：6 步全量回归（typecheck + 阶段 5 测试 + 文书/合同/助手 vertical + 平台底座 + 前端 + 工作区干净检查）
- `server/services/agent-platform/subAgent/runAndDrain.ts`：通用 sub-agent stream consumption helper
- `server/agents/document/templateRecommend.service.ts`：通用模板推荐算法（两层匹配 + 评分 + 用户最近使用加权）
- `app/composables/useCaseLinker.ts`：关联案件 PATCH 三件套（dialogOpen / openLinker / linkCase），阶段 6 复用
- `app/components/agents/document/DraftSourceBar.vue` + `app/components/agents/contract/ReviewSourceBar.vue`：来源条子组件，阶段 6 加 `from=xiaosuo` 分支即可
- `app/components/ai/AttachmentMessageBubble.vue`：附件气泡组件，所有对话窗口通用

## 关键 commit 速览（阶段 5 范围，按时间倒序）

```
e4c59ecb chore(test): 测试覆盖率补充（非 stage 5 主线）
95c7e50b chore(stage5): seedData + 同步脚本 + node_skills 关联 + 回归脚本
a6adbe88 feat(stage5-frontend): 工具卡 / interrupt 卡 / 来源条 / 附件气泡 / chat 注入
9e68264d feat(stage5-api): 关联案件 PATCH + 我的进行中案件列表 API
359c1eba feat(stage5-tools): 子代理工具 draft_document + review_contract + 模板推荐
f16f6502 feat(stage5-platform): 子代理底座 + interrupt 透传约定
```

---

新会话起手时建议先 `git log --oneline ai-unify-stage-4-done..ai-unify-stage-5-done` 速览阶段 5 的 commit，再 read 本文档 + spec §6 阶段 6。
