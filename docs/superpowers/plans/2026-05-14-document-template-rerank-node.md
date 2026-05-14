# 文书模板 Rerank 节点化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `templateRerank.service.ts` 中"硬编码读 documentMain 节点 + 硬编码 SYSTEM_PROMPT"改成"读独立的 `documentTemplateRerank` 节点 + 从 `nodeConfig.prompts` 取 system prompt"，让模型与 prompt 都能在管理后台运维。

**Architecture:** 在 `prisma/seeds/seedData.sql` 新增 3 条 INSERT（nodes 1 条 + prompts 1 条 + node_prompts 1 条）；改造 `templateRerank.service.ts` 4 处常量级位置；保留代码内的 `FALLBACK_SYSTEM_PROMPT` 作为 DB 缺失时的安全护栏；测试 14 个 mock 加 `prompts` 字段 + 新增 1 个用例覆盖 FALLBACK 分支。Schema、前端、工具层、粗筛 service 完全不动。

**Tech Stack:**
- PostgreSQL seedData.sql（不写 prisma migration）
- `NodeConfig.prompts: NodePromptConfig[]`（已有，来自 `server/services/node/node.service.ts:46`）
- Vitest mock `getValidNodeConfig` 返回值加 `prompts` 字段
- 复用 plan v2 的 `llm_error` fallback 分支（节点不可用时 service 异常冒泡自动落入）

**前置文档**：`docs/superpowers/specs/2026-05-14-document-template-rerank-node-design.md`（commit `069c2cf1`）

---

## File Structure

**Modify:**
- `prisma/seeds/seedData.sql` — 新增 3 条 INSERT（nodes 表 1 条 + prompts 表 1 条 + node_prompts 表 1 条）
- `server/agents/document/templateRerank.service.ts` — 4 处常量级改动（节点名常量、SYSTEM_PROMPT → FALLBACK_SYSTEM_PROMPT、`getValidNodeConfig` 入参、`new SystemMessage` 参数）
- `tests/server/assistant/document/templateRerank.service.test.ts` — 14 个 mock 加 `prompts` 字段 + 1 个新用例

**Untouched（重要 — 这些不动）:**
- `prisma/models/*.prisma` — schema 不动
- `server/services/agent-platform/tools/recommendTemplate.tool.ts` — 工具层不动
- 前端任何 `.vue` 文件 — 不动
- `templateRecommend.service.ts` — 粗筛 service 不动
- `tests/server/agent-platform/tools/recommendTemplate.test.ts` — 工具测试不动

**已 verify 的真实 ID**（用于 seedData INSERT）：
- nodes 最大 id = 26 → 新节点 id = **27**
- prompts 最大 id = 48 → 新 prompt id = **49**
- node_prompts 最大 id = 1 → 新 node_prompt id = **2**
- documentMain 节点配置（用于复制 model_id / group_id）：**model_id=1, group_id=NULL**

> 落盘前用 `grep -oP 'INSERT INTO "public"\."nodes" .* VALUES \(\K[0-9]+' prisma/seeds/seedData.sql | sort -n | tail -1` 复核 nodes 最大 id 是否仍为 26；prompts、node_prompts 同理。若发现别人已 +1，把本 plan 里 27/49/2 顺延 +1。

---

## Task 1：seedData.sql 增量（数据基础设施）

**Files:**
- Modify: `prisma/seeds/seedData.sql`

本 task 先把 seed 数据落盘，rerank service 还读不到（service 仍在调 `documentMain`）。新节点在 dev 数据库里能查到但暂不影响运行。

### Step 1.1：定位 seedData.sql 插入位置

- [ ] **打开 `prisma/seeds/seedData.sql`，找到 3 个插入锚点**

```bash
grep -n "INSERT INTO \"public\"\.\"nodes\".*VALUES (26" prisma/seeds/seedData.sql
grep -n "INSERT INTO \"public\"\.\"prompts\".*VALUES (48" prisma/seeds/seedData.sql
grep -n "INSERT INTO \"public\"\.\"node_prompts\".*VALUES (1" prisma/seeds/seedData.sql
```

记下三行的行号，分别在它们**正下方**追加新的 INSERT。

### Step 1.2：插入新节点 INSERT（nodes 表）

- [ ] **在 nodes 表最后一条（id=26）下方追加**

