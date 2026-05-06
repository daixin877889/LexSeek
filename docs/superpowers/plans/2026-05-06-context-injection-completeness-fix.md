# 上下文注入完整性修订 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `buildContextSegments` 在测试环境暴露的"过滤过严" bug——已分析模块在 summary 为 NULL 时被整段跳过、案件材料只列 status=3；同时给 LLM 加上工具查询条件提示和模块版本/秒级时间。

**Architecture:** 仅改 2 个文件（`moduleContextBuilder.ts` + `materialPipeline.service.ts`）。`getMaterialListWithSummariesService` 去 status 过滤 + 扩展返回字段；`buildContextSegments` moduleSummaries 段去硬过滤 + summary 缺失降级 result 截断 + 加版本时间；materials 段加 sourceId + 状态文字 + 段头工具参数提示。不改架构、不动中间件、不动 Agent 配置。

**Tech Stack:** TypeScript / Prisma / Vitest / dayjs（新增到 moduleContextBuilder.ts import）

**Spec 引用：** [docs/superpowers/specs/2026-05-06-context-injection-completeness-fix-design.md](../specs/2026-05-06-context-injection-completeness-fix-design.md)

---

## 文件结构

### 修改

| 文件 | 改动 |
|---|---|
| `server/services/material/materialPipeline.service.ts` | `getMaterialListWithSummariesService` 去 status=3 过滤 + 返回字段加 `status` / `ossFileId` |
| `server/services/agent-platform/context/moduleContextBuilder.ts` | 顶部加 `import dayjs` + `import { CaseMaterialType }` + 常量 `TYPE_LABEL_MAP` / `STATUS_LABEL_MAP` / `renderMaterialSummary`；caseAnalyses select 扩展 `version` / `updatedAt` / `analysisResult`；moduleSummaries 段去硬过滤 + summary 缺失降级；materials 段加 sourceId + 状态文字 + 段头查询条件 |

### 新增/更新测试

| 文件 | 改动 |
|---|---|
| `tests/server/agent-platform/context/moduleContextBuilder.test.ts`（如不存在则新建） | 8 条新单测：模块 summary 缺失降级 / 模块全空兜底 / 版本时间格式 / 模块段头查询条件 / 材料段头查询条件 / 材料 status=1/2/4 也展示 / 材料行 sourceId 计算 / 材料行 ossFileId=null fallback |
| `tests/server/services/material/materialPipeline.service.test.ts`（如不存在则新建对应测试） | 2 条单测：返回所有未删除材料（含 status=1/2/4）+ 含 status / ossFileId 字段 |
| `tests/server/agent-platform/caseContextSync.integration.test.ts` | 追加 1 个集成 case：混合 status 材料 + summary 缺失模块场景 |

无新增源文件 / 无删除文件 / 无 schema 变更 / 无数据级变更。

---

## Task 1：扩展 `getMaterialListWithSummariesService`

**Files:**
- Modify: `server/services/material/materialPipeline.service.ts:805-816`
- Test: `tests/server/services/material/materialPipeline.service.test.ts`（如不存在新建）

- [ ] **Step 1: 检查现有测试文件并新建/补充测试**

Run:
```bash
find /Users/daixin/work/dev/LexSeek/LexSeek/tests -name "materialPipeline*test*" 2>/dev/null
```

如显示已有测试文件，在该文件中追加用例；如无，新建 `tests/server/services/material/materialPipeline.service.test.ts` 含完整 imports：

```ts
// tests/server/services/material/materialPipeline.service.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { getMaterialListWithSummariesService } from '~~/server/services/material/materialPipeline.service'

const cleanup = { caseIds: [] as number[], materialIds: [] as number[] }

afterEach(async () => {
    if (cleanup.materialIds.length) {
        await prisma.caseMaterials.deleteMany({ where: { id: { in: cleanup.materialIds } } })
        cleanup.materialIds = []
    }
    if (cleanup.caseIds.length) {
        await prisma.cases.deleteMany({ where: { id: { in: cleanup.caseIds } } })
        cleanup.caseIds = []
    }
})

async function seedCase(): Promise<number> {
    const c = await prisma.cases.create({
        data: {
            userId: 1,
            caseTypeId: 1,
            title: 'mp-test-case',
            status: 1,
            sessionId: `mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
    })
    cleanup.caseIds.push(c.id)
    return c.id
}

async function seedMaterial(caseId: number, fields: { name: string; type: number; status: number; ossFileId?: number | null; summary?: string | null }) {
    const m = await prisma.caseMaterials.create({
        data: {
            caseId,
            name: fields.name,
            type: fields.type,
            status: fields.status,
            ossFileId: fields.ossFileId ?? null,
            summary: fields.summary ?? null,
        },
    })
    cleanup.materialIds.push(m.id)
    return m
}

