# 文书模板 Rerank 节点化 Design

> 把"硬编码读 documentMain 节点的 LLM rerank 调用"升级为"独立的 `documentTemplateRerank` 节点"，让模型与 prompt 都能在管理后台运维。

## 1. 背景

`2026-05-14-document-template-llm-rerank.md` 落地的方案是：在 `recommend_template` 工具内调用 LLM rerank（粗筛 30 → LLM 选 top 5）。当时为了快速上线，LLM 复用 `documentMain` 节点的模型配置，prompt 硬编码在 `templateRerank.service.ts` 的 `SYSTEM_PROMPT` 常量中。

这套实现把运维和开发耦合在一起：调推荐效果只能改代码 + 重发布。本设计把"模型 + prompt"剥离到管理后台的节点系统中。

需要先和"现有 rerank"概念区分清楚：

| 维度 | 现有 rerank model（Qwen3 Rerank） | 本设计的 LLM rerank |
|---|---|---|
| 用途 | 法律法规检索结果重排 | 文书模板推荐重排 |
| 模型类型 | `models.model_type='rerank'`，调 `/v1/reranks` | Chat completion 模型，调 `/v1/chat/completions` |
| 输入 | (query, [docs])，query+doc 通常 ≤512 tokens | 完整 prompt：案件 4 段 + 用户对话 + 候选 JSON |
| 能力 | 字面/语义相关性打分 | 能做案件类型→文书类别的间接推理 |

两者**不是同一概念**，本设计涉及的是"LLM rerank"。

## 2. 目标

- 模型可换：运维在管理后台「节点」页直接换 sdkType / model / API key，不动代码
- Prompt 可调：产品/运营在管理后台「节点 prompt」页直接微调推荐 prompt 字句，不动代码
- 不引入新 fallback 类型：节点不可用退化到粗筛顺序，复用 plan v2 的 4 类 fallback 体系
- 零数据库 schema 改动：只动 seed 数据 + 管理后台扫描登记

## 3. 不在范围

- **现有 rerank model 体系不动**：`server/services/retrieval/rerank.service.ts` 与 `models.model_type='rerank'` 完全不动
- **工具层不动**：`server/services/agent-platform/tools/recommendTemplate.tool.ts` 一行不改
- **前端不动**：`TemplateSelectCard.vue` / `RecommendTemplateCard.vue` 完全不动
- **粗筛 service 不动**：`templateRecommend.service.ts` 一行不改
- **测试用例总数不动**：rerank service 单测维持 14 个（10 原 + 4 coverage 补充），仅微调 mock 入参；新增 1 个用例覆盖"DB prompt 缺失走 FALLBACK"

## 4. 架构改动概览

```
┌──────────────────────────────────────────────────┐
│ recommendTemplate.tool.ts（不动）                  │
│   ↓                                              │
│ rerankTemplatesService                            │
│   ↓                                              │
│ callRerankLLM:                                    │
│   ├─ 旧：getValidNodeConfig('documentMain', ...)  │
│   ├─ 旧：const SYSTEM_PROMPT = '...'（硬编码常量）  │
│   ↓                                              │
│   ├─ 新：getValidNodeConfig('documentTemplateRerank', ...) │
│   ├─ 新：systemPrompt = nodeConfig.prompts.find(p => p.type==='system')?.content │
│   │       ?? FALLBACK_SYSTEM_PROMPT              │
│   └─ 其余流程（withStructuredOutput + 校验 + fallback）不变 │
└──────────────────────────────────────────────────┘
```

## 5. 数据库 seed 改动

按 `.claude/rules/database.md` 和 `.claude/rules/api.md` 的"管理端 API 注册流程"，**不写 prisma migration**，只动 `prisma/seeds/seedData.sql`。新增 3 条 INSERT（不是 4 条——`model_id` 是 nodes 表的直接列，没有 node_models 关联表）。