```sql
INSERT INTO "public"."nodes" ("id", "name", "title", "description", "type", "priority", "model_id", "tools", "output_schema", "group_id", "status", "created_at", "updated_at", "deleted_at", "use_skills_as_logic", "thinking_enabled") VALUES (27, 'documentTemplateRerank', '文书模板推荐 Rerank', '在文书生成 Agent 调 recommend_template 工具时，基于案件信息对粗筛候选模板做最终排序，输出 top 5。', 'extraction', 50, 1, '[]', NULL, NULL, 1, '2026-05-14 10:00:00+08', '2026-05-14 10:00:00+08', NULL, 'f', 'f');
```

字段说明（便于审阅）：
- `type='extraction'`：与 `contractReviewSummarize`（id=19）同款
- `model_id=1`：与 `documentMain` 同款
- `tools='[]'`：rerank 不调任何工具
- `group_id=NULL`：与 `documentMain` 同款
- `status=1`：启用

### Step 1.3：插入新 prompt INSERT（prompts 表）

- [ ] **在 prompts 表最后一条（id=48）下方追加**

```sql
INSERT INTO "public"."prompts" ("id", "name", "title", "content", "variables", "version", "type", "status", "created_at", "updated_at", "deleted_at") VALUES (49, 'documentTemplateRerank_system', '文书模板推荐 Rerank-系统提示词', '你是法律文书模板推荐专家。用户正在律师文书生成助手中起草法律文书，
你需要根据【案件上下文】和【用户最新一句话】，从给定的候选模板中选出最合适的若干个模板。

判断维度（重要性递减）：
1. 模板是否切合用户最新一句话表达的文书起草需求
2. 模板适用的法律领域是否匹配案件类型（如劳动纠纷案件应优先劳动相关模板）
3. 模板是否适合当前案件所处阶段（起诉/答辩/上诉/执行）
4. 候选中标记 recentlyUsed=true 的模板说明用户最近用过，
   若与当前需求相关可适当优先；若需求明显切换则不应仅凭"用过"加权

严格按 JSON schema 输出，templateId 必须来自候选列表的 id，禁止编造。', '[]', '1', 'system', 1, '2026-05-14 10:00:00+08', '2026-05-14 10:00:00+08', NULL);
```

> 注意：SQL 字符串里有换行（多行 prompt 内容），PostgreSQL 的 'string' 字面量支持原生换行。粘贴时**保持换行原样**，不要把它压成一行——内容必须与 `templateRerank.service.ts` 现有 `SYSTEM_PROMPT` 常量字节一致（除最外层引号和换行转义差异）。

### Step 1.4：插入 node_prompts 关联（node_prompts 表）

- [ ] **在 node_prompts 表最后一条（id=1）下方追加**

```sql
INSERT INTO "public"."node_prompts" ("id", "node_id", "prompt_name", "prompt_type", "display_order", "created_at", "updated_at") VALUES (2, 27, 'documentTemplateRerank_system', 'system', 100, '2026-05-14 10:00:00+08', '2026-05-14 10:00:00+08');
```

关联规则（重要）：`node_prompts` 走"业务身份"`(prompt_name, prompt_type)` 关联，**不是 `prompt_id`**。`node_id=27` 指向 Step 1.2 插入的节点，`prompt_name + prompt_type` 指向 Step 1.3 插入的 prompt。

### Step 1.5：把 seed 增量灌入 dev 数据库

- [ ] **直接用 psql 跑这 3 条 SQL 到 dev 数据库**

不要跑 `bun run db:setup`（会全量 push 覆盖）——只跑新增的 3 条 INSERT：

```bash
docker exec -i $(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1) \
  psql -U daixin -d ls_new -c "
INSERT INTO \"public\".\"nodes\" (...) VALUES (27, 'documentTemplateRerank', ...);
INSERT INTO \"public\".\"prompts\" (...) VALUES (49, 'documentTemplateRerank_system', ...);
INSERT INTO \"public\".\"node_prompts\" (...) VALUES (2, 27, 'documentTemplateRerank_system', 'system', 100, ...);
"
```

> 简化做法：把 Step 1.2-1.4 的 3 行 SQL 拷到一个临时文件 `/tmp/rerank-seed.sql`，再 `docker exec -i ... psql -U daixin -d ls_new < /tmp/rerank-seed.sql`。

### Step 1.6：验证 dev 数据库 3 条数据已落

- [ ] **跑 3 个 SELECT 确认**