describe('getMaterialListWithSummariesService', () => {
    it('返回所有未删除材料（含 status=1/2/4，不再仅过滤 status=3）', async () => {
        const caseId = await seedCase()
        await seedMaterial(caseId, { name: '已识别材料', type: 1, status: 3, summary: 'a' })
        await seedMaterial(caseId, { name: '识别中材料', type: 2, status: 2, ossFileId: 1001 })
        await seedMaterial(caseId, { name: '待识别材料', type: 3, status: 1, ossFileId: 1002 })
        await seedMaterial(caseId, { name: '识别失败材料', type: 4, status: 4, ossFileId: 1003 })

        const list = await getMaterialListWithSummariesService(caseId)
        const names = list.map(m => m.name).sort()
        expect(names).toEqual(['已识别材料', '识别中材料', '识别失败材料', '待识别材料'])
    })

    it('返回字段含 status 与 ossFileId', async () => {
        const caseId = await seedCase()
        await seedMaterial(caseId, { name: '文档材料', type: 2, status: 3, ossFileId: 2001, summary: 's' })

        const list = await getMaterialListWithSummariesService(caseId)
        expect(list[0]).toMatchObject({
            name: '文档材料',
            type: 2,
            status: 3,
            ossFileId: 2001,
            summary: 's',
        })
    })
})
```

- [ ] **Step 2: 跑测试确认 RED**

Run:
```bash
npx vitest run tests/server/services/material/materialPipeline.service.test.ts --reporter=verbose
```
Expected: 第 1 条 FAIL（当前实现仅返 status=3，names 数组只有 '已识别材料'）；第 2 条 FAIL（当前 select 不含 status / ossFileId 字段）

- [ ] **Step 3: 修改 `getMaterialListWithSummariesService` 实现**

打开 `server/services/material/materialPipeline.service.ts`，找到第 800-816 行 `getMaterialListWithSummariesService` 函数，整体替换为：

```ts
/**
 * 返回案件全量未删除材料 + 摘要 + 状态（供 moduleContextBuilder ⑤ 段使用）
 *
 * 不再过滤 status=3——把 status=1/2/4 的材料也列出，由调用方按 status 渲染状态文字
 * （已识别 / 识别中 / 待识别 / 识别失败），让 LLM 知情更全。
 *
 * 全文请通过 search_case_materials 工具按需召回；本接口仅返回元信息 + 摘要。
 */
export async function getMaterialListWithSummariesService(caseId: number): Promise<Array<{
    id: number
    name: string
    type: number
    status: number
    ossFileId: number | null
    summary: string | null
}>> {
    return prisma.caseMaterials.findMany({
        where: { caseId, deletedAt: null },
        select: { id: true, name: true, type: true, status: true, ossFileId: true, summary: true },
        orderBy: { createdAt: 'asc' },
    })
}
```

- [ ] **Step 4: 跑测试确认 GREEN**

Run:
```bash
npx vitest run tests/server/services/material/materialPipeline.service.test.ts --reporter=verbose
```
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/material/materialPipeline.service.ts \
        tests/server/services/material/materialPipeline.service.test.ts
git commit -m "$(cat <<'EOF'
refactor(material): getMaterialListWithSummariesService 列全量未删材料

- 移除 status=3 过滤，status=1/2/4 也返回
- select 加 status / ossFileId 字段
- 让 LLM 知情更全：识别中 / 待识别 / 识别失败的材料都能进上下文

调用方 buildContextSegments（Task 2/3）按 status 渲染状态文字 +
按 type/ossFileId 计算 sourceId 给到 LLM。
EOF
)"
```

---

## Task 2：`buildContextSegments` moduleSummaries 段重写

**Files:**
- Modify: `server/services/agent-platform/context/moduleContextBuilder.ts`
- Test: `tests/server/agent-platform/context/moduleContextBuilder.test.ts`（如不存在新建）

- [ ] **Step 1: 检查现有测试**

Run:
```bash
find /Users/daixin/work/dev/LexSeek/LexSeek/tests -name "moduleContextBuilder*test*" 2>/dev/null
```

记录路径供后续步骤使用。如无，按 Step 2 新建。

- [ ] **Step 2: 写本任务相关单测**

如已有测试文件，在末尾追加 `describe('buildContextSegments - 模块段', ...)`。如无，新建 `tests/server/agent-platform/context/moduleContextBuilder.test.ts` 含完整 imports + fixture，本次只填模块相关 4 条用例（材料相关用例放 Task 3）：