字段名以 `prisma/models/node.prisma` 真实 schema 为准（已 verify）。

### 5.1 nodes 表

```sql
INSERT INTO "public"."nodes" (
    "id", "name", "title", "description", "type", "priority",
    "model_id", "tools", "output_schema", "group_id", "status",
    "use_skills_as_logic", "thinking_enabled",
    "created_at", "updated_at", "deleted_at"
) VALUES (
    <next-id>,
    'documentTemplateRerank',
    '文书模板推荐 Rerank',
    '在文书生成 Agent 调 recommend_template 工具时，基于案件信息对粗筛候选模板做最终排序，输出 top 5。',
    'extraction',
    50,
    <documentMain 节点同款 model_id>,
    '[]'::jsonb,
    NULL,
    <documentMain 节点所在的 group_id>,
    1,
    'f',
    'f',
    '2026-05-14 10:00:00+08',
    '2026-05-14 10:00:00+08',
    NULL
);
```

字段说明（重要）：
- `type='extraction'`：参考 `contractReviewSummarize`（同样是"LLM 结构化输出"任务）的取值。可选枚举见 `node.prisma:36` 注释：`analysis / document / extraction / agent`。
- `tools='[]'`：rerank 是单次 LLM 决策调用，不需要任何工具。
- `output_schema=NULL`：JSON schema 由代码里的 `RerankOutputSchema`（Zod）管，DB 不存。
- `model_id` 与 `group_id` 落盘前必须查真实值：
  ```sql
  SELECT model_id, group_id FROM nodes WHERE name='documentMain';
  ```
  禁止猜数字。

### 5.2 prompts 表

```sql
INSERT INTO "public"."prompts" (
    "id", "name", "title", "content", "variables", "version", "type", "status",
    "created_at", "updated_at", "deleted_at"
) VALUES (
    <next-id>,
    'documentTemplateRerank_system',
    '文书模板推荐 Rerank-系统提示词',
    '你是法律文书模板推荐专家。用户正在律师文书生成助手中起草法律文书，
你需要根据【案件上下文】和【用户最新一句话】，从给定的候选模板中选出最合适的若干个模板。

判断维度（重要性递减）：
1. 模板是否切合用户最新一句话表达的文书起草需求
2. 模板适用的法律领域是否匹配案件类型（如劳动纠纷案件应优先劳动相关模板）
3. 模板是否适合当前案件所处阶段（起诉/答辩/上诉/执行）
4. 候选中标记 recentlyUsed=true 的模板说明用户最近用过，
   若与当前需求相关可适当优先；若需求明显切换则不应仅凭"用过"加权

严格按 JSON schema 输出，templateId 必须来自候选列表的 id，禁止编造。',
    '[]'::jsonb,
    '1',
    'system',
    1,
    '2026-05-14 10:00:00+08',
    '2026-05-14 10:00:00+08',
    NULL
);
```

字段说明：
- `name='documentTemplateRerank_system'`：参考项目命名约定 `<nodeName>_<promptType>`（如 `caseInfoCheck_system`、`extractInfo_user`）。
- `version='1'`：首版。后续运维通过新增 `version='2'`、status=1、把老版本 status=0 的方式做版本管理。
- `variables='[]'`：本 prompt 不带 `{{placeholder}}` 变量插值（变量已在代码 `buildUserMessage` 中预渲染到 HumanMessage 里）。
- `status=1`：激活态。
- 内容与当前代码 `SYSTEM_PROMPT` 常量**字节一致**（含换行），方便上线后对比 langfuse trace。

### 5.3 node_prompts 表

`node_prompts` 走"业务身份"关联（不直接持有 `prompt_id`，而是用 `(prompt_name, prompt_type)`），目的是激活新版本时节点关联自动跟随，详见 `node.prisma:159-187` 注释。

