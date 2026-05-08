# PR 1 · partyDetector 短路修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `partyDetector.ts:49-51` 提前 return 导致 `contractType` 永远 null 的线上 bug，让 playbook 真正参与合同审查 prompt。

**Architecture:** 删除"正则命中甲乙方就 return"的短路；不论正则是否命中，都调用 LLM 推断 contractType；正则识别的甲乙方作为 prompt hint 注入给 LLM 参考。运维埋点用 `logger.info('[contractPartyDetect] regex+llm', { regexHinted, consistent })` 落日志，**不扩 `PartyDetectionResult.source` 字面量 union**（保持 `'regex' | 'llm' | 'none'` 不变）。

**Tech Stack:** Nuxt 4 server + TypeScript + Prisma + Vitest + DeepSeek（走 anthropic SDK 兼容协议）+ `invokeNodeJson` 工具

**Spec:** `docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md` §3 PRE-1

**工期：** 0.5 天

**所属 Spec PR：** PR 1（独立可发布；spec §11 Layer 0）

**依赖：** 无（独立可发布）；本 PR 修复后下游 SUB-1 PR 2-7 才能在新模型下复用 contractType

---

## 文件清单

### 修改

- `prisma/seeds/seedData.sql:3468` — `contractPartyDetect_system` prompt 末尾追加"正则提示"段说明（同时随 data migration commit）
- `prisma/migrations/<ts>_update_contract_party_detect_prompt_v2/migration.sql` — 新建 data migration 同步更新 prompts 表（不用 docker exec UPDATE，按 `.claude/rules/database.md` 规范）
- `server/agents/contract/docx/partyDetector.ts:44-74` — `detectParties` 删除短路 + 注入正则 hint + logger 埋点
- `tests/server/assistant/contract/docx/partyDetector.test.ts` — 调整 regex 路径测试断言（mock LLM + source='llm'）+ 新增 hint 注入路径测试

### 不需要改

- `shared/types/contract.ts` — `PartyDetectionResult` 接口的 `source` 字面量 union 保持不变（运维信息走 logger）
- DB 节点 `contractPartyDetect`（id=25） — 已存在，无需新建

---

## Task 1: 新建 data migration（DB 同步走正式 prisma migrate 流程）

**Files:**
- Create: `prisma/migrations/<ts>_update_contract_party_detect_prompt_v2/migration.sql`
- Modify: `prisma/seeds/seedData.sql:3468`（保持 seed 与 prod schema 一致）

> 本 task 仅做"DB 字段就绪"——按 `.claude/rules/database.md`，DB 数据变更必须走 `prisma migrate dev --create-only` 流程，绝不用 `docker exec UPDATE` 旁路。

- [ ] **Step 1: 用 prisma migrate dev --create-only 生成空迁移文件**

```bash
bun run prisma:migrate -- --create-only --name update_contract_party_detect_prompt_v2
```

Expected: 输出 `Created the migration ... but did not apply it`，生成 `prisma/migrations/<ts>_update_contract_party_detect_prompt_v2/migration.sql`（内容为空 / 仅注释）。

> `--` 是必需的分隔符，确保后面参数透传给 prisma CLI（spec §4.3 + `.claude/rules/database.md`）。

- [ ] **Step 2: 编辑 migration.sql 写 UPDATE prompts 语句**

```sql
-- AlterPrompt: contractPartyDetect_system 加正则提示段
UPDATE "prompts"
SET "content" = "content" || E'\n\n## 正则提示（可能存在）\n\n如果用户提示文本里出现"正则提示"段（甲方候选 / 乙方候选），表示服务端正则已识别到甲乙方，**优先采用正则识别的结果**填到 partyA / partyB 字段，除非正则结果明显是签章占位符（如"签字" / "盖章"）或者非合同主体名。contractType 必须由你独立从合同正文判断，不要因为正则提示就跳过类型识别。',
    "updated_at" = NOW()
WHERE "name" = 'contractPartyDetect_system';
```

- [ ] **Step 3: 本地 apply 这条 migration**

```bash
bun run prisma:migrate
```

Expected: 输出 `Applying migration ...`，本地 `ls_new` 库的 prompts 表 contractPartyDetect_system 内容末尾有新段。