```ts
// tests/server/agent-platform/context/moduleContextBuilder.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { buildContextSegments } from '~~/server/services/agent-platform/context/moduleContextBuilder'

const cleanup = { caseIds: [] as number[], analysisIds: [] as number[], materialIds: [] as number[] }

afterEach(async () => {
    if (cleanup.materialIds.length) {
        await prisma.caseMaterials.deleteMany({ where: { id: { in: cleanup.materialIds } } })
        cleanup.materialIds = []
    }
    if (cleanup.analysisIds.length) {
        await prisma.caseAnalyses.deleteMany({ where: { id: { in: cleanup.analysisIds } } })
        cleanup.analysisIds = []
    }
    if (cleanup.caseIds.length) {
        await prisma.cases.deleteMany({ where: { id: { in: cleanup.caseIds } } })
        cleanup.caseIds = []
    }
})

async function seedCase(): Promise<number> {
    const c = await prisma.cases.create({
        data: {
            userId: 1,
            caseTypeId: 1,
            title: 'ctx-test-case',
            status: 1,
            sessionId: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
    })
    cleanup.caseIds.push(c.id)
    return c.id
}

async function seedAnalysis(caseId: number, fields: { analysisType: string; version: number; summary?: string | null; analysisResult?: string | null; updatedAt?: Date }) {
    const a = await prisma.caseAnalyses.create({
        data: {
            caseId,
            sessionId: `ana-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            nodeId: 6,
            analysisType: fields.analysisType,
            analysisResult: fields.analysisResult ?? null,
            summary: fields.summary ?? null,
            version: fields.version,
            status: 2,
            isActive: true,
            updatedAt: fields.updatedAt ?? new Date('2026-05-04T14:32:18Z'),
        },
    })
    cleanup.analysisIds.push(a.id)
    return a
}

describe('buildContextSegments - 模块段', () => {
    it('summary 非空：直接显示 summary 摘要', async () => {
        const caseId = await seedCase()
        await seedAnalysis(caseId, {
            analysisType: 'case_summary',
            version: 2,
            summary: '案件核心要点摘要 200 字',
            updatedAt: new Date('2026-05-04T14:32:18Z'),
        })

        const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

        expect(segs.moduleSummaries).toContain('### case_summary（v2，更新于 2026-05-04')
        expect(segs.moduleSummaries).toContain('案件核心要点摘要 200 字')
        expect(segs.moduleSummaries).not.toContain('（暂无独立摘要')
    })

    it('summary 缺失但 analysisResult 非空：降级用 result 前 500 字 + 标识"（暂无独立摘要，正文节选）"', async () => {
        const caseId = await seedCase()
        const longResult = '这是一段很长的正文'.repeat(100) // 远超 500 字
        await seedAnalysis(caseId, {
            analysisType: 'chronicle',
            version: 1,
            summary: null,
            analysisResult: longResult,
        })

        const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

        expect(segs.moduleSummaries).toContain('### chronicle（v1，更新于 2026-05-04')
        expect(segs.moduleSummaries).toContain('（暂无独立摘要，正文节选）')
        expect(segs.moduleSummaries).toContain('...')  // 截断标识
        // 截断到 500 字 + "..."
        const idx = segs.moduleSummaries.indexOf('（暂无独立摘要，正文节选）\n')
        const tail = segs.moduleSummaries.slice(idx + '（暂无独立摘要，正文节选）\n'.length)
        const excerptOnly = tail.split('\n\n')[0]?.replace(/\.\.\.$/, '') ?? ''
        expect(excerptOnly.length).toBeLessThanOrEqual(500)
    })

    it('summary 与 analysisResult 都为 null：输出"（暂无内容）"', async () => {
        const caseId = await seedCase()
        await seedAnalysis(caseId, {
            analysisType: 'cause',
            version: 1,
            summary: null,
            analysisResult: null,
        })

        const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

        expect(segs.moduleSummaries).toContain('### cause（v1，更新于')
        expect(segs.moduleSummaries).toContain('（暂无内容）')
    })

    it('段头含 search_case_analysis 工具的 analysis_type 参数提示', async () => {
        const caseId = await seedCase()
        await seedAnalysis(caseId, { analysisType: 'evidence', version: 1, summary: 'x' })

        const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

        expect(segs.moduleSummaries).toContain('search_case_analysis 工具')
        expect(segs.moduleSummaries).toContain('analysis_type 填模块名')
    })
})
```

- [ ] **Step 3: 跑测试确认 RED**

Run:
```bash
npx vitest run tests/server/agent-platform/context/moduleContextBuilder.test.ts --reporter=verbose
```
Expected: 全部 4 条 FAIL（当前实现 summary 缺失整条跳过、段头无 analysis_type 提示、无版本时间格式）

- [ ] **Step 4: 修改 `moduleContextBuilder.ts` 顶部 imports + caseAnalyses select**

打开 `server/services/agent-platform/context/moduleContextBuilder.ts`，第 1-5 行 imports 之后追加：

```ts
import dayjs from 'dayjs'
```

找到约第 62-66 行的 `prisma.caseAnalyses.findMany` 调用，把 select 字段扩展：

```ts
prisma.caseAnalyses.findMany({
  where: { caseId, isActive: true, deletedAt: null, NOT: { analysisType: agentName } },
  select: {
    analysisType: true,
    summary: true,
    version: true,        // 新增
    updatedAt: true,      // 新增
    analysisResult: true, // 新增（summary 缺失时降级用）
  },
  orderBy: { analysisType: 'asc' },
}),
```

- [ ] **Step 5: 重写 moduleSummaries 段（约第 95-104 行）**

替换原 `// ④ 已完成模块摘要` 整段（包括开头注释和末尾 `moduleSummaries = lines.length > 1 ? ...`）为：

