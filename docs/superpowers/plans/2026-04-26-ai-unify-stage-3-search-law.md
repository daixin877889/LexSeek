# 阶段 3 · search_law 普及 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让模块对话 / 文书生成 / 合同审查三个场景下的 LLM 都能通过 `search_law` 工具检索法条，并在 system prompt 末尾追加"必要时引用法条，使用 search_law 工具"指令；前端 LawSearchTool.vue 在新场景下渲染验证。

**Architecture:** 阶段 3 是 DB 配置驱动的"配置改一行"级改造，**不动任何 agent 运行时代码**。改动集中在两处：(1) `prisma/seeds/seedData.sql` 中 `nodes.tools` 数组与 `prompts.content` 文本字段；(2) 已部署环境（dev / ls_new_testing）通过一次性 TypeScript Prisma 脚本同步落库。架构本身不变 — `defineDomainAgent` 工厂的 `runtime.ts` 在 `nodeConfig.tools.length > 0` 分支自动调 `getToolInstancesService`，新加的 'search_law' 字符串会自动被解析为 LangChain 工具实例，无需任何 TS 代码修改。

**Tech Stack:** Prisma + PostgreSQL（数据落库）/ Vitest（验证测试）/ TypeScript（一次性更新脚本）/ Vue 3（前端 LawSearchTool.vue 验证）

---

## 关键事实速览（动手前必读）

**当前 seedData.sql 实际状态**（从 `/Users/daixin/work/dev/LexSeek/LexSeek/prisma/seeds/seedData.sql` 实读）：

| 节点 | id | 当前 tools | 当前 prompt 是否提及 search_law | 阶段 3 工作 |
|---|---|---|---|---|
| `documentMain` | 17 | `["process_materials", "search_case_materials", "search_law"]` | ✓ 第 2105/2111 行明确指示调用 search_law | **无需改动** |
| `contractReviewMain` | 18 | `["parse_and_ask_stance"]` | ✗ 仅在第 26 号 prompt 说"引用具体法条"，未提工具名 | **核心改动：tools + prompt 双改** |
| `summary` (caseModule) | 6 | `["search_case_materials", "search_law"]` | 部分（旧名 `searchLawTool`） | **prompt 末尾追加新指令** |
| `chronicle` (caseModule) | 7 | `["search_case_materials", "search_law", "process_materials"]` | 未明确 | **prompt 末尾追加新指令** |
| `claim` (caseModule) | 8 | `["search_case_materials", "search_law", "process_materials"]` | 部分（旧名 `searchLawTool`） | **prompt 末尾追加新指令** |
| `trend` (caseModule) | 9 | `["search_case_materials", "search_law", "process_materials"]` | 部分（旧名 `searchLawTool`） | **prompt 末尾追加新指令** |
| `cause` (caseModule) | 10 | `["search_law", "search_case_materials", "process_materials"]` | 部分（旧名 `searchLawTool`） | **prompt 末尾追加新指令** |
| `defense` (caseModule) | 11 | `["search_case_materials", "search_law", "process_materials"]` | 未明确 | **prompt 末尾追加新指令** |
| `evidence` (caseModule) | 12 | `["search_case_materials", "search_law", "process_materials"]` | 未明确 | **prompt 末尾追加新指令** |

**关键架构事实**：

1. **caseModule = 7 个分析节点的集合**：`server/agents/case-module/agent.config.ts` 的 `nodeName: (ctx) => String(ctx.metadata?.moduleName ?? '')` 是动态节点名 — 每个模块对话场景使用对应的分析节点（summary/chronicle/claim/trend/cause/defense/evidence）。spec 说"caseModule 节点"是泛指这批节点，**没有单独的 `caseModule` 实体节点**。

2. **`search_law` 工具已注册**：`server/services/agent-platform/tools/index.ts` 的 `toolModules` 映射含 `search_law`，无需新增工具实现；只需把字符串 `"search_law"` 加进节点的 `tools` 数组。

3. **`runtime.ts` 自动解析**：`server/services/agent-platform/factory/runtime.ts:216-220` 在 `nodeConfig.tools.length > 0` 时调用 `getToolInstancesService(nodeConfig.tools, toolContext)`，自动把字符串数组转为 LangChain 工具实例。

4. **合同审查 sub-agent 限制（已知，本阶段不解决）**：`server/agents/contract/analyzeSingleClause.ts` 用 `invokeNodeJson` 调用 `contractReviewAnalyzeClause` 节点（type='extraction'），走 **结构化输出 LLM 调用，不支持 tool call**。所以 `contractReviewMain` 加 `search_law` 后，**只能在首轮 stance 选择前的主 agent 阶段被调用**（resume 后的 `runAnalyzeLoop` → `analyzeSingleClause` 子流程内无法使用）。这是**阶段 4 "合同审查接底座"** 才解决的事，本阶段在 plan 自审里明确标注，不算缺陷。

5. **旧名 `searchLawTool` 是 pre-existing issue**：`summary/claim/trend/cause` 提示词内有大量 `searchLawTool` 旧名残留（不是新引入的）。本阶段**不批量改名**（避免与提示词改造混在一起），只追加新指令使用新名 `search_law`。改名作为后续提示词改造的事项。

**git 干净度检查（2026-04-26 当前状态）**：

```
git status --short
 M tests/server/memory/consolidator.processNow.test.ts
 M tests/server/xiaosuo-session.test.ts
```

这两个文件是阶段 2 后期遗留的 unstaged 修改，**与阶段 3 无关**。Task 1 第一步就核实并清理工作区，避免污染本次 commit。

---

## 文件结构总览（本阶段产出）

