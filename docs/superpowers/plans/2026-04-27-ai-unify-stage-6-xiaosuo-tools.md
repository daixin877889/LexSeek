# 阶段 6 · 小索 → 文书 / 合同（带 caseId）

> Spec 锚点：`docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md` §6 阶段 6
> 工程量：**约 1 天**（spec 估 1 周；阶段 5 已沉淀工具/卡片/中断卡/来源条/Linker，阶段 6 是复用 + 微调）
> 起点 tag：`ai-unify-stage-5-done`
> 入口 handoff：`docs/superpowers/notes/2026-04-27-stage5-to-stage6-handoff.md`

---

## 一、目标（用户视角）

让用户在案件详情页右下角的小索浮窗里一句话起草文书 / 审合同 — **默认绑当前案件**：

- **E2E 1（文书）**：在某劳动合同纠纷案件详情页打开小索 → 输入"帮我起草这个案件的起诉状" → 弹模板选择卡 → 选模板 → 起草完成 → 工具卡片"已完成" → 跳文书页 → 来源条**只显示「← 返回小索」**（无关联按钮 / 无更换） → 点返回回到案件页 + 浮窗自动展开 + 定位对应 session
- **E2E 2（合同）**：小索浮窗上传 docx → 输入"审一下这份合同" → 弹立场选择卡 → 选乙方 → 分析完成 → 工具卡 Top 3 风险 → 跳合同工作台 → 同款来源条 → 同款返回闭环
- **数据校验**：`documentDrafts.caseId` 与 `contractReviews.caseId` 在 DB 中确实带上了案件 id
- **回归**：通用问答（from=assistant）原 E2E 不退化

---

## 二、产品决策（已拍板）

| # | 决策点 | 选择 | 终方案 |
|---|---|---|---|
| **D1** | 是否覆盖案件模块对话 | **A** | 只做小索（caseMain，createAgent）。case-module 走 stateGraph 不能直接挂工具循环式工具，本期不动 |
| **D2** | 文书/合同工作台返回小索的路径 | **A** | 跳 `/dashboard/cases/{caseId}?focus=xiaosuo&xiaosuoSessionId=${sid}` → 自动打开浮窗 + 定位 session |
| **D3** | 来源条在 xiaosuo 路径下的关联状态显示 | **C** | **完全不显示**（无关联按钮、无已关联徽章、无更换按钮）。小索路径下来源条只剩左边「← 返回小索」 |

---

## 三、Mockup（核心变化点）

### M1 · 小索浮窗工具卡（与通用问答同款）

