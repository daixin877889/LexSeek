# 文书 Agent 与工具架构修正设计(Spec)

- 日期:2026-05-05
- 状态:待 review
- 作者:戴鑫
- 涉及 vertical:`document` / `legal-assistant` / `case-analysis`(主要影响)

---

## 1. 背景

LexSeek 当前的"起草法律文书"流程在三个入口下都跑同一段反模式代码:

- 用户在小索 / 通用问答对话时调起 `draft_document` 工具
- 工具内部模板推荐 + interrupt 选模板
- 工具内部**同步嵌套调起 `documentMain` 子 Agent**(`runDocumentChat`)
- 子 Agent 通过 `toolStrategy(buildDraftSchema(placeholders))` 强制按模板字段输出
- `draftResultPersistenceMiddleware.afterAgent` hook 解析 LLM 输出兜底写库
- 工具消费整条子流(`runAndDrainStream`)等 hook 跑完
- 拿到结果给主 Agent

实测线上 dev 库:`document_drafts.status='failed'` 21 条 / `'ready'` 51 条,**失败率约 27%**。一个具体复现案例:用户从通用问答讲完房屋租赁纠纷案情让起草起诉状,9.4 秒就 `status=failed`,前端报"draft_document: 文书 Agent 起草失败"。

定位到根因不止一个:

1. **工具同步嵌套子 Agent**违背"工具回归工具"原则,任何子流失败都被工具识别为整体失败
2. **通用问答对话上下文几乎全丢**——只通过 LLM 自动摘要的一句 `additionalContext` 传给 documentMain;documentMain 在新 thread 里看不到原始对话,什么都问不出来就失败
3. **prompt 中"若确无任何材料,再向用户询问需要补充的具体内容"**这条引导,让 LLM 在缺信息时直接给自然语言提问——但 documentMain 是 batch agent,接不住对话;`afterAgent` 三层兜底也解析不出 JSON,直接走 failed 分支
4. **每种文书的字段需求差异大**(起诉状 17 字段,答辩状 15 字段,种类还会持续扩展),让上游 Agent 提前知道每个文书要什么字段不可持续

## 2. 目标与非目标

### 2.1 目标

- 三个入口(小索 / 通用问答 / 文书工作区)起草文书行为统一、信息无损
- 取消"工具嵌套子 Agent"反模式,工具回归无会话纯函数
- documentMain 升级为平级主 Agent,跟小索 / 通用问答同构
- 三个 Agent 都挂 `legal-document-writer` skill,各自加载、各自闭环
- 上下文不再需要"上游传给下游"——每个 Agent 在自己的会话里完整工作
- 文书种类扩展零代码成本(新模板的字段需求由 skill 现学)

### 2.2 非目标

- 不动合同审查(`reviewContract.tool` 仍是子 Agent 工具架构,本次不改)
- 不动其它 vertical 的 Agent 架构
- 不引入新的 schema 字段或表
- 不做生产灰度 / 回滚预案(项目尚未生产部署)

## 3. 整体架构设计

### 3.1 三个 Agent 平级,各挂 skill

| Agent | scope | skill | 工具能力 |
|---|---|---|---|
| caseMain(小索) | CASE | legal-document-writer + 6 个其他 | 案件分析 + 起草/修改文书 |
| assistantMain(通用问答) | ASSISTANT | **新挂** legal-document-writer + 5 个其他 | 通用法律咨询 + 起草/修改文书 |
| documentMain(文书工作区) | DOCUMENT | **新挂** legal-document-writer + docx | 专注当前草稿的对话/修改 |

每个 Agent 在自己的 thread 里有完整对话上下文,**通过 skill 的写作规范方法论 + 自己的对话内容**,产出每个 placeholder 字段值,然后**调工具落库**。

### 3.2 工具是无会话纯函数

| 工具 | 入参 | 出参 | 是否带 interrupt |
|---|---|---|---|
| `recommend_template` | intent / keywords / category | templateId / templateName / placeholders 列表 | ✓ template_select 卡片 |
| `save_document_draft` | templateId / fieldValues / suggestions / aiTitle / caseId / sourceText / fileIds | draftId / sessionId / href | ✗ |
| `update_document_draft` | draftId / fieldUpdates / suggestions / aiTitle | draftId / changedFields / summary | ✗ |

