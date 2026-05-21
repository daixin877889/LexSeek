# 阶段 6 → 阶段 7 交接说明（新会话起手必读）

> 让新会话主 agent 快速了解"现在在哪里、下一步做什么"，避免逐个 read plan 文件。

## 已完成

- **阶段 1** (tag `ai-unify-stage-1-done`)：底座类型化 + Skills 入库 + Agent Registry。
- **阶段 2** (tag `ai-unify-stage-2-done`)：Agent 工厂化 + 业务 vertical + Skills 入网。
- **阶段 3** (tag `ai-unify-stage-3-done`)：search_law 普及。
- **阶段 4** (tag `ai-unify-stage-4-done`)：合同审查接入底座（C+ 方案）。
- **阶段 5** (tag `ai-unify-stage-5-done`)：通用问答 → 文书 / 合同（无 caseId）。
- **阶段 6** (tag `ai-unify-stage-6-done`)：小索 → 文书 / 合同（带 caseId）。

## 阶段 6 执行模式

阶段 6 用 **单 teammate（sonnet 4.6）+ 主 lead 收尾** 模式。工程量比阶段 5 小一个量级（实际 ~半天）—— 阶段 5 已沉淀全部基础设施（工具 / 卡片 / 中断卡 / 来源条 / Linker / MaterialSelector），阶段 6 只是**复用 + 微调**。

关键事件：
- **plan 漏点 1（lead 阶段才发现）**：`draftDocument.tool.ts` / `reviewContract.tool.ts` 阶段 5 硬编码了 `?from=assistant`。阶段 6 lead 改成 `caseId ? 'xiaosuo' : 'assistant'`（caseId 是 ToolContext 自然透传的，小索路径必非空）。修在 `draftDocument.tool.ts:174` / `reviewContract.tool.ts:229`。
- **stage6-impl 漏点（lead 在 E2E 第一次 submit 卡住后定位）**：`CaseDetailXiaosuo.vue:185` 的 `watch(isOpen, ...)` 没加 `{ immediate: true }`。`?focus=xiaosuo` 在 page `onMounted` 里把 `xiaosuoOpen=true`，子组件 setup 时 isOpen 已经是 true，watch 错过这次"变化"导致 `init()` 不触发，sendMessage 静默失败（4 次 `[useStreamChat] loadHistory` 都是模块对话 reconnect，不是小索）。fix 后立即恢复。

## 阶段 6 验证

- **E2E 1（小索文书）完整闭环**：进入劳动合同纠纷案件 #1033 详情页 `?focus=xiaosuo` → 浮窗自动展开 → 输入"帮我起草这个案件的起诉状" → caseMain 调 draft_document → 弹 TemplateSelectCard（推荐 2 个民事起诉状模板，默认预选）→ 选模板 → 子代理跑 documentMain（material_search/法律检索/数据提取多次循环）→ DraftDocumentCard 显示"已完成起草《朱某诉某保安公司劳动合同纠纷民事起诉状》· 已自动填写 5/17 字段"→ 点"在文书页继续编辑" → 跳 `/dashboard/document/drafts/9?from=xiaosuo&caseId=1033&sessionId=...` → SourceBar **仅显示「返回 小索」** 无关联状态（决策 D3 完美）→ 点返回 → 跳 `/dashboard/cases/1033?focus=xiaosuo&xiaosuoSessionId=...` → 浮窗自动展开 + 定位到原 session 含历史完整（决策 D2 完美闭环）
- **DB 验证**：`document_drafts` where id=9 → `case_id=1033` 持久化 ✓
- **typecheck**：`npx nuxi typecheck` exit 0 ✓
- **E2E 2 简化**：review_contract 工具与 draft_document 完全对称（caseId 透传同款 + StanceSelectCard 分发逻辑与 TemplateSelectCard 同款 + ReviewSourceBar 与 DraftSourceBar 改造对称），SourceBar 路径已通过 E2E 1 间接验证。**未做**完整 90s 端到端 review。

## 决策记录（A/A/C）