- [ ] **Step 4: 同步 seedData.sql 保持基线一致**

按 §`.claude/rules/database.md` "唯一例外"流程，seedData.sql 是基础数据快照，需要同步反映最新 prompt 内容。

Edit: `prisma/seeds/seedData.sql:3468`，把 contractPartyDetect_system 的 content 字段在 `- 只输出 JSON，不要任何解释、注释或 Markdown 代码块` 后追加：

```
\n\n## 正则提示（可能存在）\n\n如果用户提示文本里出现"正则提示"段（甲方候选 / 乙方候选），表示服务端正则已识别到甲乙方，**优先采用正则识别的结果**填到 partyA / partyB 字段，除非正则结果明显是签章占位符（如"签字" / "盖章"）或者非合同主体名。contractType 必须由你独立从合同正文判断，不要因为正则提示就跳过类型识别。
```

- [ ] **Step 5: 验证 prompt 落库正确**

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT RIGHT(content, 200) FROM prompts WHERE name = 'contractPartyDetect_system';"
```

Expected: 输出末尾包含 `## 正则提示（可能存在）` 和 `优先采用正则识别的结果`。

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/ prisma/seeds/seedData.sql
git commit -m "feat(contract): contractPartyDetect prompt 加正则提示段（data migration）

PRE-1 第 1 步。新增 data migration 把 contractPartyDetect_system 的 prompt
内容末尾追加'正则提示'段，告诉 LLM：服务端正则已识别甲乙方时优先采用，
contractType 仍由 LLM 独立判断。同步更新 seedData.sql 保持基线一致。

按 .claude/rules/database.md 规范走 prisma migrate dev --create-only 流程，
不用 docker exec UPDATE 旁路。

配合下个 commit 的 partyDetector 短路修复一起生效。"
```

---

## Task 2: 写 partyDetector 失败测试（TDD：先测后改）

**Files:**
- Modify: `tests/server/assistant/contract/docx/partyDetector.test.ts`

> 按项目 TDD 铁律（`.claude/rules/main.md`），先写失败测试再改实现。

- [ ] **Step 1: 在文件末尾新增 describe 块——hint 注入路径测试**

Edit: `tests/server/assistant/contract/docx/partyDetector.test.ts`（紧跟最后一个 describe 块之后）：

```ts
describe('detectParties (regex hint → llm path)', () => {
    it('正则命中甲乙方 → 仍调 LLM 推 contractType；source=llm', async () => {
        vi.mocked(invokeNodeJson).mockResolvedValueOnce({
            partyA: '上海坑人科技有限公司',
            partyB: '杨白劳',
            contractType: '劳动合同',
        })
        const paragraphs = [
            '劳动合同',
            '甲方：上海坑人科技有限公司',
            '乙方：杨白劳',
            '一、工作内容：员工岗位为软件工程师。',
        ]
        const result = await detectParties(paragraphs)
        expect(result.partyA).toBe('上海坑人科技有限公司')
        expect(result.partyB).toBe('杨白劳')
        expect(result.contractType).toBe('劳动合同') // 关键：不再为 null
        expect(result.source).toBe('llm')
        expect(invokeNodeJson).toHaveBeenCalledTimes(1)
    })

    it('正则命中甲乙方 + LLM 失败 → 降级到 regex 路径（contractType=null，向后兼容）', async () => {
        vi.mocked(invokeNodeJson).mockRejectedValueOnce(new Error('network error'))
        const paragraphs = [
            '劳动合同',
            '甲方：上海坑人科技有限公司',
            '乙方：杨白劳',
        ]
        const result = await detectParties(paragraphs)
        expect(result.partyA).toBe('上海坑人科技有限公司')
        expect(result.partyB).toBe('杨白劳')
        expect(result.contractType).toBeNull()
        expect(result.source).toBe('regex')
    })

    it('正则命中甲乙方 + LLM 覆盖了 partyA → 采用 LLM 输出（LLM 可纠正正则误识别）', async () => {
        vi.mocked(invokeNodeJson).mockResolvedValueOnce({
            partyA: '某科技股份有限公司', // LLM 输出与正则不同
            partyB: '杨白劳',
            contractType: '劳动合同',
        })
        const paragraphs = [
            '劳动合同',
            '甲方：误识别的占位文字',
            '乙方：杨白劳',
        ]
        const result = await detectParties(paragraphs)
        expect(result.partyA).toBe('某科技股份有限公司')
        expect(result.source).toBe('llm')
    })
})
```

- [ ] **Step 2: 改造旧"regex path" describe 块的 5 个测试**

旧测试断言"正则命中时不调 LLM"已不成立，改为：mock LLM 响应 + 断言 `source='llm'` + LLM 被调用。

文件第 19-78 行 `describe('detectParties (regex path)')` 块改为 `describe('detectParties (regex hint with mocked llm)')`，并按以下模式改三类测试：

模式 1（5 份样本测试，第 20-28 行）：
```ts
// 修改前
it.each(SAMPLES)('%s.docx 正则直接命中甲乙方（不调 LLM）', async (name) => {
    const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
    const { paragraphs } = await parseContractDocx(buf)
    const result = await detectParties(paragraphs)
    expect(result.partyA).not.toBeNull()
    expect(result.partyB).not.toBeNull()
    expect(result.source).toBe('regex')
    expect(invokeNodeJson).not.toHaveBeenCalled()
})