工具内部**不嵌套调用任何 Agent**,只做明确的数据库 IO 和 SSE event 发布。

### 3.3 数据流(三入口对比)

```
小索 / 通用问答路径:
  [Agent 在自己的对话里听用户讲 / 上传材料]
    ↓ 加载 skill,看《起诉状》写作规范,知道要哪些字段
    ↓ 用对话上下文 + skill 方法论产出 fieldValues
  调 recommend_template → interrupt → 用户选 → 拿 templateId
    ↓
  调 save_document_draft(templateId, fieldValues, ...) → 拿 draftId/href
    ↓
  Agent 给用户回复"已为您起草《XX》草稿,前往工作台查看"
    ↓
  用户跳转文书页 → documentMain Agent 启动(系统 prompt 注入 draft 当前状态)
    ↓
  用户继续在文书页对话窗调整 → documentMain 调 update_document_draft

文书工作区直接进入路径:
  用户在 dashboard/document/templates 选模板进入工作区
    ↓ createDraftService 创建空草稿(status='ready', values={})
  documentMain Agent 启动 → 系统 prompt 注入 draft(values 为空)
    ↓ 用户在对话窗讲案情 / 上传材料
  documentMain 调 save_document_draft 或 update_document_draft 写字段
```

### 3.4 关键设计要点

- **不再有"上下游"**:每个 Agent 是完整闭环,不需要把对话历史"传给下游"
- **不再有 toolStrategy 强约束**:Agent 通过 tool call 主动写库,失败时 LLM 自己看到错误重试
- **不再有"filling"中间态**:save_document_draft 直接置 `status='ready'`,失败的不创建草稿
- **interrupt 只用于必要交互**:仅 `recommend_template` 弹模板选择卡(沿用 review_contract 同款机制)

## 4. 工具接口契约

### 4.1 `recommend_template`

**入参**:
```typescript
{
  intent: string;                    // "起草起诉状" / "写答辩状"
  keywords?: string[];               // 模板召回关键词
  category?: DocumentCategoryKey;
}
```

**出参(JSON 字符串给 LLM)**:
```typescript
{
  success: true,
  templateId: number,
  templateName: string,
  placeholders: Array<{ name: string; firstContext: string }>,
  cancelled?: false,
}
// 或用户取消:
{ success: false, cancelled: true, message: "用户已取消模板选择" }
```

**内部流程**:
1. 调 `recommendDocumentTemplatesService(...)` 拿候选(复用现有服务)
2. 发 `interrupt({ type: 'template_select', toolCallId, ... })` 弹卡片(沿用旧逻辑)
3. resume 后查 `getDocumentTemplateDAO(templateId)` 拿完整 placeholders
4. placeholders 列表也回给 LLM(让 LLM 知道要从对话里收集哪些信息)

### 4.2 `save_document_draft`

**入参**:
```typescript
{
  templateId: number;                              // 必填
  fieldValues: Record<string, string | null>;      // 必填,placeholder 名→值;不知道的填 null
  suggestions?: Record<string, string>;            // 可选,建议用户补充什么
  aiTitle?: string;                                // 可选
  caseId?: number;                                 // 可选,从 ToolContext 取
  sourceText?: string;                             // 可选,通过 createDraftService 写到 draft.sourceRef.text;
                                                   // 用户跨 session 接手或 documentMain 重启会话时读取作为初始诉求上下文
  fileIds?: number[];                              // 可选
}
```

**校验**:
- templateId 必填,模板存在 + 用户有权使用(scope='user' 时 userId 匹配)
- fieldValues 至少一个非 null(全 null 直接拒绝)