```
┌─ 小索（劳动合同纠纷案 · 朱某 vs 某保安公司）─────────┐
│                                                        │
│  你：帮我起草这个案件的起诉状                          │
│                                                        │
│  小索：好的，请选择起诉状模板                          │
│  ┌──────────────────────────────────────────────────┐ │
│  │ ⏸ 请选择文书模板                                  │ │
│  │ ● 民事起诉状（劳动争议） ← 已预选                 │ │
│  │ ○ 劳动仲裁申请书                                  │ │
│  │ ○ 民事起诉状（通用）                              │ │
│  │ ▾ 浏览全部模板                                    │ │
│  │            [使用此模板]                            │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  小索：草稿已生成 ✓                                    │
│  ┌──────────────────────────────────────────────────┐ │
│  │ 📄 民事起诉状·朱某诉某保安公司                    │ │
│  │ 字数 1842 · 已关联当前案件                         │ │
│  │ 摘要：诉请支付经济补偿金、加班费 ...               │ │
│  │ [打开文书工作台] →                                │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### M2 · 文书页 / 合同工作台来源条 — xiaosuo 路径

**对比**：

通用问答路径（阶段 5）：
```
[← 返回 通用问答]                           [+ 关联案件]   ← 完整两端
```

**小索路径（阶段 6 决策 C）**：
```
[← 返回 小索]                                              ← 只剩左边
```

点「返回 小索」 → 浏览器跳 `/dashboard/cases/{caseId}?focus=xiaosuo&xiaosuoSessionId={sid}` → 案件详情页加载 → 浮窗自动展开 → 自动选中原 session 继续对话。

---

## 四、现状盘点（阶段 5 已沉淀，阶段 6 复用）

### 已就位的基建（**禁止重造**）

| 资产 | 路径 | 阶段 6 复用方式 |
|---|---|---|
| 子代理工具 `draft_document` | `server/services/agent-platform/tools/draftDocument.tool.ts` | **零改动**。已支持 `caseId ?? undefined`，createAgent 路径下小索的 ToolContext.caseId 自动透传 |
| 子代理工具 `review_contract` | `server/services/agent-platform/tools/reviewContract.tool.ts` | **零改动**。同上 |
| 工具卡 `DraftDocumentCard` | `app/components/agents/document/tools/` | **零改动**。toolMap 注入到小索浮窗即可 |
| 工具卡 `ReviewContractCard` | `app/components/agents/contract/tools/` | **零改动**。同上 |
| 中断卡 `TemplateSelectCard` | `app/components/agents/document/interrupts/` | **零改动**。interrupt 分发即可 |
| 中断卡 `StanceSelectCard` | `app/components/agents/contract/interrupts/` | **零改动**。同上 |
| 来源条 `DraftSourceBar` | `app/components/agents/document/DraftSourceBar.vue` | 修 xiaosuo 分支：返回路径 + 隐藏关联状态 |
| 来源条 `ReviewSourceBar` | `app/components/agents/contract/ReviewSourceBar.vue` | 同上 |
| `useCaseLinker` composable | `app/composables/useCaseLinker.ts` | xiaosuo 路径下不调用（决策 C） |
| `MaterialSelector` | `app/components/caseAnalysis/materialSelector.vue` | 接到小索浮窗的"上传材料"按钮 |
| `useXiaosuoChat` / `useChatSessionManager` | `app/composables/useXiaosuoChat.ts` | 验证 sendMessage 已支持 files；如未支持，与 useAssistantChat 对齐补齐 |

### 需新建 / 修改

| 项 | 范围 | 备注 |
|---|---|---|
| seedData.sql · caseMain (id=5) tools | 改 | 加 `draft_document`, `review_contract` |
| seedData.sql · documentMain (id=17) docx skill 关联 | 加 | 修补"docx skill 本是为文书造的，但文书没接"的产品缺位 |
| seedData.sql · caseMain_system prompt v4 | 升级 | 加工具调用规则 / 输出要求 / 不做的事（参考 assistantMain v4，文案适配 caseId 必非空场景） |
| `scripts/stage6-apply-casemain-config.ts` | 新建 | 幂等同步脚本（参考 `stage5-apply-assistant-config.ts`） |
| `CaseDetailXiaosuo.vue` | 改 | toolMap + interruptMap 分发 + enable-file-upload + MaterialSelector |
| `DraftSourceBar.vue` / `ReviewSourceBar.vue` | 改 | xiaosuo 分支返回路径 + 决策 C 隐藏右侧 |
| `app/pages/dashboard/cases/[id].vue` | 改 | 监听 `?focus=xiaosuo&xiaosuoSessionId=` query 自动展开浮窗 + 定位 session |

---

## 五、任务拆分（**单 teammate** + lead 收尾）

按用户立的铁律「按任务复杂度选模型」+ 阶段 6 工作量小（约 1 天），**只用 1 个 teammate（sonnet 4.6）**做后端 + 前端，避免协调开销。

### 子组 1 · 后端（teammate 自己一人）

#### Task 22 · caseMain 节点 tools 升级
- 改 `prisma/seeds/seedData.sql` 第 1067 行 caseMain (id=5) 的 tools 列：原 7 个工具基础上追加 `["draft_document", "review_contract"]`
- 同步写 `scripts/stage6-apply-casemain-config.ts`（参考 `scripts/stage5-apply-assistant-config.ts`）
- 验证：`select tools from nodes where id=5` 应包含 9 个工具

#### Task 15 · documentMain 节点接入 docx skill
- 在 seedData.sql 末尾的 node_skills INSERT 段（约 line 2406）追加：`(17, 'docx', 100, '2026-04-27 ...')`
- 同步在 stage6 脚本里加这一步
- 验证：`select * from node_skills where node_id=17` 有 docx 行

#### Task 21 · caseMain prompt 升级 v4
- caseMain 当前 prompt v3 只说"协调子 Agent + 商业规则"，工具列表更新后需要补充使用规则
- 参考 assistantMain v4（seedData.sql line 2088-2116）的『工具调用规则 / 输出要求 / 不做的事』段落，文案适配 caseId 必非空场景：
  1. review_contract 必须从对话上下文 `__ATTACHMENTS__` sentinel 取 ossFileId（不复述 sentinel JSON）
  2. 工具结果不要复述链接/字段/emoji（卡片已展示）
  3. 默认简体中文 + 不做的事段（不编造法条 / 不替用户最终决策 / 不输出 emoji）
- seedData.sql 新增一条 prompts 行（id 接续 v4，name='caseMain_system', version='v4', status=1, node_id=5），同时把 v3 的 status 改 0
- stage6 脚本里通过 prisma 完成 prompts 升级（幂等：检查 v4 是否已存在）

### 子组 2 · 前端（同 teammate）

#### Task 19 · CaseDetailXiaosuo 注入 toolMap + interruptMap + 上传
- 改 `app/components/caseDetail/CaseDetailXiaosuo.vue`，参照 `app/components/assistant/AssistantChatPanel.vue`：
  1. import 4 个组件：DraftDocumentCard / ReviewContractCard / TemplateSelectCard / StanceSelectCard
  2. 构造 `toolMap = { draft_document, review_contract }` 传给 AiChat
  3. interrupt 分发：`interruptData.value.type === 'template_select'` 走 TemplateSelectCard、`'stance_select'` 走 StanceSelectCard，其他保留原 `CaseInterruptConfirmation` 兜底
  4. `resolveInterrupt(value)` 包 toolCallId 路由：
     ```ts
     const tcId = (interruptData.value as { toolCallId?: unknown } | null)?.toolCallId
     resumeInterrupt(typeof tcId === 'string' ? { [tcId]: value } : value)
     ```
  5. `enable-file-upload` 改 `true`
  6. 接 `MaterialSelector`：参照 `pages/dashboard/cases/create.vue` + `AssistantChatPanel.vue`，把选中的素材通过 `useXiaosuoChat.sendMessage` 的 files 参数走双轨承载（`additional_kwargs.attachments` + content sentinel）
- **前置确认**：useChatSessionManager.sendMessage 是否已支持 files；若未支持，与 useAssistantChat 对齐补齐（双轨承载）

#### Task 17 · 来源条 xiaosuo 分支调整
- 改 `app/components/agents/document/DraftSourceBar.vue` + `app/components/agents/contract/ReviewSourceBar.vue`：
  1. **决策 D2 (A) 返回路径**：`from='xiaosuo'` 时 `goBackToSource()` 跳 `/dashboard/cases/${caseId}?focus=xiaosuo&xiaosuoSessionId=${sessionId}`（当前是占位 `/dashboard/xiaosuo`）
  2. **决策 D3 (C) 完全隐藏右侧**：template 中右侧那块（关联/已关联/更换）外层包 `v-if="from !== 'xiaosuo'"`，xiaosuo 路径下来源条只剩左侧「← 返回小索」
- 两个文件改法对称

#### Task 18 · 案件详情页 ?focus=xiaosuo 自动展开浮窗
- 改 `app/pages/dashboard/cases/[id].vue`：
  - watch route.query：`focus === 'xiaosuo'` 时 `xiaosuoOpen.value = true`
  - 若 `xiaosuoSessionId` 存在 → 等 `xiaosuoChat.init()` 完成后调 `xiaosuoChat.switchSession(xiaosuoSessionId)` 定位 session
- 验证：手动访问 `/dashboard/cases/{id}?focus=xiaosuo&xiaosuoSessionId=xxx` 浮窗自动展开 + 选中对应会话

### 主 lead 收尾

#### Task 16 · 项目级回归 + E2E
1. 跑 `bun run scripts/stage6-apply-casemain-config.ts` 同步 ls_new + ls_new_testing
2. 项目级 `npx nuxi typecheck` + `npx vitest run`（仅 lead 跑，teammate 期间不跑）
3. chrome-devtools E2E 1（小索文书）+ E2E 2（小索合同）
4. 验证返回闭环：从工作台点「返回小索」→ 案件页 + 浮窗自动展开 + 定位 session
5. 通用问答 E2E 1+2 不退化
6. 验证 documentDrafts.caseId / contractReviews.caseId 字段正确

#### Task 20 · 收尾
- atomic commits：
  - `feat(stage6-backend): caseMain 工具升级 + documentMain docx skill + prompt v4`
  - `feat(stage6-frontend): 小索浮窗注入工具卡 / 中断卡 / 上传 + 来源条 xiaosuo 分支`
  - `chore(stage6): 同步脚本 + seedData 更新`
  - `docs(stage6): plan + 阶段 6 → 阶段 7 交接`
- tag `ai-unify-stage-6-done`
- 写 `docs/superpowers/notes/2026-04-27-stage6-to-stage7-handoff.md`（spec §7 阶段 7 = 前端复用收敛 + interrupt 注册表 + composable 工厂收敛 useDomainAgentSession，阶段 5 遗留 issue #1/#2/#5 都在阶段 7 解决）
- shutdown teammate

---

## 六、完成定义（DoD）

- [x] 决策 D1/D2/D3 已拍板（A/A/C）
- [ ] caseMain (id=5) tools 含 draft_document + review_contract
- [ ] documentMain (id=17) 关联 docx skill
- [ ] caseMain prompt v4 上线（v3 status=0）
- [ ] 小索浮窗能渲染 DraftDocumentCard / ReviewContractCard 工具卡
- [ ] 小索浮窗能弹出 TemplateSelectCard / StanceSelectCard 中断卡（暂仍走 Dialog 形态，与通用问答对齐 — 内联化是阶段 7 任务）
- [ ] 小索浮窗能上传 docx + 走 MaterialSelector
- [ ] DraftSourceBar / ReviewSourceBar 在 xiaosuo 路径下只剩「← 返回小索」（决策 C）
- [ ] 案件详情页 `?focus=xiaosuo&xiaosuoSessionId=` 自动展开浮窗 + 定位 session（决策 A）
- [ ] E2E 1 + E2E 2 全绿
- [ ] 通用问答 E2E 不退化
- [ ] documentDrafts.caseId / contractReviews.caseId DB 验证正确
- [ ] tag `ai-unify-stage-6-done` 已打
- [ ] 阶段 6 → 阶段 7 交接 handoff 已写

---

## 七、风险与约束

| 风险 | 级别 | 缓解 |
|---|---|---|
| useXiaosuoChat 底层（useChatSessionManager）的 sendMessage 不支持 files 双轨承载 | 中 | teammate 第一步先 grep 确认；如缺失，参照 useAssistantChat 同款补齐 + 写最小单测 |
| 小索浮窗 interrupt 分发与原 CaseInterruptConfirmation 行为冲突 | 低 | 用 v-if 链分发，type 为已知 'template_select' / 'stance_select' 时优先走新卡片，其他保留原 dialog |
| Dialog z-index 与浮窗 z-[60] 冲突（已踩 3 次） | 低 | 中断卡 Dialog 统一 z-[200]+（参考 stage 5 同款 overlay-class） |
| caseMain prompt v4 上线后行为退化 | 中 | E2E 时关注三个场景：纯案件问答（不调工具）/ 调子代理工具（process_materials 等原 7 个）/ 调新工具（draft_document / review_contract）三轨都跑通才算稳 |
| 跳文书 / 合同工作台后浏览器 history 栈状态 | 低 | 用 navigateTo 默认 push（用户可点浏览器返回回到原案件页），不用 replace |

---

## 八、团队组织

| 角色 | 模型 | 范围 |
|---|---|---|
| **lead**（claude-opus-4-7） | opus 4.7 | 决策、E2E、收尾、commit、tag、handoff |
| **teammate-1 stage6-impl** | sonnet 4.6 | Task 22 + Task 15 + Task 21 + Task 19 + Task 17 + Task 18 |

teammate 工作铁律：
1. 只对自己改过的文件运行 typecheck（**不跑** 项目级 `npx nuxi typecheck` 和 `npx vitest`）
2. 30 分钟无产出 / 无响应 → lead 干预（询问进度或 shutdown 重派）
3. 每个子任务完成后 TaskUpdate completed + 在任务里贴 1-2 行验证结果