```ts
  // ④ 已分析模块（当前激活版本）
  // - 不再因 summary 缺失整条跳过；summary 为 null 时降级用 analysisResult 前 500 字 + 标识
  // - 段头加 search_case_analysis 工具查询条件提示，让 LLM 知道工具参数怎么填
  let moduleSummaries = ''
  if (activeAnalyses.length > 0) {
    const lines = ['## 已分析模块（当前激活版本，全文请调用 search_case_analysis 工具，参数 analysis_type 填模块名 + query 填问题关键词）']
    for (const a of activeAnalyses) {
      const updatedAtStr = a.updatedAt
        ? dayjs(a.updatedAt).format('YYYY-MM-DD HH:mm:ss')
        : '未知时间'
      const header = `### ${a.analysisType}（v${a.version}，更新于 ${updatedAtStr}）`

      if (a.summary) {
        lines.push(`${header}\n${a.summary}`)
      }
      else if (a.analysisResult) {
        const excerpt = a.analysisResult.slice(0, 500)
        const tail = a.analysisResult.length > 500 ? '...' : ''
        lines.push(`${header}\n（暂无独立摘要，正文节选）\n${excerpt}${tail}`)
      }
      else {
        lines.push(`${header}\n（暂无内容）`)
      }
    }
    moduleSummaries = lines.length > 1 ? lines.join('\n\n') : ''
  }
```

- [ ] **Step 6: 跑测试确认 GREEN**

Run:
```bash
npx vitest run tests/server/agent-platform/context/moduleContextBuilder.test.ts --reporter=verbose
```
Expected: 全部 4 条 PASS

- [ ] **Step 7: Commit**

```bash
git add server/services/agent-platform/context/moduleContextBuilder.ts \
        tests/server/agent-platform/context/moduleContextBuilder.test.ts
git commit -m "$(cat <<'EOF'
feat(agent-platform): buildContextSegments 模块段去硬过滤 + 加版本/时间/查询条件

- 移除 'if (!a.summary) continue' 硬过滤，summary 为 null 时降级用
  analysisResult 前 500 字 + '（暂无独立摘要，正文节选）' 标识
- 段头每行加版本号 + 精确到秒的更新时间
- 段头加 search_case_analysis 工具的 analysis_type 参数提示
- caseAnalyses select 扩展 version / updatedAt / analysisResult 字段

修复测试环境中"7 个模块都 active 但 summary 全 null 导致整段消失"的 bug。
EOF
)"
```

---

## Task 3：`buildContextSegments` materials 段重写

**Files:**
- Modify: `server/services/agent-platform/context/moduleContextBuilder.ts`
- Test: `tests/server/agent-platform/context/moduleContextBuilder.test.ts`

- [ ] **Step 1: 在测试文件末尾追加材料段单测**

在 `tests/server/agent-platform/context/moduleContextBuilder.test.ts` 末尾追加：

```ts
async function seedMaterial(caseId: number, fields: { name: string; type: number; status: number; ossFileId?: number | null; summary?: string | null }) {
    const m = await prisma.caseMaterials.create({
        data: {
            caseId,
            name: fields.name,
            type: fields.type,
            status: fields.status,
            ossFileId: fields.ossFileId ?? null,
            summary: fields.summary ?? null,
        },
    })
    cleanup.materialIds.push(m.id)
    return m
}