**内部流程**(全程在单次工具调用内顺序执行,失败任一步即抛错让 LLM 看到):
1. 校验通过后调 `createDraftService({ ..., enqueueAgentRun: false })` 创建 draft 记录(此时 createDraftService 内部按 hasSource 短暂置 'drafting' 是实现细节,外部不可观察)
2. 立刻 `updateDocumentDraftDAO(draftId, { values, status: 'ready', metadata: { suggestions } })` 同步落库到终态(不走 afterAgent hook,因为 documentMain 新架构没这个 hook)
3. `createSnapshotService(draftId, 'ai-extract', { values, aiTitle })` — 实现位于 `server/agents/document/documentDraftSnapshot.service.ts`
4. 处理 sourceFileIds(若有 → `ensureMaterialsReadyForDraftService`)
5. 应用 aiTitle(若有 + titleOverridden=false → `applyAITitleIfAllowedService`,实现位于 `server/agents/document/documentDraft.service.ts`)
6. **`await publishCustomEvent({ name: 'DRAFT_SAVED', ... })`** — agent-platform.md 铁律:工具内 SSE emit 必须 await,不能 fire-and-forget
7. 返回 JSON

> 第 1-2 步是工具内的事务式两步,外部观察 status 直接从无到 'ready'。新架构下 `'drafting' / 'filling'` 不再作为可观察的中间状态对外暴露。

### 4.3 `update_document_draft`

**入参**:
```typescript
{
  draftId: number;
  fieldUpdates: Record<string, string | null>;
  suggestions?: Record<string, string>;
  aiTitle?: string;
}
```

**校验**:
- draftId 存在 + 用户有权
- 状态校验:`'ready' / 'exported' / 'failed'` 允许;`'drafting' / 'filling'` 拒绝(虽然新架构不会出现这两态,留作防御)

**内部流程**(优先复用现有 service,避免重复造轮子):
1. **复用 `patchDraftService(userId, draftId, { values: fieldUpdates })`**(`server/agents/document/documentDraft.service.ts:158-196` 已实现"查 template → 字段过滤(只保留 placeholders 范围)→ merge → updateDocumentDraftDAO")
   - 若返回 ServiceError → throw 让 LLM 看到错误自己重试
2. 若 suggestions 或 aiTitle 非空,追加调 `updateDocumentDraftDAO(draftId, { metadata: { suggestions } })` / `applyAITitleIfAllowedService(draftId, aiTitle)`(因 patchDraftService 当前不管 metadata / 标题)
3. 计算 changedFields:对比传入的 fieldUpdates 和返回的 draft.values,得到实际生效字段名列表
4. **`await publishCustomEvent({ name: 'DRAFT_UPDATED', ... })`** — 同样必须 await
5. 返回 JSON

> **实施备注**(plan 阶段决定):若 patchDraftService 加 metadata 可选参数能让上面第 2 步合并到第 1 步,工具实现更干净。这是技术细节,plan 阶段评估改造成本后决定。

## 5. documentMain Agent 重写

### 5.1 当前结构(待删除)

```typescript
createAgent({
  model, systemPrompt, checkpointer, store,
  tools: [process_materials, search_*, memory_*],
  responseFormat: toolStrategy(buildDraftSchema(placeholders)),  // ← 删
  middleware: [
    messageIntegrity, scopeGuard, pointConsumption,
    summarization, safetyTrim,
    draftResultPersistenceMiddleware,  // ← 删
    afterAgentMemory(若有 caseId), audit,
  ],
})
```

### 5.2 改后结构

```typescript
createAgent({
  model, systemPrompt, checkpointer, store,
  tools: [process_materials, search_*, memory_*,
          recommend_template, save_document_draft, update_document_draft],  // ← 加
  // 不再有 responseFormat
  middleware: buildMiddlewareStack([
    { middleware: createMessageIntegrityMiddleware(), priority: ..., name: ... },
    { middleware: createScopeGuardMiddleware(), priority: ..., name: ... },
    { middleware: pointConsumptionMiddleware(userId, 'document_draft_token', sessionId), priority: ..., name: ... },
    { middleware: summarizationMiddleware({...}), priority: ..., name: ... },
    { middleware: safetyTrimMiddleware({...}), priority: ..., name: ... },
    // afterAgentMemory 条件挂载(agent-platform.md 铁律:caseId 非空时挂,否则跳过)
    ...(resolvedCaseId
      ? [{ middleware: afterAgentMemoryMiddleware({ caseId: resolvedCaseId, sessionId, userId }),
          priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE, name: 'afterAgentMemory' }]
      : []),
    { middleware: createAuditMiddleware(), priority: ..., name: ... },
  ]),
})
```