// 修改后
it.each(SAMPLES)('%s.docx 正则识别甲乙方 + LLM 推 contractType', async (name) => {
    vi.mocked(invokeNodeJson).mockResolvedValueOnce({
        partyA: null, partyB: null, contractType: '劳动合同',
    })
    const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
    const { paragraphs } = await parseContractDocx(buf)
    const result = await detectParties(paragraphs)
    expect(result.partyA).not.toBeNull()
    expect(result.partyB).not.toBeNull()
    expect(result.source).toBe('llm')
    expect(invokeNodeJson).toHaveBeenCalledTimes(1)
})
```

模式 2（命中率测试，第 30-39 行）：
```ts
// 修改后
it('5 份样本正则命中率 ≥ 80%（spec §12.1 硬要求；正则识别甲乙方算命中）', async () => {
    vi.mocked(invokeNodeJson).mockResolvedValue({
        partyA: null, partyB: null, contractType: '劳动合同',
    })
    let hit = 0
    for (const name of SAMPLES) {
        const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
        const { paragraphs } = await parseContractDocx(buf)
        const result = await detectParties(paragraphs)
        // source=llm 且 partyA/B 都识别到 = 正则命中（命中后被 LLM hint，仍走 llm 路径）
        if (result.source === 'llm' && result.partyA && result.partyB) hit++
    }
    expect(hit / SAMPLES.length).toBeGreaterThanOrEqual(0.8)
})
```

模式 3（括号 + 签章过滤测试，第 41-66 行）：

每个 it 块加 `vi.mocked(invokeNodeJson).mockResolvedValueOnce({...})` 头部、`expect(result.source).toBe('regex')` 改为 `expect(result.source).toBe('llm')`。

第 68-77 行"仅签章行 → 非 regex"测试保持 `expect(result.source).not.toBe('regex')`，加一行 `expect(result.source).not.toBe('llm') || expect(result.partyA).toBeNull()` 兜底（仅签章占位符时 LLM 会接管但识别不出甲乙方）。

- [ ] **Step 3: 跑测试验证 fail**

```bash
npx vitest run tests/server/assistant/contract/docx/partyDetector.test.ts --reporter=verbose
```

Expected: 多个测试 FAIL（partyDetector 还在短路，contractType 永远 null）。记录失败清单确认是预期 fail。

- [ ] **Step 4: 不 commit**（先把实现也改了再一起 commit）

> 测试失败状态先保留，下个 task 改实现让它们 pass。

---

## Task 3: 改 partyDetector 实现（删短路 + 注入 hint + logger 埋点）

**Files:**
- Modify: `server/agents/contract/docx/partyDetector.ts:44-74`

- [ ] **Step 1: 改实现**

Edit: `server/agents/contract/docx/partyDetector.ts:44-74`

```ts
import { logger } from '#shared/utils/logger' // 顶部加 import（如果尚未存在）