describe('buildContextSegments - 材料段', () => {
    it('段头含 search_case_materials 工具的 sourceId / query 参数提示', async () => {
        const caseId = await seedCase()
        await seedMaterial(caseId, { name: 'm1', type: 1, status: 3, summary: 's' })

        const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

        expect(segs.dynamicContext).toContain('search_case_materials 工具')
        expect(segs.dynamicContext).toContain('sourceId 填下面括号中的值')
        expect(segs.dynamicContext).toContain('query 填关键词跨材料搜索')
    })

    it('status=1/2/4 也展示在材料清单中（不再被过滤）', async () => {
        const caseId = await seedCase()
        await seedMaterial(caseId, { name: '已识别', type: 1, status: 3, summary: 'a' })
        await seedMaterial(caseId, { name: '识别中', type: 2, status: 2, ossFileId: 9001 })
        await seedMaterial(caseId, { name: '待识别', type: 3, status: 1, ossFileId: 9002 })
        await seedMaterial(caseId, { name: '识别失败', type: 4, status: 4, ossFileId: 9003 })

        const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

        expect(segs.dynamicContext).toContain('**已识别**')
        expect(segs.dynamicContext).toContain('**识别中**')
        expect(segs.dynamicContext).toContain('**待识别**')
        expect(segs.dynamicContext).toContain('**识别失败**')
        expect(segs.dynamicContext).toContain('— 已识别 — ')
        expect(segs.dynamicContext).toContain('— 识别中 — ')
        expect(segs.dynamicContext).toContain('— 待识别 — ')
        expect(segs.dynamicContext).toContain('— 识别失败 — ')
    })

    it('type=1（文本）：sourceId 用 material.id', async () => {
        const caseId = await seedCase()
        const mat = await seedMaterial(caseId, { name: '文本材料', type: 1, status: 3, summary: 's' })

        const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

        expect(segs.dynamicContext).toContain(`sourceId=${mat.id}`)
    })

    it('type=2/3/4：sourceId 用 ossFileId', async () => {
        const caseId = await seedCase()
        await seedMaterial(caseId, { name: '文档', type: 2, status: 3, ossFileId: 7001, summary: 'a' })
        await seedMaterial(caseId, { name: '图片', type: 3, status: 3, ossFileId: 7002, summary: 'b' })
        await seedMaterial(caseId, { name: '音频', type: 4, status: 3, ossFileId: 7003, summary: 'c' })

        const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

        expect(segs.dynamicContext).toContain('sourceId=7001')
        expect(segs.dynamicContext).toContain('sourceId=7002')
        expect(segs.dynamicContext).toContain('sourceId=7003')
    })

    it('材料 ossFileId 为 null（异常数据）：sourceId 标"未生成"', async () => {
        const caseId = await seedCase()
        await seedMaterial(caseId, { name: '损坏数据', type: 2, status: 4, ossFileId: null })

        const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

        expect(segs.dynamicContext).toContain('sourceId=未生成')
    })

    it('summary 缺失时按 status 降级文字：3=摘要生成中 / 2=识别中提示 / 1=待识别提示 / 4=识别失败提示', async () => {
        const caseId = await seedCase()
        await seedMaterial(caseId, { name: 'st3', type: 1, status: 3, summary: null })
        await seedMaterial(caseId, { name: 'st2', type: 2, status: 2, ossFileId: 8001 })
        await seedMaterial(caseId, { name: 'st1', type: 2, status: 1, ossFileId: 8002 })
        await seedMaterial(caseId, { name: 'st4', type: 2, status: 4, ossFileId: 8003 })

        const segs = await buildContextSegments({ caseId, agentName: 'caseMain', userQuery: '' })

        expect(segs.dynamicContext).toContain('（摘要生成中）')
        expect(segs.dynamicContext).toContain('（识别中，待识别完成后可查全文）')
        expect(segs.dynamicContext).toContain('（待识别，上传中或排队中）')
        expect(segs.dynamicContext).toContain('（识别失败，可联系客服重新处理）')
    })
})
```

- [ ] **Step 2: 跑测试确认 RED**

Run:
```bash
npx vitest run tests/server/agent-platform/context/moduleContextBuilder.test.ts --reporter=verbose
```
Expected: 6 条新测试 FAIL（当前段头无 sourceId 提示、status=1/2/4 不展示、无 sourceId 字段）

- [ ] **Step 3: 在 `moduleContextBuilder.ts` 顶部 imports 后追加常量与 helper**

打开 `server/services/agent-platform/context/moduleContextBuilder.ts`，在 imports 段之后（约第 7 行，紧贴 `import dayjs from 'dayjs'` 之后）追加：

```ts
import { CaseMaterialType } from '#shared/types/case'

const TYPE_LABEL_MAP = { 1: '文本', 2: '文档', 3: '图片', 4: '音频' } as const

const STATUS_LABEL_MAP = {
  1: '待识别',
  2: '识别中',
  3: '已识别',
  4: '识别失败',
} as const

/**
 * 按材料 status 与 summary 渲染材料行尾的描述文字。
 * - status=3 + summary 非空：直接返回 summary
 * - status=3 + summary 空：返回"（摘要生成中）"
 * - status=2/1/4：返回对应状态提示，告诉 LLM 暂不可查全文
 */