| 文件 | 类型 | 责任 |
|---|---|---|
| `prisma/seeds/seedData.sql` | 修改 | 唯一数据真实源：8 处 INSERT 调整（contractReviewMain 节点 + 8 个 prompt 文本） |
| `scripts/stage3-apply-search-law.ts` | 新建 | 一次性 TypeScript Prisma 脚本：把 seedData 增量应用到 dev / ls_new_testing 的现有 DB（避免 dump/restore） |
| `tests/server/agent-platform/nodeConfig.searchLaw.test.ts` | 新建 | 节点配置验收测试：3 类节点的 tools / prompt 都已配置好 |
| `app/components/ai/tools/LawSearchTool.vue` | 仅验证 | 不动代码，只验证现有渲染逻辑在新场景下正确 |
| `scripts/stage3-regression.sh` | 新建 | 阶段 3 回归脚本（仿 `stage2-regression.sh`） |

---

## Task 1：清理工作区遗留 + 启动调研

**Files:**
- 检查：`git status --short`
- 检查：`tests/server/memory/consolidator.processNow.test.ts`
- 检查：`tests/server/xiaosuo-session.test.ts`

- [ ] **Step 1: 工作区干净度检查**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
git status --short
```

预期输出 ≤ 2 行（上面提到的两个 test 文件）。

- [ ] **Step 2: 看两个 test 文件实际改动**

```bash
git diff tests/server/memory/consolidator.processNow.test.ts
git diff tests/server/xiaosuo-session.test.ts
```

判断这是阶段 2 收尾遗留还是其他无关修改。如果是无意义 noise（比如格式化、import 顺序），用以下方式 stash 掉：

```bash
git stash push -m "stage3-pre-cleanup: 阶段 2 遗留 test 修改" -- \
  tests/server/memory/consolidator.processNow.test.ts \
  tests/server/xiaosuo-session.test.ts
```

如果实际有意义、需要保留，单独 commit 后再继续阶段 3：

```bash
git add tests/server/memory/consolidator.processNow.test.ts tests/server/xiaosuo-session.test.ts
git commit -m "test: 同步阶段 2 遗留测试修改（前置阶段 3）"
```

- [ ] **Step 3: 确认起点 commit + tag**

```bash
git rev-parse HEAD
git tag --list | grep ai-unify
```

预期看到 `ai-unify-stage-2-done` tag 存在。当前 HEAD 应该 == `ai-unify-stage-2-done` 指向的 commit（或在其之上）。

- [ ] **Step 4: 确认 search_law 工具已在工具注册表**

```bash
grep -n "search_law" /Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent-platform/tools/index.ts
```

预期看到 `'search_law':` 在 `toolModules` 映射中（`tools/index.ts:30-46` 范围）。如果没有，停下来排查 — 阶段 3 的前置假设破了。

- [ ] **Step 5: 在 worktree 里建分支（如果还没建）**

```bash
git checkout -b dev-stage3-search-law 2>/dev/null || git checkout dev-stage3-search-law
```

后续 commit 都进这个分支；阶段 3 完成后 merge 到 dev / 主线。

---

## Task 2：seedData.sql — `contractReviewMain` 节点 tools 加 `search_law`

**Files:**
- Modify: `prisma/seeds/seedData.sql:1080`

- [ ] **Step 1: 定位现有 INSERT**

```bash
grep -n "contractReviewMain" /Users/daixin/work/dev/LexSeek/LexSeek/prisma/seeds/seedData.sql
```

预期定位到 1080 行（节点 INSERT），格式：

```sql
INSERT INTO "public"."nodes" (...) VALUES (18, 'contractReviewMain', '合同审查主Agent', '...', 'agent', 40, 1, '["parse_and_ask_stance"]', NULL, NULL, 1, '2026-04-18 10:00:00+08', '2026-04-18 10:00:00+08', NULL) ON CONFLICT (name) DO NOTHING;
```

- [ ] **Step 2: 改 tools 字段，加 `search_law`**

用 Edit 把这一行的 `'["parse_and_ask_stance"]'` 替换为 `'["parse_and_ask_stance", "search_law"]'`。

修改后该行应为：

```sql
INSERT INTO "public"."nodes" ("id", "name", "title", "description", "type", "priority", "model_id", "tools", "output_schema", "group_id", "status", "created_at", "updated_at", "deleted_at") VALUES (18, 'contractReviewMain', '合同审查主Agent', '按 responseFormat 输出结构化风险清单，并通过 parse_and_ask_stance 工具中断请求用户立场', 'agent', 40, 1, '["parse_and_ask_stance", "search_law"]', NULL, NULL, 1, '2026-04-18 10:00:00+08', '2026-04-18 10:00:00+08', NULL) ON CONFLICT (name) DO NOTHING;
```

注意：`ON CONFLICT (name) DO NOTHING` 表示**已存在的 contractReviewMain 不会被 seedData.sql 覆盖**。所以仅改 SQL 不够，需配套 Task 4 的 update 脚本同步存量 DB。

- [ ] **Step 3: 检查没有破坏 SQL 语法**

```bash
grep -n "contractReviewMain" /Users/daixin/work/dev/LexSeek/LexSeek/prisma/seeds/seedData.sql | head -3
```

确认改动后该行仍有完整闭合的 `)` 和 `;`。

- [ ] **Step 4: commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(contract): seedData 给 contractReviewMain 节点加 search_law 工具"
```

---

## Task 3：seedData.sql — 8 个 prompt 末尾追加 search_law 指令

**Files:**
- Modify: `prisma/seeds/seedData.sql` 的 8 处 prompts INSERT

8 个目标 prompt（来自实读 seedData）：

| prompt id | name | node_id | 在 seedData 行号 |
|---|---|---|---|
| 7 | summary_system | 6 | 1244 |
| 8 | chronicle_system | 7 | 1274 |
| 9 | claim_system | 8 | 1286 |
| 10 | trend_system | 9 | 1428 |
| 11 | cause_system | 10 | 1669 |
| 12 | defense_system | 11 | 1729 |
| 13 | evidence_system | 12 | 1815 |
| 26 | contractReview_system | 18 | 2131 |