```sql
INSERT INTO "public"."node_prompts" (
    "id", "node_id", "prompt_name", "prompt_type", "display_order",
    "created_at", "updated_at"
) VALUES (
    <next-id>,
    <上面 5.1 nodes 表新增的 id>,
    'documentTemplateRerank_system',
    'system',
    100,
    '2026-05-14 10:00:00+08',
    '2026-05-14 10:00:00+08'
);
```

`display_order=100`（默认值，本节点只有 1 条 prompt，顺序无意义）。

### 5.4 不要动的部分

- `node_skills` 不挂任何 skill（rerank 不依赖 skill 体系）
- `api_permissions` 不动（rerank 不暴露 API）
- `level_node_access` 不动（rerank 是底层服务，不暴露给用户级权限控制）

## 6. rerank service 代码改动

文件：`server/agents/document/templateRerank.service.ts`

### 6.1 节点名常量

```typescript
// 改前
const DOCUMENT_MAIN_NODE_NAME = 'documentMain'

// 改后
const RERANK_NODE_NAME = 'documentTemplateRerank'
```

`DOCUMENT_MAIN_NODE_NAME` 在 `loadCaseContext` 里也用做 `agentName` 参数传给 `buildContextSegments`，那处**保持 'documentMain'**（语义是"以文书生成 Agent 视角拉案件上下文"，跟 rerank 节点无关）。所以两个常量并存：

```typescript
const RERANK_NODE_NAME = 'documentTemplateRerank'
const DOCUMENT_MAIN_NODE_NAME = 'documentMain'  // 仍用作 buildContextSegments 的 agentName
```

### 6.2 callRerankLLM 改造

```typescript
// 改前
const nodeConfig = await getValidNodeConfig(DOCUMENT_MAIN_NODE_NAME, '文书生成主Agent')
// ...
const messages = [
    new SystemMessage(SYSTEM_PROMPT),  // 硬编码常量
    new HumanMessage(buildUserMessage(input, caseContext)),
]

// 改后
const nodeConfig = await getValidNodeConfig(RERANK_NODE_NAME, '文书模板 Rerank')
// ...
// nodeConfig.prompts: NodePromptConfig[]（来自 server/services/node/node.service.ts:46）
const systemPrompt = nodeConfig.prompts.find(p => p.type === 'system')?.content
    ?? FALLBACK_SYSTEM_PROMPT
const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(buildUserMessage(input, caseContext)),
]
```

### 6.3 重命名常量

```typescript
// 改前
const SYSTEM_PROMPT = `你是法律文书模板推荐专家...`

// 改后
const FALLBACK_SYSTEM_PROMPT = `你是法律文书模板推荐专家...`
```

文本内容**完全不变**，只改变量名以表明这是 DB 缺失时的兜底。

### 6.4 fallback 行为（无新代码）

`getValidNodeConfig` 内部抛错的场景（节点不存在 / status=0 / 无可用 API key）→ 异常顺着 `callRerankLLM` 冒泡到 `rerankTemplatesService` 顶层的 try/catch → 落入 `llm_error` 分支 → 退化到 candidates 顺序补足。

**无需新增 catch 分支、无需新增 fallback reason**。

### 6.5 import 不变

`import { getValidNodeConfig } from '~~/server/services/node/node.service'` 一行不动。

## 7. 测试改动

文件：`tests/server/assistant/document/templateRerank.service.test.ts`

### 7.1 微调现有 mock（共 14 个用例）

所有 `(getValidNodeConfig as any).mockResolvedValue({...})` 的 mock 返回值，**追加 `prompts` 字段**：

```typescript
;(getValidNodeConfig as any).mockResolvedValue({
    modelSdkType: 'openai',
    modelName: 'gpt-4o-mini',
    modelMaxOutputTokens: 4096,
    modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
    modelProviderBaseUrl: 'https://api.example.com',
    prompts: [{ type: 'system', content: '测试 system prompt' }],  // 新增
})
```