export async function detectParties(paragraphs: string[]): Promise<PartyDetectionResult> {
    const fullText = paragraphs.join('\n')

    const matchA = pickValidCandidate(fullText, PARTY_A_PATTERN)
    const matchB = pickValidCandidate(fullText, PARTY_B_PATTERN)

    // PRE-1 修复：删除"正则命中就 return"的短路逻辑。
    // 不论正则是否命中甲乙方，都调 LLM 推 contractType（playbook 依赖此字段非空）；
    // 正则结果作为 hint 透传给 LLM，LLM 可参考也可纠正（覆盖错识别）。
    try {
        const preview = fullText.slice(0, 1500)
        const result = await invokeNodeJson({
            nodeName: 'contractPartyDetect',
            temperature: 0,
            schema: llmResultSchema,
            buildPrompt: (template) => {
                const rendered = template.replace(
                    '{{contractTypeOptions}}',
                    CONTRACT_TYPE_OPTIONS.map(t => `- ${t}`).join('\n'),
                )
                const hintBlock = (matchA || matchB)
                    ? `\n\n## 正则提示\n甲方候选：${matchA ?? '未识别'}\n乙方候选：${matchB ?? '未识别'}`
                    : ''
                return `${rendered}${hintBlock}\n\n合同内容：\n${preview}`
            },
            errorPrefix: 'contractPartyDetect',
        })

        // 加 logger 埋点观察 regex/LLM 一致率（不污染 source 字面量 union）
        const regexHinted = !!(matchA && matchB)
        if (regexHinted) {
            logger.info('[contractPartyDetect] regex+llm', {
                regexHinted,
                regexPartyA: matchA, regexPartyB: matchB,
                llmPartyA: result.partyA, llmPartyB: result.partyB,
                contractType: result.contractType,
                consistent: result.partyA === matchA && result.partyB === matchB,
            })
        }

        return {
            // 优先 LLM 输出（可纠正正则误识别），LLM 不输出时回退到正则结果
            partyA: result.partyA ?? matchA ?? null,
            partyB: result.partyB ?? matchB ?? null,
            contractType: result.contractType ?? null,
            source: 'llm',
        }
    } catch (_err) {
        // LLM 失败：若正则识别到甲乙方，降级到原 regex 路径（向后兼容）
        if (matchA && matchB) {
            return { partyA: matchA, partyB: matchB, contractType: null, source: 'regex' }
        }
        return { partyA: null, partyB: null, contractType: null, source: 'none' }
    }
}
```

- [ ] **Step 2: 显式 import 检查**

按 `.claude/rules/main.md` "服务端自动导入" 规范，确认 partyDetector.ts 顶部 imports 完整：

```bash
head -15 server/agents/contract/docx/partyDetector.ts
```

Expected: 应包含
- `import { z } from 'zod'`
- `import { CONTRACT_TYPE_OPTIONS } from '#shared/types/contract'`
- `import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'`
- `import { logger } from '#shared/utils/logger'` ← **本 PR 新增，必须存在**

如果 logger 没 import，加上。

- [ ] **Step 3: 跑测试验证全部 PASS**

```bash
npx vitest run tests/server/assistant/contract/docx/partyDetector.test.ts --reporter=verbose
```

Expected: 全部 17+ 个测试 PASS（5 份样本 × 1 + 命中率 1 + 括号 1 + 签章 2 + 仅签章 1 + LLM fallback 6 + regex hint with llm 3）。

- [ ] **Step 4: typecheck 验证**

```bash
NODE_OPTIONS='--max-old-space-size=16384' bun x nuxi typecheck
```

Expected: exit 0，无 TS 错误。

- [ ] **Step 5: Commit（实现 + 测试一起）**

```bash
git add server/agents/contract/docx/partyDetector.ts tests/server/assistant/contract/docx/partyDetector.test.ts
git commit -m "fix(contract): partyDetector 删短路逻辑，让 contractType 真正识别

PRE-1 核心修复。partyDetector 之前在正则命中甲乙方时直接 return（contractType
写死 null），导致 playbook 在线上从未生效。改为不论正则是否命中都调 LLM
推 contractType；正则结果作为 hint 透传；LLM 失败时降级到原 regex 路径
保持向后兼容。

运维埋点：regex 命中且调 LLM 成功时 logger.info 落 regexHinted/consistent
字段，便于观察 regex/LLM 一致率（不污染 PartyDetectionResult.source
字面量 union）。

DB 现场（修复前最近 10 条审查）：partyA/B 全 ✓ 但 contractType 全空、
playbook_snapshot 全 null。修复后 contractType 由 LLM 在 41 个候选
类型中选一个，playbook 才能命中并参与 prompt。

测试同步：旧'regex path'测试断言改为 source='llm'（删 not.toHaveBeenCalled）；
新增 3 个 hint 注入路径测试覆盖 LLM 成功 / LLM 失败 / LLM 纠正正则。"
```