**指令文本（统一）**：

```
\n\n## 法条引用（search_law 工具）\n\n本节点已挂载 `search_law` 工具。当用户询问"哪条法律支撑这个结论"、"引用条款依据"、"对应法条"等需要法条出处的问题时，必须调用 `search_law` 工具检索具体法条全文，并将返回结果以「法律名称 + 条号 + 条文摘要」格式附在回答中作为依据。**禁止凭记忆背诵法条号**。
```

**为什么这样设计这段指令**：
- 显式工具新名 `search_law`（避免延续旧名 `searchLawTool` 的歧义）
- 列举触发场景示例，让 LLM 在主对话期间稳定调用
- 强制"禁止凭记忆背诵法条号" — 防止 LLM 跳过工具直接生成假法条号
- 用单独的 H2 标题，对各 prompt 的现有结构破坏最小

> **注意**：每个 prompt 的 INSERT 是单行 SQL，content 字段用单引号包裹的多行文本。**直接 Edit 那一行** — 在 SQL 字符串结尾的右单引号 `'` 之前插入指令文本。SQL 字符串内部的换行（`\n`）需写成 PostgreSQL 接受的形式：在 INSERT 字符串里直接用真实的换行（即按 Enter）即可，PostgreSQL 会把跨行字符串原样存。

- [ ] **Step 1: 改 prompt 7（summary_system）**

定位：

```bash
grep -n "summary_system" /Users/daixin/work/dev/LexSeek/LexSeek/prisma/seeds/seedData.sql
```

读取该 INSERT 完整文本（建议 Read 文件后 Edit；INSERT 跨多行）。

用 Edit 工具把现有 prompt 末尾的 `'` 之前（即 content 字段的最后字符）追加：

```
（紧接现有内容末尾换行后）

## 法条引用（search_law 工具）

本节点已挂载 `search_law` 工具。当用户询问"哪条法律支撑这个结论"、"引用条款依据"、"对应法条"等需要法条出处的问题时，必须调用 `search_law` 工具检索具体法条全文，并将返回结果以「法律名称 + 条号 + 条文摘要」格式附在回答中作为依据。**禁止凭记忆背诵法条号**。
```

**操作方式**：
1. 用 Read 读 1244 行附近 30 行
2. 找到 prompt 7 INSERT 中 content 字段闭合的最后一个文本片段（在 `', '[]', 'v1', 'system',` 之前的那个 `'`）
3. 用 Edit `old_string` = "片段末尾原文 + `', '[]', 'v1', 'system'`"
4. 用 Edit `new_string` = "片段末尾原文 + 上面新指令 + `', '[]', 'v1', 'system'`"
5. 因为 prompt 内容跨多行、有特殊字符，直接构造 old_string 时务必从 Read 输出复制；可只取该 prompt 末尾 80-150 字符 + 之后字段开头作为唯一锚点

⚠️ 关键：**禁止用 sed 批量替换 8 个 prompt** — 全局规则要求"不用 sed 批量"。逐个 Edit。

- [ ] **Step 2: 同步改 prompt 8（chronicle_system）**

按 Step 1 同样手法。

- [ ] **Step 3: 同步改 prompt 9（claim_system）**

按 Step 1 同样手法。

- [ ] **Step 4: 同步改 prompt 10（trend_system）**

按 Step 1 同样手法。

- [ ] **Step 5: 同步改 prompt 11（cause_system）**

按 Step 1 同样手法。

- [ ] **Step 6: 同步改 prompt 12（defense_system）**

按 Step 1 同样手法。

- [ ] **Step 7: 同步改 prompt 13（evidence_system）**

按 Step 1 同样手法。

- [ ] **Step 8: 同步改 prompt 26（contractReview_system）**

按 Step 1 同样手法。

- [ ] **Step 9: 用 grep 验证所有 8 处都已加入新指令**

```bash
grep -c "本节点已挂载 \`search_law\` 工具" /Users/daixin/work/dev/LexSeek/LexSeek/prisma/seeds/seedData.sql
```

预期输出：`8`（精确等于 8）。

- [ ] **Step 10: 验证 SQL 仍然合法（可选）**

如果有本地 PostgreSQL，可在测试库 dry-run：

```bash
psql -d ls_dryrun_seed -f /Users/daixin/work/dev/LexSeek/LexSeek/prisma/seeds/seedData.sql 2>&1 | grep -i "error\|fail" | head -5
```

如果没有本地 dryrun 库就跳过；后续 Task 4 的更新脚本会真实落库。

- [ ] **Step 11: commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(prompts): 8 个 prompts 末尾追加 search_law 工具使用指令"
```

---

## Task 4：写一次性 update 脚本同步存量 DB

**Files:**
- Create: `scripts/stage3-apply-search-law.ts`

阶段 3 是数据增量；存量 DB（dev / ls_new_testing）已存在 `contractReviewMain` 等节点，seedData 的 `ON CONFLICT DO NOTHING` 不会更新。需要写脚本主动 update。

**为什么不用 prisma migrate**：迁移只管 schema；数据更新不该走 migrate。LexSeek 项目规则也明确禁止"在 migrations 里加独立 SQL 脚本"。

**为什么不直接手写 SQL**：项目规则推荐通过 TypeScript + Prisma Client 做数据更新，便于回滚 + 类型安全。

- [ ] **Step 1: 看 prisma client 引入路径**

```bash
grep -rn "from '~~/server" /Users/daixin/work/dev/LexSeek/LexSeek/scripts/migrate-contract-risks.ts | head -5
```

参照已有 migration 脚本（如 `scripts/migrate-contract-risks.ts`）的 prisma 引入与执行风格。

- [ ] **Step 2: 创建脚本**

写到 `/Users/daixin/work/dev/LexSeek/LexSeek/scripts/stage3-apply-search-law.ts`：

```typescript
/**
 * 阶段 3 一次性数据更新脚本：把 search_law 工具配置应用到现有 DB。
 *
 * 用法：
 *   bun run scripts/stage3-apply-search-law.ts
 *   DATABASE_URL='postgresql://...ls_new_testing' bun run scripts/stage3-apply-search-law.ts
 *
 * 幂等：重复跑不会重复加 search_law；prompt 已含指令的不再追加。
 *
 * 触发的更新：
 *   1. nodes.tools 给 contractReviewMain 加 'search_law'（如果还没）
 *   2. 8 个 system prompt 末尾追加 search_law 工具使用指令（如果还没）
 *
 * 注意：本脚本只跑一次，跑完后将 search_law 配置纳入 seedData.sql 作为新建库的真理来源。
 */