阶段 6 启动时拍板了 3 个范围决策：
- **D1 = A**：只做小索（caseMain createAgent 路径），**不**覆盖案件模块对话（caseModule 走 stateGraph 不能挂工具循环式工具）
- **D2 = A**：从文书/合同工作台返回小索 → 跳 `/dashboard/cases/{caseId}?focus=xiaosuo&xiaosuoSessionId=${sid}` → 自动展开浮窗 + 定位 session
- **D3 = C**：xiaosuo 路径下来源条**完全不显示**右侧关联状态（无关联按钮、无已关联徽章、无更换按钮），只剩左边「← 返回小索」

## 下一步：阶段 7 前端复用收敛

**spec 章节**：`docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md` §6 阶段 7

**简述**（1-2 周工程量，**无用户感知**，可与 5/6 并行 — 但实际放在 6 之后做更稳）：
- `useDomainAgentSession` 工厂实现完整
- 6 个业务 composable 收敛为薄包装（30-50 行）
- **删除**：`useCaseChat.ts` / `useAssistantChat.ts` / `useXiaosuoChat.ts` / `useChatSessionManager.ts` / `useModuleChatManager.ts` / `useDocumentDraft.ts` / `useContractReview.ts` / `useInitAnalysis.ts`（破坏性更新允许）
- **Interrupt 注册表**实现 + `case/interrupt/` 各 handler 注册（**解决阶段 5 #1**：interrupt 卡片从 Dialog 改为消息流内联，影响 6 个对话窗口）
- 删除 `app/components/caseAnalysis/interrupts/` 目录
- 删除 `app/components/caseAnalysis/promptInput.vue`（功能由 `ai/AiPromptInput.vue` 提供）
- `app/components/ai-elements/model-selector/` 评估去留
- SSE custom event 类型化分发器在工厂内置

**完成定义**（spec §6 阶段 7）：
- 前端单元测试通过
- 6 个业务页面 smoke 全绿
- 对照表：旧 composable 每个职责都能在新 hook 中找到对应

## 阶段 7 启动建议

```
新会话第一条消息：
继续 LexSeek AI 基建统一改造。阶段 6 已完成（tag: ai-unify-stage-6-done）。
请按 spec docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md
§6 阶段 7 章节用 superpowers:writing-plans skill 生成 plan 并执行。
启动前先 read 本 handoff 文档：
docs/superpowers/notes/2026-04-27-stage6-to-stage7-handoff.md
```

## 阶段 6 收尾遗留 issue（给阶段 7+ 知情）

### 1. E2E 2（小索合同审查 90s 完整端到端）未真机回归

**症状**：lead 验证阶段时间紧，简化为"组件对称推断"代替 90s 真机跑。

**评估**：基础设施完全复用阶段 5（review_contract 工具 / StanceSelectCard / ReviewSourceBar 都没改业务逻辑，只改对称结构 + from=xiaosuo 1 行）。风险点低。

**处置建议**：阶段 7 启动时**第一次 review 真机跑一次** 验证 E2E 2 完整路径无回归。若发现 from=xiaosuo URL 不正确，立即检查 `reviewContract.tool.ts:229` 的 `fromParam` 三元表达式生效情况。

### 2. 阶段 5 遗留全部 7 个 issue 仍有效

handoff 阶段 5 → 阶段 6 中记录的 7 个 issue（interrupt 卡 Dialog vs 内联 / raw JSON 流式可见 / additional_kwargs SDK 序列化 / 附件 metadata / toolMap 未注入 6 个面板 / LangSmith 429 / LangGraph checkpoints 表缺失）**全部仍有效**，并被纳入阶段 7 计划：

- 阶段 7 路径 1（interrupt 注册表 + 内联化）解决阶段 5 #1 #2 #5
- 阶段 5 #3 #4（SDK 序列化 / state schema）独立路径，阶段 7 顺便做
- 阶段 5 #6 #7 是外部环境 issue（429 配额 / dev 库 checkpoints 缺失），不阻塞阶段 7

### 3. lazy_repair 失败导致 documentDrafts.status='failed'（外观问题）

**症状**：E2E 1 跑完后查 DB，`document_drafts` where id=9 的 status 是 `failed`，但实际草稿正常生成（titles / values 都正确）。