```bash
docker exec $(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1) \
  psql -U daixin -d ls_new -c "
SELECT id, name, type FROM nodes WHERE id = 27;
SELECT id, name, type, status FROM prompts WHERE id = 49;
SELECT id, node_id, prompt_name, prompt_type FROM node_prompts WHERE id = 2;
"
```

期望：3 行结果，nodes 显示 `27 | documentTemplateRerank | extraction`、prompts 显示 `49 | documentTemplateRerank_system | system | 1`、node_prompts 显示 `2 | 27 | documentTemplateRerank_system | system`。

### Step 1.7：验证 `getValidNodeConfig` 能解出 prompts

- [ ] **跑一个临时 Node 脚本验证**

```bash
npx tsx -e "
import { getValidNodeConfig } from './server/services/node/node.service'
const cfg = await getValidNodeConfig('documentTemplateRerank', '文书模板 Rerank')
console.log('node id:', cfg.id, 'name:', cfg.name)
console.log('prompts count:', cfg.prompts.length)
console.log('system prompt preview:', cfg.prompts.find(p => p.type === 'system')?.content.slice(0, 50))
"
```

期望：打印
- `node id: 27 name: documentTemplateRerank`
- `prompts count: 1`
- `system prompt preview: 你是法律文书模板推荐专家。用户正在律师文书生成助手中起草法律文书`

如果 `prompts count: 0`，说明 node_prompts 关联或 prompts.status=1 没生效，回退到 Step 1.4 复查。

### Step 1.8：Commit

- [ ] **commit seedData.sql 改动**

```bash
git add prisma/seeds/seedData.sql
git commit -m "$(cat <<'EOF'
feat(tools): 新增 documentTemplateRerank 节点 + 系统 prompt seed

把"硬编码读 documentMain 节点的 LLM rerank 调用"升级为"独立的 documentTemplateRerank 节点"

- nodes 表新增 id=27 documentTemplateRerank（type=extraction，复用 documentMain 的 model_id=1）
- prompts 表新增 id=49 documentTemplateRerank_system（内容与代码 SYSTEM_PROMPT 字节一致）
- node_prompts 表新增 id=2 走业务身份 (prompt_name, prompt_type) 关联

服务层切换在下一个 commit
EOF
)"
```

---

## Task 2：rerank service 切换数据源

按 TDD 节奏：先改 14 个现有测试 mock 加 `prompts` 字段 + 加 1 个新用例覆盖 FALLBACK 分支 → 跑测试确认 fail（代码还在读 documentMain）→ 改 service → 跑测试确认 pass → commit。

**Files:**
- Modify: `tests/server/assistant/document/templateRerank.service.test.ts`
- Modify: `server/agents/document/templateRerank.service.ts`

### Step 2.1：先给 14 个现有用例的 `getValidNodeConfig` mock 加 `prompts` 字段

- [ ] **打开测试文件，批量在每个 mockResolvedValue 中追加 `prompts`**

测试文件中每个 `(getValidNodeConfig as any).mockResolvedValue({...})` 调用要从：

```typescript
;(getValidNodeConfig as any).mockResolvedValue({
    modelSdkType: 'openai',
    modelName: 'gpt-4o-mini',
    modelMaxOutputTokens: 4096,
    modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
    modelProviderBaseUrl: 'https://api.example.com',
})
```

改成（追加 `prompts` 字段，其它字段不动）：

```typescript
;(getValidNodeConfig as any).mockResolvedValue({
    modelSdkType: 'openai',
    modelName: 'gpt-4o-mini',
    modelMaxOutputTokens: 4096,
    modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
    modelProviderBaseUrl: 'https://api.example.com',
    prompts: [{ id: 49, name: 'documentTemplateRerank_system', type: 'system', content: '测试 system prompt', version: '1', status: 1 }],
})
```

> 用 `grep -n "getValidNodeConfig as any).mockResolvedValue" tests/server/assistant/document/templateRerank.service.test.ts` 列出所有调用点，逐个改。不要用 sed 批量替换——多行字面量边界容易出错。

### Step 2.2：在 templateRerank.service.test.ts 末尾追加 2 个新用例

第 1 条是严格 TDD（改前 fail，改后 pass）；第 2 条是覆盖率兜底（改前改后都 pass，但覆盖 `??` fallback 分支让 coverage 工具能命中）。

- [ ] **在 describe 块末尾、`})` 闭合前追加**