import { PrismaClient } from '../generated/prisma'

const prisma = new PrismaClient()

const SEARCH_LAW_INSTRUCTION = `

## 法条引用（search_law 工具）

本节点已挂载 \`search_law\` 工具。当用户询问"哪条法律支撑这个结论"、"引用条款依据"、"对应法条"等需要法条出处的问题时，必须调用 \`search_law\` 工具检索具体法条全文，并将返回结果以「法律名称 + 条号 + 条文摘要」格式附在回答中作为依据。**禁止凭记忆背诵法条号**。
`

/** 已加过指令的检测锚点（与正文严格一致） */
const INSTRUCTION_MARKER = '本节点已挂载 `search_law` 工具'

const PROMPT_NODE_NAMES = [
    'summary',
    'chronicle',
    'claim',
    'trend',
    'cause',
    'defense',
    'evidence',
    'contractReviewMain',
]

async function addSearchLawToContractReviewMain(): Promise<void> {
    const node = await prisma.nodes.findUnique({ where: { name: 'contractReviewMain' } })
    if (!node) {
        console.warn('[skip] 节点 contractReviewMain 不存在（DB 未 seed？）')
        return
    }

    const tools = Array.isArray(node.tools) ? (node.tools as string[]) : []
    if (tools.includes('search_law')) {
        console.log('[noop] contractReviewMain 已含 search_law')
        return
    }

    const newTools = [...tools, 'search_law']
    await prisma.nodes.update({
        where: { id: node.id },
        data: { tools: newTools },
    })
    console.log(`[ok] contractReviewMain.tools: ${JSON.stringify(tools)} -> ${JSON.stringify(newTools)}`)
}

async function appendSearchLawInstructionToPrompts(): Promise<void> {
    for (const nodeName of PROMPT_NODE_NAMES) {
        const node = await prisma.nodes.findUnique({ where: { name: nodeName } })
        if (!node) {
            console.warn(`[skip] 节点 ${nodeName} 不存在`)
            continue
        }

        const activePrompt = await prisma.prompts.findFirst({
            where: {
                nodeId: node.id,
                type: 'system',
                status: 1,
                deletedAt: null,
            },
        })
        if (!activePrompt) {
            console.warn(`[skip] 节点 ${nodeName} 无 status=1 的 system prompt`)
            continue
        }

        if (activePrompt.content.includes(INSTRUCTION_MARKER)) {
            console.log(`[noop] ${nodeName}.system_prompt 已含指令`)
            continue
        }

        await prisma.prompts.update({
            where: { id: activePrompt.id },
            data: {
                content: activePrompt.content.trimEnd() + SEARCH_LAW_INSTRUCTION,
            },
        })
        console.log(`[ok] ${nodeName}.system_prompt 追加指令（prompt id=${activePrompt.id}）`)
    }
}

async function main(): Promise<void> {
    console.log('===== 阶段 3 · search_law 配置同步开始 =====')
    console.log(`[env] DATABASE_URL=${process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@')}`)
    await addSearchLawToContractReviewMain()
    await appendSearchLawInstructionToPrompts()
    console.log('===== 阶段 3 · search_law 配置同步结束 =====')
}