---

## Task 4: 集成验证（vitest 集成测试 + 浏览器 e2e）

**Files:**
- Create: `tests/integration/contract/partyDetectorSamples.test.ts`（用真实合同样本跑全链路验证 contractType 非空）

> 不用 `/tmp/test-pre1.ts` 临时脚本（违反 `.claude/rules/testing.md` "禁脚本式测试" 规范）；改用 vitest 集成测试 + 真实 LLM（仅在 `process.env.TEST_REAL_LLM=1` 时启用）。

- [ ] **Step 1: 新建集成测试文件**

Create: `tests/integration/contract/partyDetectorSamples.test.ts`

```ts
/**
 * partyDetector 真实 LLM 集成测试。
 *
 * 默认 skip。仅在 TEST_REAL_LLM=1 环境变量下启用，避免每次跑测试都调 LLM 烧 token。
 *
 * 跑法（PR 1 上线前手工验证）：
 *   TEST_REAL_LLM=1 npx vitest run tests/integration/contract/partyDetectorSamples.test.ts
 *
 * **Feature: contract-review-pre-1**
 * **Validates: spec §3.4 PR 1 验收**
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { detectParties } from '~~/server/agents/contract/docx/partyDetector'
import { parseContractDocx } from '~~/server/agents/contract/docx/parser'

const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const
const SAMPLE_DIR = join(__dirname, '../../../prisma/seeds/contract-samples')
const ENABLED = process.env.TEST_REAL_LLM === '1'

describe.skipIf(!ENABLED)('partyDetector 真实 LLM 集成（5 份合同样本）', () => {
    it.each(SAMPLES)('%s.docx → contractType 非空 + source=llm', async (name) => {
        const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
        const { paragraphs } = await parseContractDocx(buf)
        const result = await detectParties(paragraphs)
        expect(result.partyA).not.toBeNull()
        expect(result.partyB).not.toBeNull()
        expect(result.contractType).not.toBeNull() // PRE-1 验收关键：不再为 null
        expect(result.source).toBe('llm')
    })
})
```

- [ ] **Step 2: 跑集成测试（启用真实 LLM）**

```bash
TEST_REAL_LLM=1 npx vitest run tests/integration/contract/partyDetectorSamples.test.ts --reporter=verbose
```

Expected: 5 个测试全 PASS，每条肉眼观察 console 输出 `regexHinted=true` / `contractType=<具体类型>`。

如果某条 LLM 把合同识别成 "其他" 或某个非 41 候选的类型 → 调 prompt 加合同类型识别 example；不是 PR 1 范围（属于产品层数据完善）。

- [ ] **Step 3: 浏览器 e2e 验证（手工 + chrome-devtools MCP）**

启动 dev：
```bash
bun dev
```
等 `Server running on http://0.0.0.0:3000`，开 chrome-devtools MCP 或浏览器：
1. 打开 `http://localhost:3000/dashboard/assistant/contract`
2. 上传一份劳动合同（用 `prisma/seeds/contract-samples/labor.docx`）
3. 在选择立场弹框前等待 detect 完成（看 SSE 进度）
4. 选择立场后等审查完成

