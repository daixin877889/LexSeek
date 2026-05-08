# 上下文注入完整性修订（Spec）

- 日期：2026-05-06
- 状态：待 review
- 作者：戴鑫
- 关联：[2026-05-05-agent-context-sync-unification-design.md](./2026-05-05-agent-context-sync-unification-design.md)（本次为其延续修订）
- 涉及文件：`buildContextSegments` / `getMaterialListWithSummariesService` 及调用方测试

---

## 1. 背景

上次"三 Agent 上下文同步机制统一"上线后，用户在测试环境抓到一个真实对话的注入消息截图，发现：

- **已分析模块整段缺失**——测试环境该案件 7 个分析模块均 `isActive=true`，但部分模块 `summary` 字段为 NULL（旧数据 Q4.3 B "旧数据不补摘要"决策的遗留），`buildContextSegments` 当前实现 `if (!a.summary) continue` 把它们全跳过，最终 `lines.length === 1`（只剩段头）→ 整段输出空字符串
- **案件材料清单整段缺失**——`getMaterialListWithSummariesService` 只过滤 `status=3 (COMPLETED)` 的材料，处于"识别中 / 待识别 / 失败"状态的材料不进列表
- **段头缺工具查询参数提示**——LLM 不知道调 `search_case_analysis` 时 `analysis_type` 该填什么、调 `search_case_materials` 时 `sourceId` 该填什么，只能 query 模糊召回
- **模块更新时间缺失**——LLM 无法判断分析时效，无法区分"陈旧"与"最新"分析

这是**过滤过严** + **结构信息缺失**双重问题，导致 LLM 在材料/分析齐全的案件里仍然像"瞎子摸象"。

## 2. 目标与非目标

### 2.1 目标

- 已分析模块段：列**所有** `isActive=true && deletedAt IS NULL` 的模块（不再因 summary 为 NULL 整条跳过）
- 已分析模块段：每个模块加版本号 + **精确到秒**的更新时间
- 已分析模块段：summary 缺失时降级用 `analysisResult` 前 500 字 + "（暂无独立摘要，正文节选）" 标识
- 已分析模块段：段头加 `search_case_analysis` 工具查询条件提示
- 案件材料段：列**所有未删除**材料（不再因 status≠3 整条跳过），按 status 加状态文字（已识别 / 识别中 / 待识别 / 识别失败）
- 案件材料段：每个材料加 `sourceId`（用现有 `getSourceId` 同款逻辑），段头加 `search_case_materials` 工具查询条件提示

### 2.2 非目标

- 不引入"summary 缺失时调 LLM 现场补"逻辑（避免每轮 5-15s 延迟；历史数据补齐留作离线脚本）
- 不动 `summarizationMiddleware` 默认行为（用户已明确 "C：保持现状"）
- 不引入新工具（如 `regenerate_analysis_summary`）—— 留作未来扩展
- 不动 `caseContextSyncMiddleware` 中间件本身（buildContextSegments 输出变化自然带过来）

## 3. 注入消息预期最终样式

```
## 案件档案
​```json
{
  "caseId": 4,
  "caseTypeId": 2,
  "courtName": "",
  "defendant": ["张奎", "陈乐", "苏州乐轩工程配套有限公司"],
  ...
}
​```

## 已分析模块（当前激活版本，全文请调用 search_case_analysis 工具，参数 analysis_type 填模块名 + query 填问题关键词）

### case_summary（v2，更新于 2026-05-04 14:32:18）
本案为串通投标罪刑事案件，2017-2020 年间...

### chronicle（v1，更新于 2026-05-04 13:21:09）
（暂无独立摘要，正文节选）
2017 年 10 月：张奎、陈乐成立苏州乐轩工程配套有限公司...

### claim（v1，更新于 2026-05-04 13:08:42）
公诉机关诉请：以串通投标罪追究...

...（其余模块）

## 相关案件记忆
- ...
- ...

## 案件材料清单（全文请调用 search_case_materials 工具，参数 sourceId 填下面括号中的值精确取该材料；或参数 query 填关键词跨材料搜索）
- **庭审笔录-2024-08-12**（文档，sourceId=2031）— 已识别 — 张奎首次庭审笔录...
- **吴凡询问笔录**（文档，sourceId=2032）— 已识别 — （摘要生成中）
- **审计报告.pdf**（文档，sourceId=2033）— 识别中 — （待识别完成后可查全文）
- **现场录音**（音频，sourceId=2034）— 已识别 — 2018 年项目方内部讨论...
- **新追加合同复印件**（图片，sourceId=2035）— 待识别 — （上传中或排队中）
- **损坏的录音**（音频，sourceId=2036）— 识别失败 — （识别失败，可联系客服重新处理）
```