```typescript
    it('DB prompt 优先：nodeConfig.prompts 含 system 时 SystemMessage 用 DB content', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')

        const DB_SPECIFIC_PROMPT = '【来自 DB 的特殊 prompt——绝不会出现在 FALLBACK 常量里的标记字符串_XYZ123】'
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai',
            modelName: 'gpt-4o-mini',
            modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
            prompts: [{ id: 49, name: 'documentTemplateRerank_system', type: 'system', content: DB_SPECIFIC_PROMPT, version: '1', status: 1 }],
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })

        const invokeMock = vi.fn().mockResolvedValue({
            picks: [{ templateId: 10 }, { templateId: 11 }, { templateId: 12 }],
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })

        expect(invokeMock).toHaveBeenCalledOnce()
        // 严格断言：SystemMessage.content 必须是 DB 提供的特殊字符串
        // 改前 service 用硬编码 SYSTEM_PROMPT 常量，不含 XYZ123 → fail
        // 改后 service 读 nodeConfig.prompts[0].content → contain XYZ123 → pass
        const messagesArg = invokeMock.mock.calls[0]![0] as Array<{ content: string; constructor: { name: string } }>
        const systemMsg = messagesArg.find(m => m.constructor.name === 'SystemMessage')
        expect(systemMsg).toBeDefined()
        expect(systemMsg!.content).toBe(DB_SPECIFIC_PROMPT)
    })

    it('DB prompt 缺失（nodeConfig.prompts=[]）时走 FALLBACK_SYSTEM_PROMPT', async () => {
        const { getValidNodeConfig } = await import('~~/server/services/node/node.service')
        const { createChatModel } = await import('~~/server/services/node/chatModelFactory')
        const { buildContextSegments } = await import('~~/server/services/agent-platform/context/moduleContextBuilder')

        // 节点配置正常，但 prompts 数组为空 → service 应回退到代码里的 FALLBACK_SYSTEM_PROMPT
        ;(getValidNodeConfig as any).mockResolvedValue({
            modelSdkType: 'openai',
            modelName: 'gpt-4o-mini',
            modelMaxOutputTokens: 4096,
            modelApiKeys: [{ status: 1, apiKey: 'sk-test' }],
            modelProviderBaseUrl: 'https://api.example.com',
            prompts: [],  // 关键：DB 没挂 prompt
        })
        ;(buildContextSegments as any).mockResolvedValue({
            roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
        })

        const invokeMock = vi.fn().mockResolvedValue({
            picks: [{ templateId: 10 }, { templateId: 11 }, { templateId: 12 }],
        })
        ;(createChatModel as any).mockReturnValue({
            withStructuredOutput: vi.fn().mockReturnValue({ invoke: invokeMock }),
        })

        const r = await rerankTemplatesService({
            userId: 1, sessionId: 's1', userQuery: 'x', intent: 'x',
            candidates: [makeCandidate(10), makeCandidate(11), makeCandidate(12), makeCandidate(13), makeCandidate(14), makeCandidate(15)],
            topN: 5,
        })

        // 调用应成功（不走 fallback 分支）
        expect(r.fallback).toBe(false)
        expect(invokeMock).toHaveBeenCalledOnce()

        // 验证传给 LLM 的 SystemMessage 内容是 FALLBACK_SYSTEM_PROMPT（含项目特有关键字）
        const messagesArg = invokeMock.mock.calls[0]![0] as Array<{ content: string; constructor: { name: string } }>
        const systemMsg = messagesArg.find(m => m.constructor.name === 'SystemMessage')
        expect(systemMsg).toBeDefined()
        expect(systemMsg!.content).toContain('你是法律文书模板推荐专家')
    })
```

### Step 2.3：跑测试确认失败

- [ ] **跑测试**

```bash
npx vitest run tests/server/assistant/document/templateRerank.service.test.ts --reporter=verbose
```

期望：
- 原 14 个用例**仍然 pass**（mock 加 prompts 字段是兼容性扩展，service 还没读它）
- 新用例 1（"DB prompt 优先"）**fail**：service 仍用硬编码 `SYSTEM_PROMPT`，SystemMessage.content 不含 `XYZ123` 标记字符串
- 新用例 2（"DB prompt 缺失走 FALLBACK"）**pass**：原代码恰好满足该契约（硬编码 SYSTEM_PROMPT 就含"你是法律文书模板推荐专家"），覆盖率兜底意义存在

如果用例 1 意外 pass，说明 service 已经被改过了，回退到 git 状态确认 templateRerank.service.ts 没被改动。

### Step 2.4：改 service 第 1 处——添加 `RERANK_NODE_NAME` 常量