### 5.3 系统 prompt 重写要点

documentMain_system 改成下述内容。**变量注入机制说明**:

- prompt 内的 `{{var}}` 占位符通过现有 `renderSystemPrompt(nodeConfig, ctx)` 在 Agent 启动时**一次性渲染**(项目自研机制,不依赖 LangChain 的 systemPrompt 运行时模板能力)
- 复用现有 `PromptRenderContext`(`server/services/node/prompt.service.ts`)接口,扩展 4 个新字段:`draftId / status / currentValuesJSON / placeholdersWithHints`
- 启动后变量值固定,**LLM 跨轮次看到的是启动那一刻的快照**;后续 update_document_draft 工具调用结果通过 messages 历史让 LLM 推导当前 values
- **plan 阶段 spike**:实测 LLM 在用户表单直接编辑字段后(不经过 Agent),下一轮对话时是否仍能正确感知最新 values。若不能,升级为 beforeAgent middleware 每轮重新读 DB 注入 HumanMessage(参考 `moduleContextBuilder.ts` 模式)

```
# 角色
你是 LexSeek 的文书生成助手,专门为用户起草和完善法律文书。

# 当前工作上下文
- 草稿 ID: {{draftId}}
- 草稿状态: {{status}}
- 模板: {{templateName}} ({{templateCategory}})
- 关联案件: {{caseId}}(若有)
- 已填字段: {{currentValuesJSON}}
- 模板字段清单: {{placeholdersWithHints}}

# 工作流程
1. legal-document-writer skill 已通过 skillsMiddleware 自动加载,你可用 read_skill_file 读对应文书的 reference/<文书类型>.md 写作规范
2. 用对话上下文 + 已填字段 + skill 方法论:
   - 司法三段论提炼"事实和理由"
   - 配套思考"诉讼请求"
   - 从对话提取当事人/证据/时间线
3. 根据用户当前指令决定动作:
   - 首次起草 → 调 save_document_draft 一次性写所有能填的字段
   - 改字段 → 调 update_document_draft 增量更新
   - 信息不足 → 在对话里反问用户,等回答后再调工具
4. 字段值规则:
   - 能从对话/已填字段抽取 → 填实
   - 不知道 → 写 null,不要编造
   - "建议用户补充什么" → 写到 suggestions

# 不做的事
- 不在消息正文里输出大段字段 JSON,该用工具调用
- 不替用户决定法律走向,只提建议
- 不编造未在对话/材料中出现的事实
```

### 5.4 三段 user prompt 软停用

`prompts.id` = 45 / 46 / 47(documentMain_user_with_files / with_case / standalone)`status=1` → `status=0`,留作回滚后路。新架构下系统 prompt 已经包含全部启动信息,不再需要分支选择。

### 5.5 agentType 选择

`agent.config.ts` 保留 `agentType: 'stateGraph'`,`runStateGraph` 内部继续调 `runDocumentChat`,只改 `runDocumentChat` 的内部实现。这样改动面最小,行为可控。

## 6. 数据库变更

### 6.1 严格遵循铁律

不写 migration、不写 UPDATE 语句。**直接改 dev 库 + 同步改 `prisma/seeds/seedData.sql` 对应 INSERT 行**。

### 6.2 三处 `nodes.tools` 改写

| node_id | name | 改后 tools |
|---|---|---|
| 5 | caseMain | `["process_materials", "search_case_materials", "search_law", "search_case_memory", "write_case_memory", "update_case_memory", "search_case_analysis", "review_contract", "recommend_template", "save_document_draft", "update_document_draft"]` |
| 15 | assistantMain | `["search_law", "review_contract", "process_materials", "search_case_materials", "recommend_template", "save_document_draft", "update_document_draft"]` |
| 17 | documentMain | `["process_materials", "search_case_materials", "search_law", "search_case_memory", "write_case_memory", "update_case_memory", "recommend_template", "save_document_draft", "update_document_draft"]` |

### 6.3 两条 `node_skills` 新增