function renderMaterialSummary(status: number, summary: string | null): string {
  if (summary) return summary
  switch (status) {
    case 3: return '（摘要生成中）'
    case 2: return '（识别中，待识别完成后可查全文）'
    case 1: return '（待识别，上传中或排队中）'
    case 4: return '（识别失败，可联系客服重新处理）'
    default: return '（暂无内容）'
  }
}
```

- [ ] **Step 4: 重写 materials 段（约第 112-118 行 `if (materials.length > 0)` 整段）**

找到原 `if (materials.length > 0)` 块，整体替换为：

```ts
  if (materials.length > 0) {
    dynLines.push('\n## 案件材料清单（全文请调用 search_case_materials 工具，参数 sourceId 填下面括号中的值精确取该材料；或参数 query 填关键词跨材料搜索）')
    for (const mat of materials) {
      const typeLabel = TYPE_LABEL_MAP[mat.type as 1|2|3|4] ?? '其它'
      const statusLabel = STATUS_LABEL_MAP[mat.status as 1|2|3|4] ?? '未知状态'
      // sourceId 计算：type=1 用 material.id；type=2/3/4 用 ossFileId（与 getSourceId 等价）
      const sourceId = mat.type === CaseMaterialType.CASE_CONTENT ? mat.id : mat.ossFileId
      const summaryText = renderMaterialSummary(mat.status, mat.summary)
      dynLines.push(`- **${mat.name}**（${typeLabel}，sourceId=${sourceId ?? '未生成'}）— ${statusLabel} — ${summaryText}`)
    }
  }
```

- [ ] **Step 5: 跑测试确认 GREEN**

Run:
```bash
npx vitest run tests/server/agent-platform/context/moduleContextBuilder.test.ts --reporter=verbose
```
Expected: 全部 10 条（Task 2 的 4 条 + Task 3 的 6 条）PASS

- [ ] **Step 6: 跑覆盖率确认 ≥ 90%**

Run:
```bash
npx vitest run tests/server/agent-platform/context/moduleContextBuilder.test.ts \
  --coverage \
  --coverage.include='server/services/agent-platform/context/moduleContextBuilder.ts' \
  2>&1 | tail -20
```
Expected: 该文件 statements / branches / functions / lines 均 ≥ 90%

- [ ] **Step 7: Commit**

```bash
git add server/services/agent-platform/context/moduleContextBuilder.ts \
        tests/server/agent-platform/context/moduleContextBuilder.test.ts
git commit -m "$(cat <<'EOF'
feat(agent-platform): buildContextSegments 材料段加 sourceId / 状态文字 / 查询条件

- 段头加 search_case_materials 工具的 sourceId / query 参数提示
- 每行加 sourceId（type=1 用 material.id；type=2/3/4 用 ossFileId）
- 每行加状态文字（已识别 / 识别中 / 待识别 / 识别失败）
- summary 缺失时按 status 降级提示，让 LLM 知道何时无法查全文
- ossFileId 为 null（异常数据）时 sourceId 标"未生成"

新增 STATUS_LABEL_MAP / TYPE_LABEL_MAP / renderMaterialSummary helper
+ CaseMaterialType import；不复用 getSourceId 避免类型签名涉及 N+1 查询。
EOF
)"
```

---

## Task 4：补 caseContextSync 集成测试新场景

**Files:**
- Modify: `tests/server/agent-platform/caseContextSync.integration.test.ts`

- [ ] **Step 1: 检查现有集成测试结构**

Run:
```bash
sed -n '1,40p' /Users/daixin/work/dev/LexSeek/LexSeek/tests/server/agent-platform/caseContextSync.integration.test.ts
```
确认 `cleanup` / `seedCaseFixture` / `afterEach` 工具仍在文件顶部（来自上轮 plan Task 12 已落地的代码）。

- [ ] **Step 2: 先按 Step 3 把 `createdIds.materials/analyses` 字段与 afterEach 清理逻辑落到位，然后在 describe 块末尾追加新 case**

> 注：Step 2 的测试代码 push 进 `createdIds.materials` / `createdIds.analyses` 数组，前提是这两个字段已在 describe 顶部初始化为 `[]`（Step 3 处理）。先做 Step 3 再回来粘贴 Step 2 代码。

在该测试文件 describe 块末尾（最后一个 `it` 之后、describe 闭合 `})` 之前）追加：

```ts
    it('混合 status + summary 缺失场景：注入消息含所有 4 种材料状态 + 模块降级显示 result 截断', async () => {
        const { caseId } = await seedCaseFixture()

        // 4 种 status 的材料
        const m1 = await prisma.caseMaterials.create({ data: { caseId, name: '已识别材料', type: 1, status: 3, summary: 'sum' } })
        const m2 = await prisma.caseMaterials.create({ data: { caseId, name: '识别中材料', type: 2, status: 2, ossFileId: 50001 } })
        const m3 = await prisma.caseMaterials.create({ data: { caseId, name: '待识别材料', type: 3, status: 1, ossFileId: 50002 } })
        const m4 = await prisma.caseMaterials.create({ data: { caseId, name: '识别失败材料', type: 4, status: 4, ossFileId: 50003 } })
        createdIds.materials.push(m1.id, m2.id, m3.id, m4.id)

        // 一个 summary 非空 + 一个 summary 缺失但 result 非空
        const a1 = await prisma.caseAnalyses.create({
            data: { caseId, sessionId: `it-ana-${Date.now()}-1`, nodeId: 6, analysisType: 'case_summary', version: 1, status: 2, isActive: true, summary: '案件摘要内容', analysisResult: '完整正文 1' },
        })
        const a2 = await prisma.caseAnalyses.create({
            data: { caseId, sessionId: `it-ana-${Date.now()}-2`, nodeId: 7, analysisType: 'chronicle', version: 1, status: 2, isActive: true, summary: null, analysisResult: '大事记完整正文'.repeat(50) },
        })
        createdIds.analyses.push(a1.id, a2.id)

        const mw = caseContextSyncMiddleware({ caseId, agentName: 'caseMain' })
        const state = { messages: [new HumanMessage('总结一下案件')] }
        await mw.beforeAgent.hook(state)

        const ctx = state.messages[0]
        const content = String(ctx.content ?? '')

        // 4 种状态文字都在
        expect(content).toContain('— 已识别 —')
        expect(content).toContain('— 识别中 —')
        expect(content).toContain('— 待识别 —')
        expect(content).toContain('— 识别失败 —')

        // 段头查询条件
        expect(content).toContain('参数 analysis_type 填模块名')
        expect(content).toContain('参数 sourceId 填下面括号中的值')

        // summary 非空模块直接显示
        expect(content).toContain('案件摘要内容')

        // summary 缺失模块走降级
        expect(content).toContain('（暂无独立摘要，正文节选）')
        expect(content).toContain('### chronicle（v1，更新于')
    })