## 4. 详细设计

### 4.1 `buildContextSegments` moduleSummaries 段重写

文件：`server/services/agent-platform/context/moduleContextBuilder.ts`

**改动 1：扩展 caseAnalyses 查询字段**

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

**改动 2：moduleSummaries 段渲染逻辑重写**

```ts
// ④ 已分析模块（当前激活版本）
let moduleSummaries = ''
if (activeAnalyses.length > 0) {
  const lines = ['## 已分析模块（当前激活版本，全文请调用 search_case_analysis 工具，参数 analysis_type 填模块名 + query 填问题关键词）']
  for (const a of activeAnalyses) {
    const updatedAt = a.updatedAt
      ? dayjs(a.updatedAt).format('YYYY-MM-DD HH:mm:ss')
      : '未知时间'
    const header = `### ${a.analysisType}（v${a.version}，更新于 ${updatedAt}）`

    if (a.summary) {
      lines.push(`${header}\n${a.summary}`)
    }
    else if (a.analysisResult) {
      // 降级：summary 缺失时取正文前 500 字 + "..."
      const excerpt = a.analysisResult.slice(0, 500)
      const tail = a.analysisResult.length > 500 ? '...' : ''
      lines.push(`${header}\n（暂无独立摘要，正文节选）\n${excerpt}${tail}`)
    }
    else {
      // 极端：summary 和 analysisResult 都为 null
      lines.push(`${header}\n（暂无内容）`)
    }
  }
  moduleSummaries = lines.length > 1 ? lines.join('\n\n') : ''
}
```

注意：`moduleContextBuilder.ts` 当前 5 行 import 中**无 dayjs**（已 grep 确认）。需新增 `import dayjs from 'dayjs'` 到顶部。

### 4.2 `getMaterialListWithSummariesService` 扩展

文件：`server/services/material/materialPipeline.service.ts`

**改动**：去 `status=3` 过滤 + 返回字段加 `status` 与 `ossFileId`

```ts
export async function getMaterialListWithSummariesService(caseId: number): Promise<Array<{
    id: number
    name: string
    type: number
    status: number          // 新增
    ossFileId: number | null // 新增（用于 sourceId 计算）
    summary: string | null
}>> {
    return prisma.caseMaterials.findMany({
        where: { caseId, deletedAt: null }, // 移除 status=3 过滤
        select: { id: true, name: true, type: true, status: true, ossFileId: true, summary: true },
        orderBy: { createdAt: 'asc' },
    })
}
```

注释同步更新："返回案件全量未删除材料 + 摘要 + 状态（供 moduleContextBuilder ⑤ 段使用）"。

### 4.3 `buildContextSegments` materials 段重写

文件：`server/services/agent-platform/context/moduleContextBuilder.ts`

**改动**：段头加查询条件提示 + 每行加 sourceId + 状态文字 + summary 状态化

```ts
// ⑤ 动态：召回记忆 + 材料清单
const dynLines: string[] = []
if (memoryHits.length > 0) {
  dynLines.push('## 相关案件记忆')
  for (const m of memoryHits) dynLines.push(`- ${m.text}`)
}
if (materials.length > 0) {
  dynLines.push('\n## 案件材料清单（全文请调用 search_case_materials 工具，参数 sourceId 填下面括号中的值精确取该材料；或参数 query 填关键词跨材料搜索）')
  for (const mat of materials) {
    const typeLabel = TYPE_LABEL_MAP[mat.type as 1|2|3|4] ?? '其它'
    const statusLabel = STATUS_LABEL_MAP[mat.status as 1|2|3|4] ?? '未知状态'
    const sourceId = mat.type === CaseMaterialType.CASE_CONTENT ? mat.id : mat.ossFileId
    const summaryText = renderMaterialSummary(mat.status, mat.summary)
    dynLines.push(`- **${mat.name}**（${typeLabel}，sourceId=${sourceId ?? '未生成'}）— ${statusLabel} — ${summaryText}`)
  }
}
const dynamicContext = dynLines.join('\n')
```

**辅助常量**（在文件顶部声明）：

```ts
import { CaseMaterialType } from '#shared/types/case'