```
(skill_name='legal-document-writer', node_id=15)  -- assistantMain 加挂
(skill_name='legal-document-writer', node_id=17)  -- documentMain 加挂
```

### 6.4 prompts 内容更新

| id | name | 改动 |
|---|---|---|
| 30 | documentMain_system | content 改为 5.3 节新版 |
| 45 | documentMain_user_with_files | status: 1 → 0 |
| 46 | documentMain_user_with_case | status: 1 → 0 |
| 47 | documentMain_user_standalone | status: 1 → 0 |
| 18 | assistantMain_system | content 工具列表段更新 |
| 29 | caseMain_system | content 工具列表段更新 |

### 6.5 一行 SQL 处理 dev 库残留 filling 草稿

```sql
UPDATE document_drafts SET status='failed' WHERE status='filling';
```

不进 seedData.sql(这是历史污染数据清理,新环境不该有 filling 状态草稿)。

## 7. 删除清单

### 7.1 必须删除的文件(5 个)

| 文件 | 删除原因 |
|---|---|
| `server/services/agent-platform/tools/draftDocument.tool.ts` | 被 3 工具取代 |
| `server/agents/document/middleware/draftResultPersistence.middleware.ts` | 取消 toolStrategy 后无用 |
| `server/services/workflow/middleware/draftResultPersistence.middleware.ts` | re-export shim |
| `server/agents/document/draftSchema.builder.ts` | toolStrategy 不用了 |
| `server/services/assistant/document/draftSchema.builder.ts` | re-export shim |

### 7.2 保留的文件(被 reviewContract 复用)

- `server/services/agent-platform/subAgent/runAndDrain.ts`
- `server/services/agent-platform/subAgent/buildSubAgentCallbacks.ts`
- `server/services/agent-platform/subAgent/publishSubAgentStatus.ts`

### 7.3 引用点清理

| 文件 | 改动 |
|---|---|
| `server/services/agent-platform/tools/index.ts` | 删 draft_document import + 注册;加 3 个新工具 |
| `server/services/workflow/middleware/index.ts` | 删 `export { draftResultPersistenceMiddleware }` 行 |
| `server/agents/document/middleware/index.ts` | 若有同款 export,删除 |
| `server/services/workflow/agents/documentMainAgent.ts` | 删 buildDraftSchema / toolStrategy / responseFormat / Placeholder import 与使用 |
| `server/agents/document/agent.config.ts` | description 字段更新 |

## 8. 测试策略

### 8.1 必须删除(3 个)

- `tests/server/assistant/document/draftResultPersistence.middleware.test.ts`
- `tests/server/workflow/middleware/draftResultPersistence.test.ts`
- `tests/server/assistant/document/draftSchema.builder.test.ts`

### 8.2 必须重写(2 个)

- `tests/server/workflow/agents/documentMainAgent.test.ts` — 删除 toolStrategy 相关 mock,断言新 system prompt 注入与新工具挂载
- `tests/server/agent-platform/tools/draftDocument.test.ts` — 整体作废,interrupt 解包 / SSE event 等思路借鉴到新工具测试

### 8.3 必须新建(4 个)

- `tests/server/agent-platform/tools/recommendTemplate.test.ts`
- `tests/server/agent-platform/tools/saveDocumentDraft.test.ts`
- `tests/server/agent-platform/tools/updateDocumentDraft.test.ts`
- `tests/e2e/document-draft-via-assistant.spec.ts`(用 chrome-devtools MCP 跑端到端)

### 8.4 小调 mock(3 个)

- `tests/server/assistant/document/documentDraft.service.test.ts` — 去掉 buildDraftSchema mock
- `tests/server/workflow/threadState.test.ts` — 调整 documentMain 行为 mock
- `tests/app/components/ai/AiToolRenderer.test.ts` — 加新 3 工具卡渲染断言

### 8.5 覆盖率门槛

`agent-platform/**` 目录 ≥ 90%(项目硬约束)。新 3 工具每个测试覆盖核心场景:正常路径 / 校验失败 / interrupt 取消 / SSE event 发布 / 数据库写入断言。

## 9. 实施分阶段

### Stage 1:铺设基础(零风险)

- 新建 3 工具文件 + 单测
- 注册到 `tools/index.ts`(新工具挂载到节点前不影响现有行为)