```

> ⚠️ 上述 `createdIds.materials` / `createdIds.analyses` 数组键如果当前 cleanup 块未声明，需要在 describe 顶部 `cleanup`/`createdIds` 对象初始化处加上 `materials: [] as number[]` 与 `analyses: [] as number[]`，并在 `afterEach` 中按 caseAnalyses → caseMaterials → cases 反向 `deleteMany` 清理。

- [ ] **Step 3: 检查并补全 createdIds 字段与 afterEach 清理逻辑**

打开 `tests/server/agent-platform/caseContextSync.integration.test.ts`，找到顶部 `const createdIds = ...` 声明，确保含 `materials: [] as number[]` 与 `analyses: [] as number[]` 字段。如缺失则追加：

```ts
const createdIds = {
    cases: [] as number[],
    drafts: [] as number[],
    materials: [] as number[],
    analyses: [] as number[],
}
```

找到 `afterEach(async () => { ... })`，在原 drafts/cases 清理之前补上 analyses / materials 反向清理（叶表先删，按 caseAnalyses → caseMaterials → drafts → cases 顺序）：

```ts
afterEach(async () => {
    if (createdIds.analyses.length) {
        await prisma.caseAnalyses.deleteMany({ where: { id: { in: createdIds.analyses } } })
        createdIds.analyses = []
    }
    if (createdIds.materials.length) {
        await prisma.caseMaterials.deleteMany({ where: { id: { in: createdIds.materials } } })
        createdIds.materials = []
    }
    // ... 原有 drafts / cases 清理保留
    if (createdIds.drafts.length) {
        await prisma.documentDrafts.deleteMany({ where: { id: { in: createdIds.drafts } } })
        createdIds.drafts = []
    }
    if (createdIds.cases.length) {
        await prisma.cases.deleteMany({ where: { id: { in: createdIds.cases } } })
        createdIds.cases = []
    }
})
```

- [ ] **Step 4: 跑集成测试确认通过**

Run:
```bash
npx vitest run tests/server/agent-platform/caseContextSync.integration.test.ts --reporter=verbose
```
Expected: 全部 PASS（含本任务新加的 case）

- [ ] **Step 5: Commit**

```bash
git add tests/server/agent-platform/caseContextSync.integration.test.ts
git commit -m "$(cat <<'EOF'
test(agent-platform): caseContextSync 补混合 status / summary 缺失场景集成测试

新增端到端 case：4 种 status 材料 + summary 非空与缺失两类模块同时存在 →
注入消息内容包含 4 种状态文字、模块版本/秒级时间、降级 result 截断、
工具查询条件提示。

