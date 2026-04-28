# 案件记忆扩展（设计文档）

- **日期**：2026-04-28
- **作者**：戴鑫（产品决策）+ Claude（架构设计）
- **依据**：2026-04-28 brainstorming 会话产出，所有产品决策点经用户确认
- **范围**：(A) 把案件记忆三件套（search / write / update）铺开到所有案件相关 agent + 强 prompt 引导；(B) 新增 afterAgent 中间件做异步兜底提取；(C) 案件详情页新增"案件记忆"Tab（时间线展示 + 用户手动添加）
- **不在范围**：召回质量优化（C 项延后用评估脚本独立评估）；afterAgent 失败重试机制；记忆全文搜索；用户在 Tab 内编辑 AI 写的记忆

---

## 0. 背景与目标

### 现状问题

LexSeek 已实现完整的案件记忆基建（写入版本链、bge-reranker 精排、subjectVersionScoring 降权），但**接入面非常窄**：

- 9 个案件相关节点中，**只有小索（caseMain id=5）配了三件套**（search/write/update_case_memory）
- 即使 caseMain 配了，prompts 仅在工具列表里点名，**没有"什么时候必须调"的硬规则**——LLM 自觉率不可控
- 用户**完全看不到** AI 在记什么、记得对不对、是否漏记
- 用户没有手动补充记忆的入口

结果：基建已完工但**实际使用度低**，更接近"建好了路但没车跑"。

### 本次目标（按用户确认的优先级）

1. **A · 覆盖广度（必做）**：9 个案件相关节点都接通三件套 + 加铁律 prompt 引导
2. **B · 触发可靠性（必做）**：双管齐下——LLM 自觉调用 + afterAgent 异步兜底；本轮 write/update ≥ 3 次时跳过兜底
3. **时间线 Tab（必做）**：案件详情页新增"案件记忆"Tab，时间轴展示 + 用户手动添加
4. **C · 召回质量（暂不做）**：后续写评估脚本数据驱动决定

### 核心收益

- AI 真正"长期记住"案件事实，跨 session 共享
- 用户可视、可补充、可信任地参与到记忆库构建中
- 9 个 agent 之间通过共享记忆形成"案件知识沉淀"

---

## 1. 关键产品决策（来自 2026-04-28 brainstorming）

| # | 决策 | 内容 |
|---|---|---|
| D1 | 改造野心 | A + B + Tab 一次性 ship（用户选项 1）|
| D2 | 覆盖范围 | 9 个案件相关节点：caseMain / 7 个分析模块 / caseInfoCheck / extractInfo / documentMain / contractReviewMain（后两个 caseId 为空时不调用）|
| D3 | afterAgent 跳过机制 | 本轮 write+update_case_memory 调用 ≥ **3 次**则跳过（阈值版 N=3，平衡节省成本和兜底）|
| D4 | 时间线 Tab 编辑权限 | 用户**仅可手动添加**（source=manual_user），不可编辑/删除 AI 写的（保持 AI 视角原样）|
| D5 | 时间线展示形式 | **B · 左轴右卡片时间轴**（按日分组，叙事感强）|
| D6 | 来源徽章文案 | "用户" 取代 "律师"（产品语义更通用） |
| D7 | subject_key 字段处理 | 用户填表时**可选 + AI 自动推断**（零认知负担，召回质量不打折） |
| D8 | 移动端 BottomTabs | 5 个核心 tab 不动，最右加 ⋯ 菜单容纳"案件记忆"等 |
| D9 | 提取/推断走节点管理 | 在 `nodes` 表新增 `caseMemoryExtract` + `caseMemorySubjectInfer` 两个节点；prompts 通过 `prompts` 表管理；运营/产品后台可调模型和提示词，不改代码 |
| D10 | 工具调用专属卡片 | 三件套在对话内用专属卡片设计（不用通用 ToolHeader/Body 灰盒子）|
| D11 | 管理端隔离 | **不加管理端**（不实现 `/api/v1/admin/case/memories/**`）。理由：案件记忆是 owner 私有上下文（类比聊天历史），与现有 `/admin/cases/**` 的设计一致——不暴露用户私密对话给运营|

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  9 个案件相关 Agent                                          │
│  caseMain / 7 模块 / caseInfoCheck / extractInfo /          │
│  documentMain / contractReviewMain                           │
│                                                              │
│  ① nodes.tools 都配齐 search/write/update_case_memory       │
│  ② prompts 加"案件记忆铁律"段                               │
│  ③ 中间件栈尾部加 afterAgentMiddleware                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼ agent run 结束触发（不阻塞响应）
   afterAgent 钩子
   ├─ 本轮 write+update ≥ 3 次 → 跳过
   └─ 否则 → 异步任务 memoryExtractionTask（fire-and-forget）
            ├─ invokeNodeJson('caseMemoryExtract', { messages })
            ├─ 软去重（同 subject_key + 文本相似 → 跳过）
            ├─ 批量 writeMemoryService(source='auto_extract')
            └─ 失败仅 log
                 │
                 ▼
   case_memories 表（已有 + source 枚举加 manual_user / auto_extract）
                 │
   ┌─────────────┼─────────────┐
   ▼             ▼             ▼
 search 工具   时间线 Tab     POST 添加
 召回链路     新 GET API     调 caseMemorySubjectInfer
 (不动)       (按时间倒序)   (subject_key 可选)