验证:`typecheck` + 新工具单测 + 全套测试

### Stage 2:架构切换(原子化)

- 重写 `documentMainAgent.ts`
- 改 dev 库:nodes / node_skills / prompts(按第 6 节)
- 同步改 `seedData.sql`
- 重写 documentMain 单测
- 一行 SQL 处理 dev 库 filling 草稿
- 写 e2e

验证:`typecheck` + 全套测试 + e2e + 三入口手动验证(小索 / 通用问答 / 文书入口)

### Stage 3:清理旧代码

- 删 5 个反模式文件
- 改 4 处引用点
- 删 3 个过时测试

验证:`typecheck` + 全套测试 + 覆盖率 ≥ 90%

### Stage 4:配套清理

- 修 `repairOrphanToolUseCheckpoint` SQL 加 `langgraph.` schema 前缀(顺手清告警)
- 调小 mock 测试
- 更新 `docs/tech-docs/backend/agent-platform.md` / `workflow.md`
- commit `.claude/rules/database.md` 修订(brainstorm 阶段已改)

验证:`typecheck` + 全套测试 + 文档与代码一致

### 阶段依赖

```
Stage 1 → Stage 2 → Stage 3 → Stage 4
```

Stage 4 可与 Stage 3 并行(文档/小修不冲突)。

### 总体估时

| Stage | 估时 |
|---|---|
| 1 | 1-1.5 天 |
| 2 | 2-3 天 |
| 3 | 0.5 天 |
| 4 | 0.5 天 |
| **合计** | **4-5.5 个工作日** |

## 10. 工作流与验收

### 10.1 工作流

```
1. 从 dev 拉分支:feature/document-agent-tool-refactor
2. 在分支上推进 4 个 Stage
3. 全部 Stage 完成 + 验收通过 → PR 合 dev
```

无需灰度、无需回滚预案、无需上线 SOP(项目尚未生产部署)。

### 10.2 验收标准

代码质量:
- `bun run typecheck` 零错
- `bun run test` 全过
- `bun run coverage` 显示 `agent-platform/**` ≥ 90%

功能验证(三入口手动):
- **小索路径**:案件页 → 小索对话 → "起草起诉状" → 选模板 → 草稿落库,字段填得对
- **通用问答路径**(当前 bug 场景):通用问答对话 → 讲案情 → "起草起诉状" → 选模板 → 草稿落库,字段填得对(尤其"原告"/"被告"/"事实和理由"/"诉讼请求"用上了对话信息)
- **文书生成入口**:文书模板页 → 选模板 → 文书工作区跟 documentMain 对话 → 字段被填好

定量验收(开发期手工跑):
- **通用问答起草起诉状跑 5 次,≥ 4 次 status='ready'**(对标线上 dev 库当前 27% failed,目标 ≤ 20%)
- **每次成功草稿的 placeholders 字段非 null 比例 ≥ 80%**(起诉状 17 字段中至少 14 个非 null)
- 每次成功草稿的 `事实和理由` / `诉讼请求` / `原告`(姓名段)三个核心字段必须非 null

端到端:
- `tests/e2e/document-draft-via-assistant.spec.ts` 通过

数据一致:
- `prisma migrate status` 无 drift(改 seedData.sql 不动 schema,理论无 drift,但需 plan 阶段 spike 实测确认)
- dev 库与 seedData.sql 字段值一致

### 10.3 plan 阶段必须验证的 spike(C 类)

进入 writing-plans 阶段前,必须先做以下 3 个轻量 spike 实验:

| spike | 验证内容 | 失败处理 |
|---|---|---|
| C1 | dev 库改 seedData.sql 后 `prisma migrate status` 不会报 drift(实测一次:改一行 INSERT 字段值 → 跑命令 → 验证输出) | 若误报 drift,需调整数据级变更流程,改成手工 SQL 同步而非 seedData.sql 单源 |
| C2 | systemPrompt 启动时注入 currentValuesJSON 后,Agent 跨轮次能否看到最新 values(用户在表单直接编辑字段后下一轮 LLM 是否拿到新值) | 若不能,升级为 beforeAgent middleware 每轮重新读 DB 注入 HumanMessage(参考 moduleContextBuilder) |
| C3 | recommend_template 的 toolCallId 双层包装(`{ resume: { [toolCallId]: realValue } }`)在新独立工具里仍能正确路由 resume 值(对照 review_contract 同款机制端到端验证) | 若解析逻辑要调整,在 plan 阶段决定用 buildSubAgentCallbacks 同款 helper 还是自己实现 |