不需要逐一改动 mock 入参的字符串校验——`getValidNodeConfig` mock 不检 input 参数，只看返回值。

### 7.2 新增 1 个用例

```typescript
it('DB prompt 缺失时走 FALLBACK_SYSTEM_PROMPT', async () => {
    // mock getValidNodeConfig 返回 prompts=[]，验证 invoke 仍正常调用
    // 且 invoke 收到的 SystemMessage content 含 "你是法律文书模板推荐专家" 字样
})
```

### 7.3 工具测试不动

`tests/server/agent-platform/tools/recommendTemplate.test.ts` 11 个用例**完全不变**——它们 mock 的是 `rerankTemplatesService` 整体，节点切换属于 rerank service 内部细节。

## 8. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| seedData.sql 漏 insert 任一行 | 上线后 rerank 始终走 fallback 粗筛顺序 | 落 plan 时把 3 条 INSERT 当作一个原子 commit，PR 描述明确列 3 条都要 |
| 默认 model_id 取值错误 | 节点能查到但 API 调用失败 → 走 llm_error fallback | 落盘前 `SELECT model_id, group_id FROM nodes WHERE name='documentMain'` 拿真值 |
| 多一次 DB 查询 | 每次推荐多 ~5ms | 可接受；推荐链路总耗时本来就 1-3s |
| Prompt 在 DB 里被运营误改导致 LLM 输出非 JSON | LLM 偶发抛错 → fallback 到粗筛 | 已经有 `.withStructuredOutput()` schema 校验 + 4 类 fallback 兜底 |
| 节点名拼写漂移 | rerank service 找不到节点 → 始终走 fallback | 用常量 `RERANK_NODE_NAME` 集中管理 |

## 9. 不变量

- 推荐质量：节点配置正确时与 Plan v2 实现完全一致（同款 model + 同款 prompt + 同套校验逻辑）
- 用户体验：零变化
- 前端 / 工具 / 粗筛 service / Agent 中间件栈 / 数据库 schema：完全不动
- Plan v2 已有的 4 类 fallback 体系：完全保留，仅复用，不新增分支

## 10. 决策记录

| 决策点 | 选择 | 理由 |
|---|---|---|
| 节点配置颗粒度 | 模型 + prompt（不挂 skill） | 既能换模型也能调 prompt 满足运维；rerank 不需要 skill |
| Prompt 管理位置 | 数据库 node_prompts + 代码 FALLBACK 兜底 | 后台可调 + 工程安全护栏 |
| 节点不可用 fallback | 退化到粗筛顺序（复用 llm_error 分支） | 不引入新概念，与 plan v2 一致 |
| 节点名 | `documentTemplateRerank` | 与 `documentMain` / `contractReviewMain` 命名一致 |
| 默认模型 | 复用 documentMain 同款 model_id | 保守起步，质量等价；运维可按需降级 |
| 默认 temperature / streaming | 仍由代码 hardcode（0.1 / false）传给 createChatModel | 这些不是节点级配置而是任务级行为，运维不该改 |
| Migration 还是 seed | seed | 不动 schema，纯数据扩充，符合项目 database.md 规范 |

## 11. 落地后验证清单

- [ ] 管理后台「节点」页能看到「文书模板推荐 Rerank」节点（自动扫描登记）
- [ ] 管理后台「节点详情」能看到关联的 prompt 内容、能编辑 + 保存
- [ ] 管理后台能切换该节点的 model 配置
- [ ] 在文书生成页发"帮我写起诉状"，langfuse trace 显示 LLM 调用的 SystemMessage 内容 = 后台 prompt 内容（证明换源生效）
- [ ] 在后台禁用该节点（status=0），再发同样的请求，trace 应看到 rerank service 退化到 candidates 顺序，前端仍能弹卡
- [ ] 在后台改 prompt 后立即生效（不需要重启服务，nodeConfig 每次都查 DB）