- [ ] **修改 `server/agents/document/templateRerank.service.ts:68`**

把：

```typescript
const DOCUMENT_MAIN_NODE_NAME = 'documentMain'
```

改成：

```typescript
const RERANK_NODE_NAME = 'documentTemplateRerank'
const DOCUMENT_MAIN_NODE_NAME = 'documentMain'  // 仍用作 buildContextSegments 的 agentName
```

### Step 2.5：改 service 第 2 处——`SYSTEM_PROMPT` 重命名 `FALLBACK_SYSTEM_PROMPT`

- [ ] **修改 `server/agents/document/templateRerank.service.ts:77`**

把：

```typescript
const SYSTEM_PROMPT = `你是法律文书模板推荐专家。用户正在律师文书生成助手中起草法律文书，
```

改成：

```typescript
const FALLBACK_SYSTEM_PROMPT = `你是法律文书模板推荐专家。用户正在律师文书生成助手中起草法律文书，
```

> 文本内容**完全不变**（含换行、标点），仅改变量名。常量值起止行号 `77-87` 内的字符串字面量不动。

### Step 2.6：改 service 第 3 处——`callRerankLLM` 中切换节点名 + 读 prompts

- [ ] **修改 `server/agents/document/templateRerank.service.ts:110-130` 段**

把 `callRerankLLM` 函数体的前半段（行号 111-129）：

```typescript
async function callRerankLLM(input: RerankInput, caseContext: string): Promise<{ templateId: number; reason?: string }[]> {
    const nodeConfig = await getValidNodeConfig(DOCUMENT_MAIN_NODE_NAME, '文书生成主Agent')
    const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${DOCUMENT_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
    }
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.1,
        streaming: false,
        maxTokens: Math.min(2000, nodeConfig.modelMaxOutputTokens ?? 2000),
    })

    const structured = (model as any).withStructuredOutput(RerankOutputSchema, { name: 'rerank_picks' })
    const messages = [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(buildUserMessage(input, caseContext)),
    ]
```

改成：

```typescript
async function callRerankLLM(input: RerankInput, caseContext: string): Promise<{ templateId: number; reason?: string }[]> {
    const nodeConfig = await getValidNodeConfig(RERANK_NODE_NAME, '文书模板 Rerank')
    const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${RERANK_NODE_NAME} 节点没有可用的 API 密钥`)
    }
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.1,
        streaming: false,
        maxTokens: Math.min(2000, nodeConfig.modelMaxOutputTokens ?? 2000),
    })

    // nodeConfig.prompts: NodePromptConfig[]（server/services/node/node.service.ts:46）
    const systemPrompt = nodeConfig.prompts.find(p => p.type === 'system')?.content
        ?? FALLBACK_SYSTEM_PROMPT

    const structured = (model as any).withStructuredOutput(RerankOutputSchema, { name: 'rerank_picks' })
    const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(buildUserMessage(input, caseContext)),
    ]
```

**3 处变化**：
1. `getValidNodeConfig(DOCUMENT_MAIN_NODE_NAME, '文书生成主Agent')` → `getValidNodeConfig(RERANK_NODE_NAME, '文书模板 Rerank')`
2. error message 里的 `${DOCUMENT_MAIN_NODE_NAME}` → `${RERANK_NODE_NAME}`
3. 在 `structured = ...` 之前插入一段 `const systemPrompt = ...`；`new SystemMessage(SYSTEM_PROMPT)` → `new SystemMessage(systemPrompt)`

### Step 2.7：跑测试确认全过

- [ ] **跑测试**

```bash
npx vitest run tests/server/assistant/document/templateRerank.service.test.ts --reporter=verbose
```

期望：16 个用例（14 原 + 2 新）全 pass。

### Step 2.8：跑工具测试确认不受影响

- [ ] **工具测试不动，但要 verify 仍 pass**

```bash
npx vitest run tests/server/agent-platform/tools/recommendTemplate.test.ts --reporter=verbose
```

期望：11 个用例全 pass（这些 mock 的是 `rerankTemplatesService` 整体，节点切换是 service 内部细节，不影响）。

### Step 2.9：Commit

- [ ] **commit service 改动 + 测试改动**

```bash
git add server/agents/document/templateRerank.service.ts tests/server/assistant/document/templateRerank.service.test.ts
git commit -m "$(cat <<'EOF'
feat(tools): rerank service 从 documentMain 切换到 documentTemplateRerank 节点