createdIds 对象同步加 materials / analyses 字段；afterEach 按 caseAnalyses
→ caseMaterials → drafts → cases 反向清理，符合 testing.md 终极规则。
EOF
)"
```

---

## Task 5：typecheck + 端到端验证 + push

**Files:**
- 全项目验证

- [ ] **Step 1: 全项目 typecheck**

Run:
```bash
npx nuxi typecheck 2>&1 | tail -30
```
Expected: 无 `moduleContextBuilder.ts` / `materialPipeline.service.ts` / 测试文件相关错误。

- [ ] **Step 2: 跑改造涉及的所有测试回归**

Run:
```bash
npx vitest run \
  tests/server/services/material/materialPipeline.service.test.ts \
  tests/server/agent-platform/context/moduleContextBuilder.test.ts \
  tests/server/agent-platform/caseContextSync.integration.test.ts \
  tests/server/agents/_shared/case-context/caseContextSync.middleware.test.ts \
  --reporter=verbose
```
Expected: 全部 PASS。

- [ ] **Step 3: 启动 dev server**

Run:
```bash
bun dev > /tmp/lexseek-dev.log 2>&1 &
DEV_PID=$!
echo "DEV_PID=$DEV_PID"
sleep 12
curl -s -o /dev/null -w "HTTP=%{http_code}\n" http://localhost:3000/ || echo "not ready (3001 fallback if user dev running)"
```
Expected: HTTP=200（如端口冲突跑到 3001 也行，端到端用户的 :3000 即可，但 build 验证靠这个）。

- [ ] **Step 4: 端到端：dev 库 case 1056 跑一轮 chat，验证注入消息含两段并且格式正确**

在浏览器（已登录态）DevTools Console 执行（替换 sessionId 为 case 1056 的现有小索 session，可通过 `/api/v1/cases/analysis/xiaosuo-sessions?caseId=1056` 查）：

```js
const sessionId = '<现有小索 sessionId>'
const resp = await fetch('/api/v1/cases/analysis/chat', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    config: { configurable: { thread_id: sessionId } },
    input: { messages: [{ type: 'human', content: '案件总结' }], thinking: false },
  }),
})
console.log('chat status', resp.status)
// 等流跑完即可
```

然后查 checkpoint 注入消息内容：

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "
SELECT
  position('CaseContextSyncMiddleware' IN convert_from(blob, 'UTF8')) > 0 AS has_sync,
  position('## 已分析模块（当前激活版本' IN convert_from(blob, 'UTF8')) > 0 AS has_modules_section,
  position('## 案件材料清单（全文请调用 search_case_materials 工具，参数 sourceId' IN convert_from(blob, 'UTF8')) > 0 AS has_materials_section,
  position('analysis_type 填模块名' IN convert_from(blob, 'UTF8')) > 0 AS has_module_query_hint,
  position('sourceId 填下面括号中的值' IN convert_from(blob, 'UTF8')) > 0 AS has_material_query_hint,
  position('— 已识别 — ' IN convert_from(blob, 'UTF8')) > 0 AS has_status_text
FROM langgraph.checkpoint_blobs
WHERE thread_id = '<同上 sessionId>' AND channel = 'messages'
ORDER BY version::int DESC LIMIT 1;
"
```

Expected: 全部 6 列为 `t`。如某列 `f`，定位代码或测试断言修复后 commit。

- [ ] **Step 5: 关 dev server**

Run:
```bash
kill -9 $DEV_PID 2>/dev/null
sleep 1
lsof -ti:3001 2>/dev/null | xargs -r kill -9
echo "dev server stopped"
```

- [ ] **Step 6: 推到远程**

Run:
```bash
git status
echo "---ahead/behind---"
git rev-list --left-right --count @{upstream}...HEAD
echo "---last 5 commits---"
git log --oneline -5
echo "---pushing---"
git push origin dev 2>&1
```
Expected: push 成功，本地与 origin/dev 同步（ahead/behind = 0/0）。

- [ ] **Step 7: 提交 spec + plan 文档（如未提交）**

Run:
```bash
git status --short docs/superpowers/
```
如 spec / plan 文件还是 untracked：
```bash
git add docs/superpowers/specs/2026-05-06-context-injection-completeness-fix-design.md \
        docs/superpowers/plans/2026-05-06-context-injection-completeness-fix.md
git commit -m "$(cat <<'EOF'
docs(agent-platform): 上下文注入完整性修订 spec + plan

修复 buildContextSegments 在测试环境暴露的过滤过严 bug：模块段去硬过滤 +
summary 缺失降级 result 截断 + 加版本/秒级时间；材料段去 status 过滤 +
加 sourceId + 状态文字；段头加工具查询条件提示。

延续 2026-05-05-agent-context-sync-unification spec，仅修订 buildContextSegments
实现细节，不改架构、不动中间件。
EOF
)"
git push origin dev
```

- [ ] **Step 8: 总结**

整理输出给用户：
- 5 个 task 全部完成
- 改动 commits hash 列表
- 单测/集成/端到端验证结果
- spec §10 验收点逐条勾选状态