const TYPE_LABEL_MAP = { 1: '文本', 2: '文档', 3: '图片', 4: '音频' } as const

const STATUS_LABEL_MAP = {
  1: '待识别',
  2: '识别中',
  3: '已识别',
  4: '识别失败',
} as const

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

**为什么不复用 `getSourceId` helper**：`getSourceId(material: MaterialWithFile)` 类型签名要求 `MaterialWithFile`（含 ossFile 关联），而我们的 select 只取扁平字段。复用要么扩 select 引入 `MaterialWithFile`（增加 N+1 查询风险），要么改 getSourceId 签名（涉及多个调用方）。**内联 5 行实现最干净**，逻辑与 getSourceId 等价。

### 4.4 调用方影响范围

`getMaterialListWithSummariesService` 的所有调用方：

```bash
grep -rn getMaterialListWithSummariesService server/
```

预期仅 2 处：
- `moduleContextBuilder.ts`（本次改造直接消费新字段）
- 可能存在的测试文件

新增的 `status` / `ossFileId` 字段是**追加**，已有调用方解构 `{ id, name, type, summary }` 不受影响。

### 4.5 不变的部分

- `caseContextSyncMiddleware`：完全不动（buildContextSegments 返回值结构不变，只是 dynamicContext / moduleSummaries 字符串内容变化自然带过）
- 三个 Agent（caseMain / moduleAgent / documentMain）：完全不动
- `getSourceId` helper：完全不动（不在本次范围）
- `injectorDetection` / `caseProcessMaterialMiddleware` / 前端过滤：完全不动

## 5. 测试策略

### 5.1 单元测试

**文件 1**：`tests/server/agent-platform/context/moduleContextBuilder.test.ts`（新建或在现有测试中补）

新增用例：
- `buildContextSegments`：active 模块 summary 为 null + analysisResult 非空 → 输出"（暂无独立摘要，正文节选）" + result 前 500 字
- `buildContextSegments`：active 模块 summary 与 analysisResult 都为 null → 输出"（暂无内容）"
- `buildContextSegments`：模块段头格式 `### ${type}（v${version}，更新于 YYYY-MM-DD HH:mm:ss）`
- `buildContextSegments`：模块段段头含 `参数 analysis_type 填模块名`
- `buildContextSegments`：材料段段头含 `参数 sourceId 填下面括号中的值`
- `buildContextSegments`：材料 status=1/2/4 也出现在列表中（不再被过滤）
- `buildContextSegments`：材料行格式 `- **${name}**（${typeLabel}，sourceId=${sid}）— ${statusLabel} — ${summary}`
- `buildContextSegments`：材料 type=1（文本）→ sourceId 用 `material.id`；type=2/3/4 → sourceId 用 `ossFileId`

**文件 2**：`tests/server/services/material/materialPipeline.service.test.ts`（如有，否则补）

更新/新增用例：
- `getMaterialListWithSummariesService` 返回所有未删除材料（含 status=1/2/4）
- 返回字段含 `status` 和 `ossFileId`

### 5.2 集成测试

`tests/server/agent-platform/caseContextSync.integration.test.ts`：

新增 1 个 case：
- 创建 case + 多份 status 不同的 materials（1/2/3/4 各一份）+ 多个 active analyses（部分 summary 非空、部分 summary 为 null 但 analysisResult 非空）→ 跑 caseContextSyncMiddleware → 断言注入消息内容：
  - 含所有 4 种状态文字
  - summary 为 null 的模块走 result 截断分支
  - 模块段头含工具参数提示

### 5.3 旧单测改造