- 新增 RERANK_NODE_NAME 常量（DOCUMENT_MAIN_NODE_NAME 保留给 buildContextSegments）
- SYSTEM_PROMPT 重命名为 FALLBACK_SYSTEM_PROMPT，表明是 DB 缺失时的兜底
- callRerankLLM 改读 nodeConfig.prompts.find(p => p.type==='system')?.content
- 测试 14 个 mock 加 prompts 字段 + 新增 FALLBACK 兜底用例
EOF
)"
```

---

## Task 3：类型检查 + 全量回归 + coverage 卡点

**Files:**
- 仅运行验证命令，不改代码

### Step 3.1：跑类型检查

- [ ] **跑 typecheck**

```bash
bun run typecheck
```

期望：无新增类型错误。如果 `nodeConfig.prompts.find(p => p.type === 'system')` 有隐式 any 报错，把 callback 显式标注 `(p: NodePromptConfig) => ...`，并在文件顶部加 `import type { NodePromptConfig } from '~~/server/services/node/node.service'`。

### Step 3.2：跑文书相关测试

- [ ] **跑文书测试**

```bash
npx vitest run tests/server/assistant/document/ tests/server/agent-platform/tools/recommendTemplate.test.ts --reporter=verbose
```

期望：所有文书相关测试 PASS（含 templateRerank 16 个 + recommendTemplate.tool 11 个 + 其它 document* 测试）。

### Step 3.3：跑全量测试

- [ ] **跑全量**

```bash
bun run test
```

期望：与上次 plan v2 落地后基线一致（KNOWN_FAILS 已知失败可豁免，不引入新 fail）。

### Step 3.4：跑覆盖率确认 ≥95%

- [ ] **跑 coverage**

```bash
bun run coverage 2>&1 | tail -150
```

期望：`server/agents/document/templateRerank.service.ts` 与 `server/services/agent-platform/tools/recommendTemplate.tool.ts` 的行/分支覆盖率仍 ≥95%（本次改动新增的"FALLBACK 兜底"分支由 Step 2.2 的新用例覆盖）。

如果某分支没覆盖到，按 plan v2 落地时 Task 6 的做法补测试，commit message 用 `test(tools): rerank service 节点化补覆盖率`。

---

## Self-Review Notes

**1. Spec coverage**
- ✅ Spec §5.1 nodes INSERT → Task 1 Step 1.2
- ✅ Spec §5.2 prompts INSERT → Task 1 Step 1.3
- ✅ Spec §5.3 node_prompts INSERT → Task 1 Step 1.4
- ✅ Spec §6.1 节点名常量 → Task 2 Step 2.4
- ✅ Spec §6.2 callRerankLLM 改造 → Task 2 Step 2.6
- ✅ Spec §6.3 SYSTEM_PROMPT 重命名 → Task 2 Step 2.5
- ✅ Spec §6.4 fallback 行为无新代码 → 验证通过 Task 3 全量测试（无新分支引入）
- ✅ Spec §7.1 14 个 mock 加 prompts → Task 2 Step 2.1
- ✅ Spec §7.2 新增用例覆盖 DB content 优先 + FALLBACK 兜底 → Task 2 Step 2.2（2 条新用例）
- ✅ Spec §7.3 工具测试不动 → Task 2 Step 2.8 仅验证
- ✅ Spec §11 落地后验证清单（5 项手工 E2E）→ 不计入 Task checkbox，作为合并前推荐验证

**2. Placeholder 扫描**
- 所有 ID（27/49/2、model_id=1）都给的真实值
- `<next-id>` 之类的占位符：仅文档顶部"前置文档"段的 `069c2cf1` 是真实 commit hash
- 没有 "TBD" / "TODO" / "implement later"

**3. Type consistency**
- `RERANK_NODE_NAME` 常量在 Step 2.4 定义、Step 2.6 使用 ✓
- `FALLBACK_SYSTEM_PROMPT` 在 Step 2.5 定义、Step 2.6 使用 ✓
- `nodeConfig.prompts` 类型 `NodePromptConfig[]` 在 Step 2.1 mock 字段、Step 2.6 代码、Step 3.1 typecheck 兜底全部一致 ✓
- `documentTemplateRerank` 节点名在 Task 1 (3 处) 和 Task 2 Step 2.4 全部字面一致 ✓
- `documentTemplateRerank_system` prompt name 在 Task 1 Step 1.3、Step 1.4 全部字面一致 ✓