## 11. 关键决策记录

### 决策 1:工具不嵌套调子 Agent

放弃当前"工具内 runDocumentChat 同步执行"的实现。理由:

- 工具是无状态纯函数,嵌套 Agent 等于把调用关系变成"父 Agent → 工具 → 子 Agent",违背抽象边界
- 失败传播路径不清晰:子 Agent 内部错误被工具识别为整体失败,但工具调用方(主 Agent)看不到子流的真实失败原因
- 不利于上下文复用:子 Agent 的新 thread 跟父 Agent 完全隔离,父 Agent 的对话历史无法自然传递

**原始 bug `draft_document: 文书 Agent 起草失败(afterAgent hook 写了 status=failed)` 永不重现的保证**:这条错误的抛点位于旧 `draftDocument.tool.ts:236`,触发条件是"工具同步等子 Agent 跑完后发现 draft.status=failed"。新架构删除整个 `draftDocument.tool.ts`、删除 `draftResultPersistence.middleware.ts`、删除 toolStrategy 强约束,旧的"`afterAgent` hook 写 failed → 工具识别失败 throw"链路被彻底断链。新架构下工具是纯函数,失败由 LLM 看到 tool error 自己重试,不会再走兜底标 failed 这条路。

### 决策 2:三个 Agent 都挂同一份 skill

理由:
- caseMain 用 skill 做"案件分析转文书"——案件背景丰富
- assistantMain 用 skill 做"对话整理转文书"——对话上下文为主
- documentMain 用 skill 做"草稿继续完善"——已有部分填好的字段

各自需求不同但 skill 都能覆盖。skill 描述本身相对中性(读 reference 写作规范),三个场景都适用。

### 决策 3:取消 toolStrategy + responseFormat

放弃当前"LangChain createAgent 强制 schema 输出"的机制。理由:

- 强 schema 在 deepseek-v4-flash 上有 JSON 转义问题(项目已知,jsonrepair 兜底)
- 字段值通过 tool call 输出,17 字段一次塞满容易截断
- 改成 Agent 主动调 `save_document_draft` 工具,自然支持"分多次调 update 增量补全"
- 失败时 LLM 看到工具返回的 error 自己重试,不需要中间件兜底

### 决策 4:不再有 'filling' 中间态

`save_document_draft` 直接写 `status='ready'`。理由:

- 旧架构 'filling' 是因为 Agent 异步跑,beforeAgent 写 filling 占位
- 新架构 Agent 调工具时已经产出最终值,工具同步写库,不需要中间态
- 'failed' 状态保留(用户可能要看历史失败记录),但新架构产生 failed 的概率大幅下降

### 决策 5:模板推荐保留 interrupt 卡片

`recommend_template` 工具内部 `interrupt({ type: 'template_select' })` 弹卡片。理由:

- 沿用 `review_contract` 同款交互,前端 InterruptDispatcher 已支持
- TemplateSelectCard 组件零改动复用
- 用户体验比"对话里列模板让用户文字回应"好很多

### 决策 6:数据级变更走"直接改 dev 库 + seedData.sql"

不写 migration。理由:

- Prisma migration 只管 schema(表/列/索引/约束),不管业务配置数据 update
- seedData.sql 是新环境快照的权威源,改它能让所有新环境(CI / 新人本地)直接走新架构
- 严格执行 `.claude/rules/database.md` 第 3 条铁律,不开手写 SQL 口子

### 决策 7:本次不动合同审查(reviewContract)

虽然 reviewContract.tool 也是同款"工具内嵌套子 Agent"反模式,但:

- 用户本次诉求只覆盖文书起草
- 合同审查的子 Agent 流程更复杂(切条款 / 风险分析 / 立场处理)
- 留作下一次独立架构修正项目