main()
    .catch((err) => {
        console.error('阶段 3 同步脚本失败：', err)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
```

> **PrismaClient 引入路径**：先用 `grep -rn "from '../generated/prisma'" scripts/` 验证项目 prisma client 实际位置。如果项目用的是 `@prisma/client` 或其他路径，按本地实际改。

- [ ] **Step 3: 在开发库上 dry-run（无 DATABASE_URL 走默认）**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
bun run scripts/stage3-apply-search-law.ts
```

预期输出（开发库视情况）：

```
===== 阶段 3 · search_law 配置同步开始 =====
[env] DATABASE_URL=postgresql://lexseek:***@localhost:5432/lexseek
[ok] contractReviewMain.tools: ["parse_and_ask_stance"] -> ["parse_and_ask_stance","search_law"]
[ok] summary.system_prompt 追加指令（prompt id=7）
[ok] chronicle.system_prompt 追加指令（prompt id=8）
... 共 8 行
===== 阶段 3 · search_law 配置同步结束 =====
```

如果某条出现 `[skip]` 或 `[noop]`，说明该节点 / prompt 状态异常或已部分应用（幂等运行符合预期）。

- [ ] **Step 4: 在测试库同步**

```bash
DATABASE_URL='postgresql://USER:PASS@localhost:5432/ls_new_testing' bun run scripts/stage3-apply-search-law.ts
```

> **Note：** 在跑之前先 `bun run prisma:push` 确保测试库 schema 是最新（项目记忆：测试库 schema 偶尔会不同步）。`prisma:push` 命令在 `package.json` 里。

- [ ] **Step 5: 跑一次脚本第二遍验证幂等**

```bash
bun run scripts/stage3-apply-search-law.ts
```

预期所有 9 行（1 节点 + 8 prompt）都输出 `[noop]`，没有 `[ok]`。

- [ ] **Step 6: commit 脚本**

```bash
git add scripts/stage3-apply-search-law.ts
git commit -m "chore(stage3): 一次性 search_law 配置同步脚本"
```

---

## Task 5：写节点配置验证测试（TDD 锚定）

**Files:**
- Create: `tests/server/agent-platform/nodeConfig.searchLaw.test.ts`

这是配置层"防回退"测试：每跑回归就检查所有相关节点都已挂 search_law + prompt 含指令。

测试不依赖真实 LLM/SSE，只读 DB 节点配置即可。

- [ ] **Step 1: 看现有 nodeConfig 测试模式**

```bash
ls /Users/daixin/work/dev/LexSeek/LexSeek/tests/server/agent-platform/
```

参考已有测试（如 `runtime.test.ts` / `factory.test.ts`）的 mock 风格、测试 DB 接入风格。

- [ ] **Step 2: 创建测试文件**

写到 `/Users/daixin/work/dev/LexSeek/LexSeek/tests/server/agent-platform/nodeConfig.searchLaw.test.ts`：

```typescript
/**
 * 阶段 3 节点配置防回退测试。
 *
 * 这是"DB 视角"的配置验收：直接读测试库的 nodes / prompts，
 * 验证 search_law 工具与提示词指令都已就位。
 * 与运行时（runtime.ts）单测互不耦合。
 */

import { describe, it, expect } from 'vitest'
import { prisma } from '~~/server/utils/prisma'

const NODES_REQUIRING_SEARCH_LAW = [
    'caseMain',
    'assistantMain',
    'documentMain',
    'contractReviewMain',
    'summary',
    'chronicle',
    'claim',
    'trend',
    'cause',
    'defense',
    'evidence',
] as const

const NODES_REQUIRING_PROMPT_INSTRUCTION = [
    'summary',
    'chronicle',
    'claim',
    'trend',
    'cause',
    'defense',
    'evidence',
    'contractReviewMain',
] as const

const INSTRUCTION_MARKER = '本节点已挂载 `search_law` 工具'

describe('阶段 3 · search_law 节点配置覆盖', () => {
    it('11 个节点的 tools 都包含 search_law', async () => {
        const nodes = await prisma.nodes.findMany({
            where: { name: { in: [...NODES_REQUIRING_SEARCH_LAW] } },
            select: { name: true, tools: true },
        })

        // 防止 DB 没 seed
        expect(nodes).toHaveLength(NODES_REQUIRING_SEARCH_LAW.length)

        for (const node of nodes) {
            const tools = Array.isArray(node.tools) ? (node.tools as string[]) : []
            expect(tools, `节点 ${node.name} 的 tools 字段应是 string[]`).toBeInstanceOf(Array)
            expect(tools, `节点 ${node.name} 应含 search_law；当前 tools=${JSON.stringify(tools)}`).toContain('search_law')
        }
    })

    it('8 个节点的 system prompt 都含 search_law 指令', async () => {
        for (const nodeName of NODES_REQUIRING_PROMPT_INSTRUCTION) {
            const node = await prisma.nodes.findUnique({
                where: { name: nodeName },
                select: { id: true },
            })
            expect(node, `节点 ${nodeName} 应在 DB 存在`).not.toBeNull()

            const prompt = await prisma.prompts.findFirst({
                where: {
                    nodeId: node!.id,
                    type: 'system',
                    status: 1,
                    deletedAt: null,
                },
                select: { id: true, content: true },
            })
            expect(prompt, `节点 ${nodeName} 应有 status=1 的 system prompt`).not.toBeNull()

            expect(
                prompt!.content,
                `节点 ${nodeName}（promptId=${prompt!.id}）的 system prompt 应含 marker "${INSTRUCTION_MARKER}"`,
            ).toContain(INSTRUCTION_MARKER)
        }
    })
})
```

- [ ] **Step 3: 跑测试，预期 PASS**

```bash
npx vitest run tests/server/agent-platform/nodeConfig.searchLaw.test.ts --reporter=verbose
```

预期输出：

```
✓ 阶段 3 · search_law 节点配置覆盖
  ✓ 11 个节点的 tools 都包含 search_law
  ✓ 8 个节点的 system prompt 都含 search_law 指令

Test Files  1 passed (1)
Tests  2 passed (2)
```

如果失败，看具体节点 / promptId 异常信息，回 Task 4 用脚本补齐。

- [ ] **Step 4: 反向验证 — 临时把测试节点 tools 改空，确认测试 FAIL**

```bash
DATABASE_URL='postgresql://USER:PASS@localhost:5432/ls_new_testing' \
  bun -e "import('./generated/prisma').then(async ({ PrismaClient }) => { const p = new PrismaClient(); await p.nodes.update({ where: { name: 'contractReviewMain' }, data: { tools: ['parse_and_ask_stance'] } }); await p.\$disconnect() })"

npx vitest run tests/server/agent-platform/nodeConfig.searchLaw.test.ts --reporter=verbose
```

预期 FAIL，错误信息提到 contractReviewMain。然后再跑一次同步脚本恢复：

```bash
DATABASE_URL='postgresql://USER:PASS@localhost:5432/ls_new_testing' bun run scripts/stage3-apply-search-law.ts
npx vitest run tests/server/agent-platform/nodeConfig.searchLaw.test.ts
```

预期重新 PASS。这一步是 "RED then GREEN" 的 TDD 锚定。

> **如果反向验证太麻烦或 risk 太高（污染共享库），可以省略此步**，但至少在测试日志里记录"已从无到有看过 RED"作为一次心智校验。

- [ ] **Step 5: commit**

```bash
git add tests/server/agent-platform/nodeConfig.searchLaw.test.ts
git commit -m "test(stage3): 节点配置防回退测试 — 11 节点 tools + 8 prompt 指令"
```

---

## Task 6：合同审查 streaming 测试更新（验证 search_law 在主 agent 阶段可用）

**Files:**
- Modify: `tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts`

合同审查的 search_law 只能在首轮 stance 选择前的主 agent 阶段被调用（resume 后的 `runAnalyzeLoop` 走 invokeNodeJson 不支持 tools，是 已知限制）。但至少要写 1 个测试断言：**主 agent 的工具列表里有 search_law**。

- [ ] **Step 1: 读 streaming 测试现状**

```bash
cat /Users/daixin/work/dev/LexSeek/LexSeek/tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts | head -100
```

了解现有 mock 风格和测试用例编排。

- [ ] **Step 2: 看 streaming 测试中 mockNodeConfig 的 tools 字段（核心场景）**

```bash
grep -n "tools:" /Users/daixin/work/dev/LexSeek/LexSeek/tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts | head -10
```

如果 mock 中 contractReviewMain 的 tools 写死成 `['parse_and_ask_stance']`（不含 search_law），需要更新为 `['parse_and_ask_stance', 'search_law']`。

- [ ] **Step 3: 更新 mock 使其与新 seedData 对齐**

用 Edit 把 mock 中：

```typescript
tools: ['parse_and_ask_stance']
```

改为：

```typescript
tools: ['parse_and_ask_stance', 'search_law']
```

确保 mock 反映 DB 真实状态（防止 mock 漂移）。

- [ ] **Step 4: 在已有"基础流式行为"测试旁加一条新测试**

格式参照同文件已有 `it('xxx', async () => {...})` 风格，新加：

```typescript
it('阶段 3 · contractReviewMain 主 agent tools 应包含 search_law（resume 前可被调用）', async () => {
    // 复用本文件已有的 mockNodeConfig / contractReviewMain config 工具函数
    const config = await getValidNodeConfig('contractReviewMain')
    expect(config.tools).toContain('search_law')
    expect(config.tools).toContain('parse_and_ask_stance')

    // 已知限制：search_law 在 runAnalyzeLoop / analyzeSingleClause 子流程内不可用，
    // 因为 invokeNodeJson 走结构化输出 LLM，不支持 tool calling。
    // 阶段 4 通过 Command.resume + 中间件改造解决该限制；本阶段仅保证主 agent 阶段可用。
})
```

> **如果同文件原本不 mock `getValidNodeConfig`，而是 mock 某个具体函数返回值**，那把这条改造为读 mock 出来的 tools 字段断言，原则一致。重点是**断言 tools 含 search_law**。

- [ ] **Step 5: 跑该测试文件，预期 PASS**

```bash
npx vitest run tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts --reporter=verbose
```

确认所有原有 case 仍 PASS + 新 case PASS。

- [ ] **Step 6: commit**

```bash
git add tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts
git commit -m "test(contract): 流式测试 mock 同步 search_law 工具 + 新增主 agent tools 含 search_law 断言"
```

---

## Task 7：前端 LawSearchTool.vue 渲染验证

**Files:**
- Verify only: `app/components/ai/tools/LawSearchTool.vue`

LawSearchTool.vue 是基于 `props.output` 渲染的纯展示组件，**渲染逻辑与具体业务场景无关** — 只要工具调用产生标准 search_law 输出格式，组件都能正常渲染。

阶段 3 的"前端验证"本质是确保**新增场景下产生的工具输出 = 现有 caseMain / assistantMain 已经在用的输出**。这是一致性检查，不是 UI 改造。

- [ ] **Step 1: 看 LawSearchTool.vue 期望的 props.output 数据结构**

```bash
cat /Users/daixin/work/dev/LexSeek/LexSeek/app/components/ai/tools/LawSearchTool.vue
```

记录其期望的 JSON 字段（如 `query`、`results[].lawName`、`results[].articleNumber`、`results[].content` 等）。

- [ ] **Step 2: 看 search_law 工具实际返回的数据结构**

```bash
cat /Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent-platform/tools/searchLaw.tool.ts
```

对比工具返回的 JSON 结构与 LawSearchTool.vue 解析的字段是否一致。

**关键断言**：工具返回的 schema 与组件解析的字段**完全一致**。如果不一致（理论上不应该，因为 caseMain / assistantMain 已在用），说明现有代码本身就有 bug，**先记录为 pre-existing issue 反馈给用户**，不在阶段 3 修复（避免 scope 蔓延）。

- [ ] **Step 3: 在 dev server 起前端做手工 smoke**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
bun dev
```

在浏览器分别走以下 3 个场景，每个都问"《民法典》关于借贷的核心条款是哪条？"：

1. **模块对话**：进入任一案件 → 进入分析模块（如"诉讼策略"）→ 在模块对话框输入问题
2. **文书生成**：进入文书生成 → 起草起诉状 → 在对话中提该问题
3. **合同审查**：上传一份合同 → 选择立场 → 在 stance 选择前向主 agent 问该问题（注意阶段 3 限制：resume 后无法触发）

每个场景预期：
- LLM 在思考过程中调用 `search_law` 工具
- 前端渲染出 LawSearchTool.vue 卡片，包含法律名称、条号、条文内容
- 复制按钮可用

- [ ] **Step 4: 把手工验证结果记在 markdown 里**

写到 `/Users/daixin/work/dev/LexSeek/LexSeek/docs/superpowers/notes/2026-04-26-stage3-frontend-smoke.md`：

```markdown
# 阶段 3 · 前端 LawSearchTool.vue 三场景 smoke 记录

日期：YYYY-MM-DD

## 场景 1：模块对话（模块=诉讼策略，节点=defense）
- 输入："《民法典》关于借贷的核心条款是哪条？"
- LLM 是否调 search_law：✓/✗
- LawSearchTool.vue 是否正确渲染：✓/✗
- 截图：[截图路径或贴图]

## 场景 2：文书生成（templateName=起诉状）
- 输入：同上
- ...

## 场景 3：合同审查（stance 选择前主 agent 阶段）
- 输入：同上
- ...
- 已知限制：resume 后 search_law 不可调（阶段 4 解决），本场景仅验证 stance 前主 agent 阶段
```

- [ ] **Step 5: commit smoke 记录**

```bash
git add docs/superpowers/notes/2026-04-26-stage3-frontend-smoke.md
git commit -m "docs(stage3): 前端 LawSearchTool 三场景 smoke 记录"
```

---

## Task 8：写阶段 3 回归脚本 + 打 tag

**Files:**
- Create: `scripts/stage3-regression.sh`

仿 `scripts/stage2-regression.sh`，串起类型检查 + 关键测试 + 工作区干净度。

- [ ] **Step 1: 用 stage2 脚本作底版生成 stage3 版本**

写到 `/Users/daixin/work/dev/LexSeek/LexSeek/scripts/stage3-regression.sh`：

```bash
#!/usr/bin/env bash
# 阶段 3 全量回归脚本
# 用途：AI 基建统一改造阶段 3（search_law 普及）收尾前一键验证
# 用法：bash scripts/stage3-regression.sh

set -e

PASS="[OK]"
FAIL="[ERROR]"

echo "======================================="
echo "  阶段 3 · search_law 普及 全量回归"
echo "======================================="

# -----------------------------------------------
# 1/5 类型检查
# -----------------------------------------------
echo ""
echo "[1/5] 类型检查..."
TYPECHECK_OUT=$(npx nuxi typecheck 2>&1 || true)
echo "$TYPECHECK_OUT" | tail -20
if echo "$TYPECHECK_OUT" | grep -E "error TS" > /dev/null 2>&1; then
    # 阶段 3 不引入新 ts 代码，只动 SQL + 测试 + 一次性脚本，
    # 但容忍 app.vue 历史路由深度问题（项目记忆已记）
    REMAINING=$(echo "$TYPECHECK_OUT" | grep -E "error TS" | grep -v "app.vue" | head -5)
    if [ -n "$REMAINING" ]; then
        echo ""
        echo "$FAIL 类型检查发现新 TS 错误（非 app.vue 历史问题）："
        echo "$REMAINING"
        exit 1
    fi
fi
echo "$PASS 类型检查通过"

# -----------------------------------------------
# 2/5 节点配置防回退测试（阶段 3 核心）
# -----------------------------------------------
echo ""
echo "[2/5] 节点配置防回退测试..."
npx vitest run tests/server/agent-platform/nodeConfig.searchLaw.test.ts 2>&1 | tail -15
echo "$PASS 节点配置测试通过"

# -----------------------------------------------
# 3/5 平台库 + agent 测试集（阶段 2 已有）
# -----------------------------------------------
echo ""
echo "[3/5] 平台库 + agent 测试集..."
npx vitest run tests/shared/types tests/server/agent-platform tests/server/agent 2>&1 | tail -15
echo "$PASS 平台库测试通过"

# -----------------------------------------------
# 4/5 受影响业务 streaming 测试（contract / document / module / case-main / assistant）
# -----------------------------------------------
echo ""
echo "[4/5] 业务 streaming 测试..."
npx vitest run \
    tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts \
    tests/server/workflow/agents/documentMainAgent.test.ts \
    tests/server/workflow/agents/moduleAgent.test.ts \
    tests/server/workflow/agents/caseMainAgent.test.ts \
    tests/server/workflow/agents/assistantAgent.test.ts \
    2>&1 | tail -15
echo "$PASS 业务流式测试通过"

# -----------------------------------------------
# 5/5 工作区干净检查
# -----------------------------------------------
echo ""
echo "[5/5] 工作区干净度..."
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
    echo "$FAIL 工作区不干净，请先提交或暂存："
    echo "$DIRTY"
    exit 1
fi
echo "$PASS 工作区干净"

echo ""
echo "======================================="
echo "  阶段 3 全量回归通过 ✓"
echo "======================================="
echo ""
echo "建议打 tag："
echo "  git tag -a ai-unify-stage-3-done -m '阶段 3 完成：search_law 普及'"
echo ""
```

- [ ] **Step 2: 跑回归**

```bash
chmod +x scripts/stage3-regression.sh
bash scripts/stage3-regression.sh
```

预期 5/5 全 PASS。

- [ ] **Step 3: commit 回归脚本**

```bash
git add scripts/stage3-regression.sh
git commit -m "chore(stage3): 阶段 3 全量回归脚本"
```

- [ ] **Step 4: merge 回 dev 分支并打 tag**

```bash
git checkout dev
git merge dev-stage3-search-law
git tag -a ai-unify-stage-3-done -m '阶段 3 完成：search_law 普及（contractReviewMain + 7 模块节点 prompt 指令）'
```

- [ ] **Step 5: 写阶段 3→4 交接 note**

写到 `/Users/daixin/work/dev/LexSeek/LexSeek/docs/superpowers/notes/2026-04-26-stage3-to-stage4-handoff.md`：

```markdown
# 阶段 3 → 阶段 4 交接说明

## 阶段 3 已完成（tag ai-unify-stage-3-done）

- contractReviewMain 节点 tools 加 search_law（seedData + 一次性脚本同步）
- 8 个节点 system prompt 末尾追加 search_law 工具使用指令（caseModule 7 个 + contractReviewMain）
- nodeConfig.searchLaw.test.ts 防回退测试落地

## 阶段 3 遗留 / 阶段 4 入口

1. **合同审查 search_law 限制**（核心阶段 4 议题）：
   - resume 后的 `runAnalyzeLoop` → `analyzeSingleClause` 走 `invokeNodeJson` 结构化输出，**不支持 tool calling**。所以 search_law 在合同审查 resume 后的子流程内**无法被调用**。
   - 阶段 4 计划用 `Command.resume` + 中间件 + 工具改造让 resume 路径回归主线，届时 search_law 在子流程内才能用。
   - 不要在阶段 4 之前尝试单独修这一点 — 改造点很多，与阶段 4 整体计划重叠。

2. **`searchLawTool` 旧名残留**（pre-existing issue，不阻塞）：
   - summary/claim/trend/cause 提示词内多处 `searchLawTool` 旧名（不是阶段 3 新引入），与 `tools/index.ts` 注册的新名 `search_law` 不一致。
   - LLM 看到旧名的提示词后会尝试调旧名工具失败 → fallback 调 search_law（一般情况下 LLM 能容错）。
   - 留待提示词整体改造（阶段 8）一起改名。

3. **caseModule 不是单一节点**：
   - `case-module/agent.config.ts` 用 `nodeName: (ctx) => ctx.metadata.moduleName`，每个分析模块（summary/chronicle/...）是独立节点。
   - 后续如果要加 caseModule 通用提示词指令，需要批改所有 7 个分析节点的 prompt（阶段 3 已统一加完 search_law 指令）。

## 阶段 4 入口指引

- spec：`docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md` §6 阶段 4
- 关键文件：`server/agents/contract/agent.config.ts` + `server/services/workflow/agents/contractReviewMainAgent.ts` 的 `runContractReviewChat` 函数
- 风险：spec §7 标记为"高"，需 1-2 周回归 + SSE 事件序列对比
```

- [ ] **Step 6: commit handoff note**

```bash
git add docs/superpowers/notes/2026-04-26-stage3-to-stage4-handoff.md
git commit -m "docs(stage3): 阶段 3 → 阶段 4 交接说明"
```

- [ ] **Step 7: 完成播报**

终端打印：

```
阶段 3 全部任务完成。
- DB 配置：8 个 prompt 指令落库 + contractReviewMain tools 加 search_law
- 测试：nodeConfig.searchLaw.test.ts 11 节点 tools / 8 prompt 指令防回退
- 前端：LawSearchTool.vue 三场景 smoke 通过
- Tag：ai-unify-stage-3-done

下一步：spec §6 阶段 4 「合同审查接入底座」（1-2 周，高风险）
```

---

## 自审检查（writing-plans 强制）

**1. Spec 覆盖检查（来自 spec §6 阶段 3）**

| spec 完成定义 | Plan 任务 |
|---|---|
| 在管理后台把 search_law 加到 caseModule / documentMain / contractReviewMain 三个节点的 nodes.tools | Task 2（contractReviewMain）；caseModule 已是 7 节点已含；documentMain 已含 |
| 三个节点的 system prompt 末尾追加"必要时引用法条，使用 search_law 工具"指令（修改 prompts 表对应记录）| Task 3 改 8 个 prompt（caseModule 7 个 + contractReviewMain 1 个；documentMain prompt 已含同等指令，本阶段不重复改） |
| LawSearchTool.vue 在三个新场景下渲染正常 | Task 7（手工 smoke）|
| E2E 模块对话场景 | Task 7 场景 1 |
| E2E 文书生成场景 | Task 7 场景 2 |
| E2E 合同审查场景 | Task 7 场景 3（带阶段 3 已知限制说明）|

spec §7 风险"合同审查在 analyzeSingleClause 等子流程里需确认 search_law 能在子代理工具调用链里正常工作" → 在 Plan 关键事实 #4 + Task 6 + Task 8 handoff note 中均明确说明：阶段 3 仅覆盖主 agent 阶段，子流程限制留给阶段 4。

**2. 占位符扫描**

- 全文无 TBD / TODO / "implement later"
- Step 4 Task 4（PrismaClient 引入路径）有"按本地实际改"，但前置 step 1 给出了具体 grep 命令验证；不是放任型占位符
- Task 7 手工 smoke 步骤本质需要人手操作，已尽可能给出具体场景描述与 prompt 文案

**3. 类型一致性**

- `search_law`（带下划线，与 `tools/index.ts` 注册名一致）— 全文一致
- `'search_law'` 字符串字面量与 `nodeConfig.tools` 的 string[] 类型一致
- `INSTRUCTION_MARKER = '本节点已挂载 \`search_law\` 工具'` — Task 4 脚本 + Task 5 测试 + Task 3 SQL 三处文本完全一致
- `NODES_REQUIRING_SEARCH_LAW`（11 个，Task 5）与 `PROMPT_NODE_NAMES`（8 个，Task 4）数量差异已在文档关键事实速览表里说明（caseMain / assistantMain / documentMain 已有指令或不在阶段 3 范围内，故不重复加）

---

## 风险与缓解（阶段 3 专属）

| 风险 | 级别 | 缓解 |
|---|---|---|
| 一次性更新脚本 PrismaClient 引入路径不对 | 低 | Task 4 step 1 先 grep 验证；写错只是脚本启动失败，不会污染 DB |
| 8 处 prompt 文本 Edit 中误伤其他 SQL 字符 | 中 | 每处 Edit 前 Read 上下文；Step 9 用 grep -c "本节点已挂载" 校验恰好 8 次；如果 ≠8 立即 git diff 复盘 |
| 测试库 schema 与主库不同步 | 低 | Task 4 step 4 提示先跑 prisma:push（项目记忆已记） |
| 合同审查 search_law 实际不被调（resume 后限制） | 中 | 已在多处明确为已知限制；Task 7 step 3 场景 3 注明"仅主 agent 阶段"；阶段 4 解决 |
| 旧名 `searchLawTool` 残留导致 LLM 调用失败 | 低 | 阶段 3 不动旧名，新指令显式用新名；LLM 容错可处理；阶段 8 提示词改造时统一改名 |