- [ ] **Step 4: SQL 验证 contractType + playbook_snapshot 落库**

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT id, contract_type, party_a, party_b, playbook_snapshot IS NOT NULL AS has_snapshot, jsonb_array_length(COALESCE(playbook_snapshot->'points', '[]'::jsonb)) AS point_count FROM contract_reviews ORDER BY id DESC LIMIT 1;"
```

Expected: 输出 `contract_type` 非空、`has_snapshot=t`、`point_count > 0`（劳动合同 playbook 有 7 条要点）。

如 `has_snapshot=f`：要么 LLM 把合同识别成 '其他'（看 contract_type 列），要么对应类型没启用 playbook 要点（DB 数据问题不属 PR 1）。

---

## Task 5: 杀 dev server + 完工

**Files:**
- 无

- [ ] **Step 1: 杀 dev server**

```bash
pkill -f "bun.*dev" || pkill -f "nuxt.*dev" || true
```

> 项目记忆：阶段任务结束后立即杀 dev server（CLAUDE.md feedback_kill_dev_on_finish）。

- [ ] **Step 2: 跑全量 partyDetector 测试 + 集成测试（不用 TEST_REAL_LLM=1，跳过真 LLM 集成）**

```bash
npx vitest run tests/server/assistant/contract/docx/partyDetector.test.ts tests/integration/contract/partyDetectorSamples.test.ts --reporter=verbose
```

Expected: 单测 17+ 全 PASS；集成测试 5 全 SKIP（因 `TEST_REAL_LLM` 未设）。

- [ ] **Step 3: 提交集成测试**

```bash
git add tests/integration/contract/partyDetectorSamples.test.ts
git commit -m "test(contract): 加 partyDetector 真实 LLM 集成测试

集成测试默认 skip（TEST_REAL_LLM=1 启用），用 5 份真实合同样本验证
contractType 真的识别非空、source='llm'。PR 1 上线前手工跑一次确认
playbook 真正生效；后续 CI 不跑（不烧 token）。"
```

- [ ] **Step 4: 准备 PR 描述**

```bash
git log --oneline -5
```

PR 描述模板：

```
## PRE-1：partyDetector 短路修复，恢复 playbook 在合同审查中真正生效

### 背景
线上 bug：合同审查最近 10 条记录全部 contract_type 为空、playbook_snapshot
全部 null。根因 partyDetector.ts:49-51 在正则命中甲乙方时直接 return，
contractType 写死 null，playbook 永远不参与 prompt。

### 修复
- 删除短路逻辑：不论正则是否命中甲乙方都调 LLM 推 contractType
- 正则结果作为 hint 透传给 LLM（contractPartyDetect_system prompt 末尾加段）
- LLM 失败时降级到原 regex 路径（向后兼容）
- 运维埋点：regexHinted / consistent 走 logger，不扩 source 字面量 union

### 验证
- [x] 单元测试：tests/server/assistant/contract/docx/partyDetector.test.ts 全 17+ 个 PASS
- [x] 集成测试（TEST_REAL_LLM=1）：5 份合同样本 contractType 全部非空
- [x] e2e：dashboard 上传一份合同，DB 写入 has_snapshot=t、point_count>0

### 关联
spec: docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md §3
plan: docs/superpowers/plans/2026-05-02-contract-review-pr1-party-detector-fix.md
```

- [ ] **Step 5: 完工**

PR 1 plan 完成。下一步：开始 PR 2（数据模型激进重构）的 plan 编写。

---

## 后续 PR 路线图（spec §11）

| PR | 内容 | 工作量 | 何时写 plan |
|---|---|---|---|
| **PR 1** | partyDetector 修复（本 plan） | 0.5 天 | ✓ 已写 |
| PR 2 | 数据模型激进重构（drop anchor_*；新增 9 字段） | 1.5 天 | PR 1 实施完成后 |
| PR 3 | 路线 2 实现（splitSentences + resolveQuoteAnchor + prompt 改造） | 2.5 天 | PR 2 完成后 |
| PR 4 | 前端风险卡 Layout A + C 切换 | 2 天 | PR 3 完成后 |
| PR 5 | DocxPreview 字符级高亮（CSS Custom Highlight API） | 1.5 天 | PR 3 完成后（可与 PR 4 并行） |
| PR 6 | Track Changes docx 导出（OOXML w:ins/w:del） | 3.5 天 | PR 5 完成后 |
| PR 7 | Phase B 锚点迁移升级（双锚点优先级） | 2 天 | PR 3 完成后 |

**发布顺序约束**（spec §11.2）：PR 2/3/4 必须同窗口发布；PR 1/7 独立；PR 5/6 各自独立。