```

### 数据模型变更（最小，零新列零新表）

**关键背景**：`case_memories` 表是 **LangChain PGVectorStore 同构表**（`prisma/models/case.prisma:303`），业务字段全部在 `metadata` JSON 里，**不允许新增查询列**（会破坏 LangChain 框架的写入兼容）。

现有 `metadata` 字段：`{ id, caseId, kind, subjectKey, source, supersedes, createdAt, invalidatedAt, confidence? }`，现有 `source` 枚举：`'manual' | 'consolidator'`。

**本次只扩展 `source` 枚举允许值**：

| 值 | 含义 | 状态 |
|---|---|---|
| `manual` | AI 工具调用 | 已有 |
| `consolidator` | 旧批量整合（保留兼容） | 已有 |
| `auto_extract` | afterAgent 异步提取 | **新增** |
| `manual_user` | 用户手动添加（时间线 Tab）| **新增** |

`shared/types/memory.ts` 的 `MemoryWriteInput.source` 类型扩展、`CaseMemoryMetadata.source` 类型扩展即可。**无 schema 变更，无 migration 文件**。

### 节点表新增 2 行 + Prompt 表新增 2 行

| nodeName | type | tools | output_schema | 用途 |
|---|---|---|---|---|
| `caseMemoryExtract` | extraction | `[]` | `{ memories: Array<{ text, kind, subject_key? }> }` | afterAgent 异步从对话历史提取事实清单 |
| `caseMemorySubjectInfer` | extraction | `[]` | `{ subject_key: string }` | 用户手动添加表单：基于内容推断 subject_key |

两个节点各配 1 条 system prompt（`<nodeName>_system`）。后台 `/admin/nodes/` 可独立换模型 / 改 prompt content。

---

## 3. 后端设计

### 3.1 写入路径（双管齐下）

#### AI 主动写入（9 个节点 prompt 改造）

每个 prompt 末尾追加：

```
# 案件记忆使用规则（铁律）
- 每轮回答前必须先调 search_case_memory 检索相关历史
  （除非问的是与本案无关的公开法律知识）
- 用户给出新事实（当事人 / 住址 / 合同条款 / 关键日期 / 争议焦点）时，
  必须 write_case_memory；subject_key 用「主体.字段」格式
  （如 plaintiff.address、contract.term、dispute.focus）