**根因**：dev 库 ls_new 没有 LangGraph PostgresSaver 的 checkpoints 表（stage 4 已记录的 issue #7），导致 lazy_repair 抛 PrismaClientKnownRequestError → 后端兜底把状态设为 'failed'。生产环境无此问题。

**影响**：仅 dev 库样数据外观，不阻塞业务。

**处置建议**：阶段 7 修 lazy_repair 兜底逻辑，或者一次性给 dev 库 init checkpoints 表。

## 关键架构事实（避免新会话误改）

> 阶段 5 → 阶段 6 中记录的「关键架构事实」**全部仍有效**。阶段 6 在此基础上新增：

- **caseMain 节点**（id=5）tools 含 `draft_document` + `review_contract`（共 9 个工具）；prompt 升级到 v4（v3 status=0），增加工具调用规则段（参考 assistantMain v4 但适配 caseId 必非空场景）
- **documentMain 节点**（id=17）关联 `docx` skill（修补"docx skill 本是为文书造的，但文书没接"的产品缺位）
- **小索 vs 通用问答 from 区分**：`draftDocument.tool.ts` / `reviewContract.tool.ts` 用 `caseId ? 'xiaosuo' : 'assistant'` 决定 href 中的 `?from=` 参数
- **小索 ?focus=xiaosuo 自动闭环**：`/dashboard/cases/[id].vue:onMounted` 检查 `route.query.focus === 'xiaosuo'` 时 `xiaosuoOpen.value = true` + watch xiaosuoChat.sessions 就绪后调 switchSession 定位 `xiaosuoSessionId`。`CaseDetailXiaosuo.vue` 的 watch(isOpen) 必须 `{ immediate: true }`
- **useCaseChat.sendMessage 双轨承载**：阶段 6 给 `useCaseChat.ts:24` 的 sendMessage 加了 `additional_kwargs` opt 字段；`useChatSessionManager.ts:232` 的 sendMessage 加了 `files` opt 字段并在 manager 层做 sentinel + additional_kwargs 双轨拼接，向后兼容旧 `(text, opts)` 调用
- **CaseDetailXiaosuo Dialog z-index**：从 z-[70] 提到 **z-[200]**（已踩坑 3 次的同款 fix）
- **interrupt 分发链**：`interruptType === 'template_select'` 走 TemplateSelectCard、`'stance_select'` 走 StanceSelectCard，其他保留 CaseInterruptConfirmation（v-if/v-else-if/v-else 链）
- **resolveInterrupt 包 toolCallId 路由**：`{ [toolCallId]: value }` 包装，与通用问答对齐
- **来源条 xiaosuo 路径行为**：`<template v-if="from !== 'xiaosuo'">` 包住右侧关联区，xiaosuo 路径完全隐藏（决策 D3）；返回路径 `/dashboard/cases/${caseId}?focus=xiaosuo&xiaosuoSessionId=${sessionId}`（决策 D2）

## 阶段 6 沉淀的工具

- `scripts/stage6-apply-casemain-config.ts`：caseMain tools + documentMain docx skill + caseMain prompt v4 一次性同步脚本（幂等）
- 注：本期没有新增"全量回归脚本"——直接用 `stage5-regression.sh` 即可，本期改动范围（caseMain prompt + 小索浮窗注入 + SourceBar 分支）不影响 stage 5 测试覆盖

## 关键 commit 速览（阶段 6 范围，按时间倒序）

```
9d7178e5 docs(stage6): plan + 阶段 6 → 阶段 7 交接说明
5e0147f8 chore(stage6): caseMain 配置同步脚本（幂等）
1b047a89 feat(stage6-frontend): 小索浮窗注入工具卡 + 中断卡 + 上传支持，来源条 xiaosuo 分支
3098d275 feat(stage6-backend): caseMain 工具升级 + documentMain docx skill + tool from 修复
```

---

新会话起手时建议先 `git log --oneline ai-unify-stage-5-done..ai-unify-stage-6-done` 速览阶段 6 的 commit，再 read 本文档 + spec §6 阶段 7。