保留 `runAndDrain.ts` / `buildSubAgentCallbacks.ts` / `publishSubAgentStatus.ts` 三个 helper 给合同审查继续用。

## 12. 附录:参考代码位置

### 12.1 当前被替换的关键代码

- `server/services/agent-platform/tools/draftDocument.tool.ts:135-184` — 工具内嵌套调 documentMain 的核心反模式
- `server/services/workflow/agents/documentMainAgent.ts:154-158, 286` — toolStrategy + responseFormat 强约束
- `server/agents/document/middleware/draftResultPersistence.middleware.ts:142-221` — afterAgent hook 三层兜底逻辑
- `server/agents/document/draftSchema.builder.ts:10-36` — buildDraftSchema 实现

### 12.2 复用现有的服务(全部已核实路径正确)

- `server/agents/document/templateRecommend.service.ts:recommendDocumentTemplatesService` — 给 recommend_template 用
- `server/agents/document/documentDraft.service.ts:createDraftService` — 给 save_document_draft 用
- `server/agents/document/documentDraft.service.ts:patchDraftService` — 给 update_document_draft 复用字段过滤+merge+落库逻辑(行 158-196)
- `server/agents/document/documentDraft.service.ts:applyAITitleIfAllowedService` — 给 save / update 应用 AI 标题(行 287)
- `server/agents/document/documentDraftSnapshot.service.ts:createSnapshotService` — 给 save_document_draft 创建 'ai-extract' 快照(行 28)
- `server/agents/document/documentDraft.dao.ts:updateDocumentDraftDAO` — DAO 层兜底写库(行 105)
- `server/services/material/materialPipeline.service.ts:ensureMaterialsReadyForDraftService` — 给 save_document_draft 处理 fileIds(行 687)
- `server/services/node/prompt.service.ts:renderSystemPrompt` + `PromptRenderContext` — 给 documentMain 系统 prompt 启动时变量替换(扩展 4 个字段:draftId / status / currentValuesJSON / placeholdersWithHints)

### 12.3 沿用前端组件(已核实兼容性)

| 组件 / Composable | 改动量 | 说明 |
|---|---|---|
| `app/components/agents/document/interrupts/TemplateSelectCard.vue` | **零改动** | recommend_template 沿用同款 `{ type: 'template_select', toolCallId, recommendations, ... }` payload |
| `app/composables/agents/useDocumentAgent.ts` | **零改动** | scope='document' 主 Agent 工厂照旧 |
| `app/composables/document/useDocumentDraftFields.ts` | **零改动** | mountDraft / onFieldChange / flushPendingFields 逻辑无变化 |
| `app/pages/dashboard/document/drafts/[id].vue` | **零改动** | runStatus 状态机 + chat 窗口 + 字段表单都无变化 |
| `app/components/InterruptDispatcher.vue` | **零改动** | template_select interrupt type 已注册 |
| `DraftDocumentCard`(若存在) | **可能小调** | 若卡片渲染依赖 DRAFT_SAVED event 字段(href / title / summary),新工具发的 event payload 必须保持向后兼容 |
| 新增前端工具卡(若需) | **新建** | recommend_template / save_document_draft / update_document_draft 调用过程的工具卡 UI(若 panelToolMap 已有"通用工具卡"渲染,可不新建) |

### 12.4 工具实现文件命名映射(项目命名约定)

工具 name 是 snake_case,文件名是 camelCase + `.tool.ts` 后缀:

| 工具 name | 文件名 |
|---|---|
| `recommend_template` | `server/services/agent-platform/tools/recommendTemplate.tool.ts` |
| `save_document_draft` | `server/services/agent-platform/tools/saveDocumentDraft.tool.ts` |
| `update_document_draft` | `server/services/agent-platform/tools/updateDocumentDraft.tool.ts` |

### 12.5 配套清理(顺手做)

- `server/services/workflow/repairOrphanToolUse.ts:333,365,381,416` — 几条 SQL 加 `langgraph.` schema 前缀,清掉每次 run 的告警
- `.claude/rules/database.md` — brainstorm 阶段已改,堵死手写 migration 例外口子,新增数据级变更规范