- 用户更正之前事实时，必须 update_case_memory 标记旧记录失效并写新记录
- 同一 subject_key 一次对话内不重复写入；先 search 再决定 write 或 update
```

`documentMain` / `contractReviewMain` 多一句 "caseId 为空时不调用记忆工具"（这两个支持无案件上下文）。

#### afterAgent 兜底中间件（用 LangChain 原生 hook）

**关键**：LangChain v1.3 的 `createMiddleware` 原生支持 `afterAgent` hook（项目 `analysisResultPersistence.middleware.ts:137` 已在使用）。**直接走标准框架，不在工厂层包装**。

```ts
// server/services/agent-platform/middleware/afterAgentMemory.middleware.ts
import { createMiddleware } from 'langchain'

export const afterAgentMemoryMiddleware = (ctx: MiddlewareCtx) => createMiddleware({
  name: 'afterAgentMemory',
  afterAgent: {
    hook: async (state, runtime) => {
      const writeCount = countToolCalls(state.messages,
        ['write_case_memory', 'update_case_memory'])
      if (writeCount >= 3) return  // ✅ LLM 已主动记 3+ 条，跳过

      // 异步 fire-and-forget，不阻塞响应（参考 analysisResultPersistence 模式）
      void runMemoryExtractionService({ caseId: ctx.caseId, sessionId: ctx.sessionId, messages: state.messages })
        .catch(e => logger.warn('memoryExtraction failed', { e }))
    },
  },
})

async function runMemoryExtractionService({ caseId, sessionId, messages }) {
  try {
    const extractSchema = z.object({
      memories: z.array(z.object({
        text: z.string(),
        kind: z.enum(['fact', 'event', 'decision', 'note']),
        subject_key: z.string().optional(),
      })),
    })

    const result = await invokeNodeJson({
      nodeName: 'caseMemoryExtract',
      temperature: 0.3,
      schema: extractSchema,
      buildPrompt: (template) => template
        .replace('{{messages}}', JSON.stringify(messages.slice(-20)))  // 仅最近 20 条
        .replace('{{caseId}}', String(caseId)),
      errorPrefix: 'caseMemoryExtract',
    })

    for (const m of result.memories) {
      if (m.subject_key) {
        // 软去重：复用现有 calcSimilarity（server/agents/contract/utils/textSimilarity.ts）
        const existing = await findActiveMemoryBySubjectDAO(caseId, m.subject_key)
        if (existing && calcSimilarity(existing.text, m.text) > 0.9) continue
      }
      // writeMemoryService 已实现版本链（同 subjectKey 旧记录自动失效）
      await writeMemoryService({ caseId, ...m, source: 'auto_extract' })
    }
  } catch (e) {
    // 节点未配置：getValidNodeConfig 抛 ConfigError 类型
    logger.warn('memoryExtraction 失败，afterAgent 静默跳过', { caseId, sessionId, error: e })
  }
}
```

**纯加法的 DAO 调整**（`server/services/memory/memory.dao.ts` — **新建文件**）：
- `findActiveMemoryBySubjectDAO(caseId, subjectKey)` — **从现有 `writeMemoryService:30-39` 抽出共用**（DRY；当前重复一次该 SQL）
- `listMemoriesDAO(caseId, filter, cursor, limit)` — 时间线 GET API 用，按 `metadata->>'createdAt' DESC`
- `softDeleteMemoryDAO(memoryId)` — DELETE API 用，`jsonb_set(metadata, '{invalidatedAt}', $1)`

**软去重相似度函数**：**直接复用** `server/agents/contract/utils/textSimilarity.ts:24` 的 `calcSimilarity(a, b): number`（基于 diff-match-patch，已含 NFKC 规范化和标点归一）。阈值 0.9。

如 plan 阶段决定 case-memory 与 contract 跨模块共用，可把 textSimilarity.ts 提升到 `shared/utils/` —— 这个搬迁是 plan 阶段技术决策。

#### 积分扣减

`point_consumption_items` 加一行：`itemKey='memory_auto_extract'`，points=1。**积分不足时 afterAgent 静默跳过**（不抛 interrupt 不打扰用户）。

### 3.2 检索路径（不动）

`search_case_memory` 工具的现有召回链路保留：BM25 + 向量 → 候选 K×3 → bge-reranker-v2-m3 精排 → 版本链降权（旧版本 ×0.3）→ topK=5。

### 3.3 时间线 Tab 的 3 个新 API

#### `GET /api/v1/case/memories/by-case/:caseId` — 列表（详细参数见 §3.3 上方）

**Query**：`source?` / `includeInvalidated?` / `cursor?` / `limit?`（默认 30，最大 100）  
**返回**：`{ memories: Memory[], nextCursor?: string }`  
**权限**：仅案件 owner；归档案件允许查（与 search_case_memory 一致）。

#### `POST /api/v1/case/memories/by-case/:caseId` — 用户添加

**Body**：`{ text, kind, subjectKey? }`（zod 校验 text min 5 字 / kind enum）  
**逻辑**：subjectKey 空时调 `invokeNodeJson({ nodeName: 'caseMemorySubjectInfer', schema, buildPrompt, ... })` 节点推断；写入 source='manual_user'。

#### `DELETE /api/v1/case/memories/:memoryId` — 删除

**严格限制**：仅 metadata.source='manual_user' + 案件 owner，其他来源 403。

**软删实现**：raw SQL `jsonb_set(metadata, '{invalidatedAt}', $1)`（与 LangChain 同构表对齐，不用 prisma deletedAt）。审计可见，召回链路自动过滤（`filterInvalidated=true`）。

---

## 4. 前端设计

### 4.1 路由 & 状态扩展

`app/pages/dashboard/cases/[id].vue`：

```ts
validViews 数组    : 加 'memory'
viewLabelMap     : 加 memory: '案件记忆'
v-else-if 链      : 加 <CaseDetailMemory v-else-if="activeView === 'memory'" />
```

URL query 沿用 `?tab=memory`。

### 4.2 桌面 Sidebar

`CaseDetailSidebar.vue` 的 `menuItems` 在合同审查后追加：
```ts
{ id: 'memory', label: '案件记忆', icon: NotebookPenIcon }
```

### 4.3 移动 BottomTabs

5 个核心 tab 不动，最右加 ⋯ 按钮（`MoreHorizontalIcon`），点击弹出 shadcn `<Drawer>`（项目惯例：现有 SheetContent 都用 `side="right"`，移动底部弹层用 Drawer 更自然）：

```
[概览] [材料] [分析] [文书] [合同] [⋯]
                                   ↓
                            ┌─────────────────┐
                            │  📓 案件记忆    │
                            │  待办（即将推出）│
                            └─────────────────┘