`caseContextSyncMiddleware.test.ts` 中 `mockSegments` 字段不变（buildContextSegments 返回签名不变），但**模块/材料相关 mock string 中的内容要更新**以匹配新格式（如有断言）。

### 5.4 覆盖率约束

`buildContextSegments` 在 `moduleContextBuilder.ts` 内，已有覆盖率监控；本次新增分支（summary null 分支 / status 4 状态文字 / sourceId 计算）应保持文件覆盖率 ≥ 90%（agent-platform.md 铁律）。

## 6. 改动文件清单

| 文件 | 改动 |
|---|---|
| `server/services/agent-platform/context/moduleContextBuilder.ts` | 顶部加 `import dayjs` + `import { CaseMaterialType }` + 常量 `TYPE_LABEL_MAP` / `STATUS_LABEL_MAP` / `renderMaterialSummary`；caseAnalyses select 加字段；moduleSummaries 段重写；dynamicContext 材料段重写 |
| `server/services/material/materialPipeline.service.ts` | `getMaterialListWithSummariesService` 去 status=3 过滤，select 加 `status` + `ossFileId`，返回类型同步扩展，注释更新 |
| `tests/server/agent-platform/context/moduleContextBuilder.test.ts` | 新增 8 条单测用例 |
| `tests/server/services/material/materialPipeline.service.test.ts` | 新增/更新 2 条用例 |
| `tests/server/agent-platform/caseContextSync.integration.test.ts` | 新增 1 个集成 case：混合 status / summary 缺失场景 |

无新增文件 / 无删除文件 / 无 schema 变更 / 无数据级变更。

## 7. 验收标准

- [ ] `npx nuxi typecheck` 0 错误
- [ ] 新增单元测试全 PASS，`buildContextSegments` 文件覆盖率 ≥ 90%
- [ ] 新增集成测试 PASS（含 status=1/2/3/4 + summary null 降级两个场景）
- [ ] 测试库 case 4（已被发现 bug 的环境）重新跑一轮 chat：注入消息**同时含** `## 已分析模块` 与 `## 案件材料清单` 两段
- [ ] 两段段头各自含正确的工具参数查询条件提示
- [ ] 模块段每行 `### ${type}（v${version}，更新于 YYYY-MM-DD HH:mm:ss）` 格式正确
- [ ] 材料段每行 `- **${name}**（${typeLabel}，sourceId=${sid}）— ${statusLabel} — ${summary or fallback}` 格式正确

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `analysisResult` 截断 500 字可能截断 markdown 块（如代码块未闭合）| LLM 容错足够强（对截断后的 markdown 不会失败）；不在本次范围做 markdown 边界感知 |
| `getMaterialListWithSummariesService` 移除 status 过滤后，未识别材料的"暂无内容"占位让 LLM 误以为已识别 | 状态文字（"识别中 / 待识别 / 识别失败"）+ summary 占位文字（"（识别中，待识别完成后可查全文）"）双重信号，LLM 不会误判 |
| `MaterialWithFile` 未被本次复用，未来某天 getSourceId 改签名时风险点孤立 | 内联实现注释说明"逻辑与 getSourceId 等价（type=1 用 id，type=2/3/4 用 ossFileId）"；getSourceId 改动时按 grep `mat.type === CaseMaterialType.CASE_CONTENT` 找到本处同步改 |
| 模块段当 summary 与 analysisResult 都为 null 时输出"暂无内容"，可能让 LLM 困惑 | 这是极端情况（active 但完全空，理论上不该出现）；输出"暂无内容"明确告诉 LLM 没东西可看，不至于幻觉 |

## 9. 与 2026-05-05 spec 的关系

本 spec 是 [2026-05-05-agent-context-sync-unification-design.md](./2026-05-05-agent-context-sync-unification-design.md) §4 详细设计的**修订延续**——上次 spec 已实现"上下文挪到 HumanMessage + 三 Agent 统一"的架构改造，本次仅修订 buildContextSegments 的过滤过严问题，不改架构、不改中间件、不改 Agent 配置。

历史数据补齐（caseAnalyses.summary 与 caseMaterials.summary 的批量回填）作为**未来独立 follow-up 立项**，不在本次范围。