```

### 4.4 主组件 `CaseDetailMemory.vue`（新建）

**布局沿用 CaseDetailDocuments 同款** `p-4 md:p-6 space-y-4`：

- 顶部：`<NotebookPenIcon /> 案件记忆 <Badge>N</Badge>` + `[+ 添加记忆]`
- 筛选 pill：全部 / AI 主动 / AI 自动 / 用户
- 主体：`<CaseMemoryTimeline>`（按日分组的时间轴）
- 底部："显示已失效的历史版本（N 条）"折叠按钮

### 4.5 子组件 `CaseMemoryTimeline.vue`

按 `dayjs(createdAt).format('YYYY-MM-DD')` 分组。每条卡片：

- 类型徽章（fact 蓝 / event 绿 / decision 黄 / note 灰）
- 来源徽章（manual 蓝 / auto_extract 绿 / manual_user 橙）
- 文本 + subject_key monospace 灰小标
- 仅 source=manual_user 卡片右上有 [删除]（用 `useAlertDialogStore.showErrorDialog` 二次确认）
- 失效记录灰底 + 删除线 + "已被覆盖"标签（仅 showInvalidated=true 渲染）

### 4.6 添加 Dialog `AddMemoryDialog.vue`

```
内容（textarea，必填，min 5 字）
类型（下拉，必选：事实/事件/决策/笔记）
subject_key（input，可选，placeholder："留空 AI 自动推断"）
[取消]                                        [保存]
```

### 4.7 数据请求 composable `useCaseMemory.ts`

```ts
export function useCaseMemory(caseId: Ref<number>) {
  const memories = ref<Memory[]>([])
  const filter = ref<MemoryFilter>('all')
  const showInvalidated = ref(false)
  const hasMore = ref(true)
  const cursor = ref<string | null>(null)

  async function load(reset = true) { /* GET */ }
  async function loadMore() { /* GET with cursor */ }
  async function add(payload) { /* POST */ }
  async function remove(id) { /* DELETE + 二次确认 */ }
  
  return { memories, filter, showInvalidated, hasMore, load, loadMore, add, remove }
}
```

### 4.8 三个工具卡片（专属设计）

新建 `app/components/ai/tools/MemorySearchTool.vue` / `MemoryWriteTool.vue` / `MemoryUpdateTool.vue`，注册在 `AiToolRenderer.vue` 的 v-else-if 链路。

| 工具 | 已完成态展示 |
|---|---|
| **MemorySearchTool** | 顶部 `<NotebookPenIcon /> 找到 N 条相关记忆`，默认折叠，展开显示 Top 3：每条 1 行（类型徽章 + 文本截断） |
| **MemoryWriteTool** | 紧凑卡片：✓ + 类型徽章 + 文本一行 + subject_key monospace 灰小标 |
| **MemoryUpdateTool** | 紧凑卡片：旧值（灰删除线）→ 新值（高亮）+ subject_key 灰小标 |

每个卡片三态：执行中 / 已完成 / 失败。视觉对齐时间线 Tab 的徽章颜色与 subject_key 字体。

### 4.9 设计语言

**禁止自创颜色**——所有徽章/按钮/Badge/输入框用现有 shadcn-vue + Tailwind v4 类。三类来源徽章对齐 LexSeek 已用色系：

- manual = `bg-blue-100 text-blue-700`
- auto_extract = `bg-emerald-100 text-emerald-700`
- manual_user = `bg-orange-100 text-orange-700`

四类 kind：fact 蓝 / event 绿 / decision 黄 / note 灰。

---

## 5. 错误处理与边界

| 场景 | 处理 | 用户感知 |
|---|---|---|
| AI 工具调用失败 | 工具返回 `{ error }`，LLM 自然语言说明 | 透明，可重试 |
| afterAgent 异步任务失败 | logger.warn + 不重试 | 静默 |
| 用户手动添加失败 | toast 错误 + 表单保持打开 | 明确，可重试 |
| subject_key 推断失败 | 静默 fallback：写入 subjectKey=null | 不感知；不参与版本链 |
| 用户删除失败（403/网络） | toast 提示 | 明确 |

### 节点未配置兜底

- `NODE_NOT_FOUND` 错误特殊处理：log + skip，不抛
- 启动期日志能发现"节点未配置"问题，**但 afterAgent 不会因此挂**

### 并发与边界

| 边界 | 处理 |
|---|---|
| 同案件多 session 并发写 | 共享 caseId 维度（metadata.caseId 索引）；并发竞争靠版本链时间戳兜底 |
| 同 subject_key 并发写 | 现有 writeMemoryService 版本链机制（**写新成功后再标记旧 invalidatedAt**，避免孤立失效记录） |
| 归档案件 | search/GET 允许；write/POST/DELETE 通过 `assertCaseWritableService` 守卫拒绝（已有） |
| 用户清空对话 | 记忆保留（跨 session 维度） |
| 案件软删除 | **不级联**——case_memories 与 cases 表无 FK 关系（LangChain 同构表约束）。案件 cascade 行为由案件软删 service 自行决定（当前不需联动）|

### 性能边界

- **GET API 分页**：cursor 游标，默认 30 条，不支持深 offset
- **时间轴渲染**：默认不上虚拟滚动；案件超过 500 条记忆再上 `vue-virtual-scroller`
- **afterAgent 并发**：每次 agentRun 触发一次，自然限流

---

## 6. 测试策略

### 6.1 开发期测试规范（**严格遵守**）

- 开发过程中**只跑单项相关测试**：`npx vitest run tests/path/to/specific.test.ts`
- **禁止开发期跑全量** `bun run test`（耗时长，浪费时间）
- 全量验证**仅在所有任务完成后**最后运行一次收尾

### 6.2 单测覆盖（vitest）

#### 后端

| 测试文件 | 覆盖范围 |
|---|---|
| `tests/server/memory/caseMemory.service.test.ts` | source 兼容性 / `findActiveMemoryBySubject` / `similarText` |
| `tests/server/memory/caseMemory.api.test.ts` | GET/POST/DELETE 权限 + 校验 + 边界 |
| `tests/server/agent-platform/middleware/afterAgent.middleware.test.ts` | 跳过逻辑（writeCount ≥ 3 跳 / < 3 触发）+ catch 不抛 |
| `tests/server/memory/memoryExtractionTask.test.ts` | 节点调用 + 软去重 + 节点不存在容错 |
| `tests/server/memory/caseMemorySubjectInfer.test.ts` | 推断 + 失败 fallback |

#### 前端

| 测试文件 | 覆盖范围 |
|---|---|
| `tests/app/composables/useCaseMemory.test.ts` | load / loadMore / add / remove |
| `tests/app/components/caseDetail/CaseDetailMemory.test.ts` | 渲染 / 筛选切换 / 失效折叠 |
| `tests/app/components/caseDetail/AddMemoryDialog.test.ts` | 表单校验 / 提交流程 |
| `tests/app/components/ai/tools/Memory{Search,Write,Update}Tool.test.ts` | 三态渲染 |

### 6.3 集成测试（走真实 ls_new_testing 库）

mock `invokeNodeJson`（不调真实 LLM），但走真实 DB：

- AI 主动写 → DB 出现 source=manual → 时间线 Tab GET 看到
- afterAgent 兜底（mock 返回 3 条 memories）→ DB 出现 source=auto_extract
- 用户手动添加（subjectKey 空）→ 触发推断 → DB 出现完整记录
- subject_key 重名 → 旧记录 invalidatedAt 被设
- 归档案件 POST → 403
- 删除 AI 写的 → 403；删自己写的 → 软删 OK
- 跳过机制：mock 4 条 write tool call → afterAgent 不触发

### 6.4 覆盖率目标（按现有 vitest.config.ts 阈值）

- `server/services/memory/**`：lines 90% / functions 90% / branches 75%
- `server/api/v1/case/memories/**`：lines 90%
- `server/services/agent-platform/middleware/afterAgent.middleware.ts`：lines 90%
- `app/composables/useCaseMemory.ts`：lines 80%
- `app/components/caseDetail/CaseDetailMemory.vue` 等 .vue：lines 70%

### 6.5 手工验收 Checklist

- [ ] 小索对话给事实 → MemoryWriteTool 卡片 ✓ + 时间线 Tab 立即可见
- [ ] 7 个分析模块跑完 → DB 看到 source=auto_extract
- [ ] 时间线 Tab 手动添加（subjectKey 留空）→ AI 推断后写入
- [ ] 删自己写的 → 二次确认后软删
- [ ] 删 AI 写的 → toast"该记忆不可删除"
- [ ] 连续提 4 个事实 → afterAgent 跳过（log 中可见）
- [ ] 把 caseMemoryExtract 节点 status 设成 0 → afterAgent 静默 + 主对话不挂
- [ ] 移动端 BottomTabs ⋯ → 案件记忆菜单 → 进入页面正常
- [ ] 筛选 pill 切换：全部 / AI 主动 / AI 自动 / 用户 → 列表正确
- [ ] 桌面 sidebar 选中"案件记忆" → URL 同步 `?tab=memory`

---

## 7. 实施分期（一次性 ship）

按用户决策"全部一起做"，本期单 plan 完成所有内容。预计 5-7 天。

### 节点种子数据落地方式

参照 stage 8 的明确决策（"数据型变更不走 prisma migrate"），本次 nodes + prompts 各 2 行新增**走 `prisma/seeds/seedData.sql`**——非破坏性、可重复、与现有节点种子格式对齐。**不生成 prisma migrate 文件**。

### 实施任务依赖（粗排）

```
T1 类型扩展 + 节点种子数据（MemoryWriteInput.source 类型扩展 / CaseMemoryMetadata.source 扩展 / seedData.sql 加 2 节点 + 2 prompt 行）
   ↓
T2 后端基础（writeMemoryService 抽出 findActiveMemoryBySubjectDAO（DRY，从现有 raw SQL 提取）/ 复用 calcSimilarity / 新建 caseMemory.dao.ts：listMemoriesDAO + softDeleteMemoryDAO）
   ↓
T3 后端 API（GET/POST/DELETE 3 个端点 + 权限校验）
   ↓
T4 afterAgent 中间件（standard createMiddleware 路径，afterAgent hook，挂入 9 vertical 的 customMiddlewares）
   ↓
T5 invokeNodeJson 集成（caseMemoryExtract afterAgent 用 / caseMemorySubjectInfer POST API 用，按真实签名 { nodeName, temperature, schema, buildPrompt, errorPrefix }）
   ↓
T6 9 个节点的 nodes.tools 和 prompts 改造（铁律段）
   ↓
T7 前端 useCaseMemory composable + CaseDetailMemory 组件
   ↓
T8 子组件（CaseMemoryTimeline + AddMemoryDialog）
   ↓
T9 三个工具卡片（MemorySearchTool / MemoryWriteTool / MemoryUpdateTool）
   ↓
T10 案件详情页接入（[id].vue + Sidebar + BottomTabs ⋯ 菜单）
   ↓
T11 单测 + 集成测试
   ↓
T12 全量收尾测试（最后一次性，不在开发过程中跑）
   ↓
T13 数据落地（seedData.sql + Lead 同步 dev/testing；用户同步生产）
```

---

## 8. 风险与缓解

| 风险 | 级别 | 描述 | 缓解 |
|---|---|---|---|
| LLM 自觉调用率不达预期 | 中 | 加铁律 prompt 后 LLM 仍可能漏写关键事实 | afterAgent 兜底机制保护；上线后埋点观察 1 周；实际命中率低于 80% 时考虑调低跳过阈值（N=3 → N=2） |
| afterAgent 异步成本失控 | 中 | 每次 agentRun 都可能触发 LLM 调用 | 跳过阈值（≥3 跳）+ pointConsumption 限流 + 软去重避免重复写入 |
| afterAgent 行为变更 | 低 | LangChain v1.3 原生支持 afterAgent hook，本期复用；后续升级理论上不影响 | 实现 + 单测覆盖；LangChain 升级时跑回归测试 |
| 节点未配置导致兜底缺失 | 低 | 启动后忘记跑种子 SQL，节点不存在 | NODE_NOT_FOUND 错误码静默 + 启动期日志 + 部署 checklist |
| 用户手动添加质量失控 | 低 | 用户填错或乱填 subject_key | 表单 placeholder 引导 + AI 推断兜底 + DB 唯一约束保护 |
| 时间线 Tab 性能（大量记忆） | 低 | 案件超过 500 条记忆时渲染卡顿 | 默认 30 条游标分页；超过阈值时上 vue-virtual-scroller |
| 移动端 ⋯ 菜单发现性差 | 低 | 用户不知道点 ⋯ 能找到记忆 | 首次进入案件详情页时显示一次提示 tooltip（可选优化）|

---

## 9. 上线策略

**全量上线**（产品在开发阶段，允许破坏性更新）。

**保护措施**：
- 单 PR 合并后立即 git tag `case-memory-extension-done`
- 上线后 1 周内观察以下埋点：
  - LLM 自觉调用率（write/update_case_memory 调用次数 / agent run 数）
  - afterAgent 触发率 / 成功率 / 平均提取条数
  - 时间线 Tab 访问率 + 用户手动添加次数

**回滚方式**：
- 整库 git revert 该 PR
- 数据库**无 schema 变更**——metadata.source 是字符串字段，新增枚举值不破坏旧数据兼容
- 节点表新增的 2 个节点保留无害（status=0 即停用）

---

## 10. 待办与开放问题（明确不在本期范围）

- 召回质量优化（C 项）— 后续写评估脚本独立评估
- afterAgent 失败重试机制 — 当前 fire-and-forget 失败仅 log
- 记忆全文搜索（在 Tab 内搜索关键词）— 用户量大后再考虑
- 用户编辑 AI 写的记忆 — 当前用户仅可手动添加，不可编辑/删除 AI 写的
- 跨案件记忆共享（如同一律师办的多个案件）— 隐私与产品定位需要单独讨论
- 失效记录批量清理 / 自动归档 — 短期不会成为性能问题
- **管理后台访问案件记忆（D11 决策不加）** — 案件记忆是 owner 私有上下文，与聊天历史同级别，不暴露给运营

---

## 附录 A：本次设计依据的现有代码引用

- `case_memories` 表（LangChain PGVectorStore 同构）：`prisma/models/case.prisma:303-312`
- `writeMemoryService` 版本链实现：`server/services/memory/memory.service.ts:23-82`
- `updateMemoryService` invalidate 实现：`server/services/memory/memory.service.ts:87-121`
- `recallMemoryService` 召回入口：`server/services/memory/memory.service.ts:123-143`
- `addDocumentsToVectorStore` LangChain 写入：`server/services/legal/vectorStore.service.ts`
- `assertCaseWritableService` 归档拦截守卫：`server/services/case/case.service.ts`
- `CaseMemoryMetadata` 类型：`shared/types/memory.ts`
- `invokeNodeJson`：`server/services/agent-platform/tools/invokeNodeJson.ts:39`（签名 `{ nodeName, temperature, schema, buildPrompt, errorPrefix, logContext? }`）
- `calcSimilarity`（diff-match-patch）：`server/agents/contract/utils/textSimilarity.ts:24`
- LangChain 中间件 afterAgent hook 真实示例：`server/agents/case-module/middleware/analysisResultPersistence.middleware.ts:137`
- `runtime.ts` agent.invoke 包装位置：`server/services/agent-platform/factory/runtime.ts`
- 9 个案件相关节点：`prisma/seeds/seedData.sql` line 1063-1080
- 案件详情页状态机：`app/pages/dashboard/cases/[id].vue`
- 现有工具卡片注册：`app/components/ai/AiToolRenderer.vue:81/87`（process_materials / search_law）
- 现有 sidebar 和 BottomTabs：`app/components/caseDetail/CaseDetailSidebar.vue` / `CaseDetailBottomTabs.vue`

---

## 附录 B：类型扩展清单

```typescript
// shared/types/memory.ts（扩展现有类型，不新增枚举类）

// 现有 source 类型 'manual' | 'consolidator' 扩展为：
export type MemorySource = 'manual' | 'consolidator' | 'auto_extract' | 'manual_user'

// MemoryWriteInput 扩展（server/services/memory/memory.service.ts）
export interface MemoryWriteInput {
  caseId: number
  kind: MemoryKind
  text: string
  subjectKey?: string
  confidence?: number
  source?: MemorySource  // ← 类型扩展
}

// CaseMemoryMetadata 同步扩展 source 字段类型

// API 层新增类型
export interface MemoryListItem {
  id: string
  text: string
  kind: MemoryKind
  subjectKey: string | null
  source: MemorySource
  createdAt: string  // ISO
  invalidatedAt: string | null
}

export interface MemoryListResponse {
  memories: MemoryListItem[]
  nextCursor?: string
}

export interface AddMemoryPayload {
  text: string
  kind: MemoryKind
  subjectKey?: string  // 可选，空则后端调 caseMemorySubjectInfer 推断
}

// 前端筛选枚举（仅 UI 用）
export type MemoryFilter = 'all' | MemorySource
```

**关键设计**：复用现有 `MemoryWriteInput` 接口和 `CaseMemoryMetadata` 类型，**仅扩展 source 字段的字符串字面量联合类型**。零运行时代价、零 DB schema 变更。
