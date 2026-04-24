# M6.1 总览 + 流式进度 + 版本管理 Phase A 审查报告

**审查范围**：进度 UI + 总览面板 + 版本时间线
**权威需求源**：
- `docs/superpowers/specs/2026-04-21-m6-1-contract-review-overview-and-progress-design.md`（v2）
- `docs/superpowers/specs/2026-04-22-contract-review-versioning-design.md`

**审查人**：auditor-ux-version（Task #3）
**结论概览**：核心链路已按 spec 打通、得分公式/状态机/原子事务都对得上，但在 **"SSE 事件序号/乱序防护、highlights.riskId 绑定、失败路径 UI 残留、进度条 no_segments 死循环"** 四处存在**需要修复**的问题。下文按严重度排列。

---

## 一、严重（必须修）

### [S1] summarize 永停在"汇总中"——`no_segments` / `summarize` 异常分支未发 `stage:summarize,done`
**位置**：`server/services/workflow/agents/contractReviewMainAgent.ts:462-473` 和 `:498-504`

**现象**：
- segments 空时发了 `stage:analyze,done + warnings:['no_segments']` 之后 `controller.close()`，**整个流程没有触发 summarize 阶段的 running/done 事件**。
- `summarizeOverview` 抛错的兜底分支虽然发了 `stage:summarize,done`，但没发 `running`——前端 `stageStatus.summarize` 可能长期停在 `wait`。
- `ReviewProgress.vue` 的 `allDone` 要求"5 段全部 done"才隐藏；中间态下进度条永久显示在屏幕上。

**影响**：用户看到"正在汇总总览 …"永不消失，体感是"审查没完成"。`mountReview` 在 `completed/failed/rebuilding` 终态下会五段全置 done，但**运行时 SSE 流不回灌** → 只有刷新页面才能自愈。

**修复建议**：
1. `no_segments` 分支补发 `{stage:'summarize',status:'running'}` + `{stage:'summarize',status:'done'}`（或者统一触发一次 `failed` 终态 refresh）；
2. `summarizeOverview` 失败路径补 `{stage:'summarize',status:'running'}`（现在只补了 done，没补 running，stage 机可能漏一次过渡，但主要问题是路径 1）；
3. 或者在 `useContractReview.ts` 的 `watch(runStatus)` 里 `completed/failed` 时也回填 stageStatus（对标 mountReview 的终态分支）。

---

### [S2] `summary.highlights[*].riskId` 可能为空字符串、且 LLM 返回的 id 不校验是否存在
**位置**：`server/services/assistant/contract/summarizeOverview.ts:22-25`；`app/components/assistant/contract/OverviewPanel.vue:94-126`

**现象**：
```ts
const highlightItem = z.object({
    text: z.string().max(200).transform(s => s.slice(0, 60)),
    riskId: z.string().optional().default(''),   // ❌ 空串兜底
})
```
- LLM 漏返回 `riskId` → highlight 以 `riskId: ''` 入库；OverviewPanel 点击触发 `emit('focusRisk', '')`；`focusRisk('')` 不会抛错但**不会跳到任何卡片** → 用户感觉"点了没反应"（违反 spec §US-3 "三个入口行为一致"、§US-6 "定位不准时不会静默失败"）。
- LLM 返回一个不存在的 riskId（比如编号幻觉、把外部 id 混用）→ 同样静默失效。
- 实际落库时**没有任何 riskId ↔ risks[].id 的合法性校验**。

**修复建议**：
1. 在 `summarizeOverview` 返回前做一次 post-validate：把 `highlights.*.riskId` 与传入 `risks` 的 id 做 set 交集；不匹配的项剔除或回填到第一个同 level 的 risk id。
2. 前端 `OverviewPanel` 点击时判空 → 降级为"未定位"提示（对标 US-6 三级兜底的第 3 级）。

---

### [S3] SSE 事件无 `seq` 字段、无去重/乱序防护
**位置**：`shared/types/contract.ts:243-259` 的 `ContractReviewEvent` 定义；`useContractReview.ts:239-253` 的 onCustomEvent

**现象**：spec §5.1 明确要求 "每个 SSE 事件带 `seq` 递增，前端可去重"；当前实现：
- 后端发事件没带 seq；
- 前端 handler 直接按到达顺序处理；
- 断线重连（useStreamChat 重连能力）后后端会把**历史 custom event 全部重放**（或完全丢失，看底层 eventBridge 实现）。
- `risk` 事件重放会把同一 risk append 多次（`[...existing, event.risk]`，没按 id 去重）；`stage` 重放不幂等（done→running 回退会重置 UI）。

**影响**：低概率（内网多数场景不重连），但一旦发生就出现**重复风险卡片 / 进度条倒退**这种明显异常。

**修复建议**：
1. 补 `seq: number`，前端 handler 里维护 `lastSeen`，小于则丢弃；
2. 或者至少对 `risk` 事件按 `risk.id` 去重（`if (!existing.find(r => r.id === event.risk.id))`）。

---

## 二、较重（需要修）

### [M1] `POST /reviews/:id/versions` body 为空时 zod 解析 undefined 会失败 400
**位置**：`server/api/v1/assistant/contract/reviews/[id]/versions.post.ts:32-34`

```ts
const raw = await readBody(event)  // 可能是 undefined
const parsed = bodySchema.safeParse(raw)
```
- schema 是 `z.object({ lawyerNote: z.string().max(200).nullish() })`，`nullish()` 只允许 null/undefined **for lawyerNote 字段**，但顶层 `undefined` 会被 `z.object` 直接拒绝。
- 前端 `saveNewVersion(null)` 传 `{ lawyerNote: null }` 没问题；但如果直接点 "保存新版本"不带备注，Dialog 会传 `{ lawyerNote: null }`（已测 `ContractSaveVersionDialog`）也 OK。
- **隐患**：未来新增"一键快存"按钮若不带 body，会触发无提示 400。

**修复建议**：`const raw = (await readBody(event)) ?? {}`。

---

### [M2] "版本 vs 工作区" 的未保存标记用时间启发式，容易误判
**位置**：`app/composables/useContractReviewVersion.ts:352-362`

```ts
const hasUnsavedEdits = computed(() => {
    const latestEdit = Math.max(
        maxTimestamp(workspace.value.risks.map(r => r.updatedAt)),
        maxTimestamp(workspace.value.annotations.map(a => a.createdAt)),
    )
    ...
    return latestEdit > new Date(currentVer.createdAt).getTime()
})
```

**问题**：
- annotation 只用 `createdAt`，**不看 `updatedAt`**（批注内容编辑后时间戳不变） → 律师改批注内容但没有新增批注时，`hasUnsavedEdits` 为 false，"保存新版本"按钮灰掉。
- 幂等判定场景已有对应上传侧修复（见 `uploadClientVersion.service.test.ts:160` "覆盖 annotation.updatedAt 漏检修复验证"），但**前端这里漏了**。
- spec §4.3 "如果工作区相对 currentVersionId 有差异，显示'自 v2 以来有 N 处编辑'提示 + 蓝色'保存新版本'按钮"，实现里**只有 hasUnsavedEdits 布尔值，没有"N 处编辑"计数**。

**修复建议**：
1. annotation 侧换成 `Math.max(createdAt, updatedAt)`（type 上要补 updatedAt 字段）；
2. 或者调用后端 `/reviews/:id/unsaved` 端点统一判定（和上传侧逻辑对齐）。

---

### [M3] 历史版本下载：`wordCommentRef` 跨下载会变（已有兜底但仍是缺陷）
**位置**：`server/services/assistant/contract/contractReviewVersion.service.ts:213-250`

**现象**：注释里 **自述** "snapshot 里 ref 为 null、DB 里也查不到时 → `injectAnnotations` 当场生成新 rand8 但不回写 → 下次同版本下载 rand8 又变"。对应 spec §8.4 "极端兜底"。
- 这确实是 known bug #4 的残留；Phase A 不直接修，但要明确**spec 里"导出 docx 带稳定 wordCommentRef"的承诺在"历史版本下载 + 从未导出过当前工作区"的组合场景下是破的**。

**修复建议（Phase B+）**：历史版本下载前，如果发现 snapshot+DB 都为 null，先把生成的 rand8 回写到 snapshot 的 annotation.wordCommentRef（保持 snapshotData 不可变原则下做一次"初始化"写入）。或者在 `initial_upload` 快照创建时就强制写入一次稳定 rand8（前置到 persistRisksAndCreateV1Snapshot）。

---

### [M4] `mountReview` 对 `reviewing` 状态的启发式回填会闪一帧错位
**位置**：`useContractReview.ts:341-345`

```ts
} else if (r.status === 'reviewing') {
    stageStatus.value = {
        detect: 'done', stance: 'done', segment: 'done', analyze: 'running', summarize: 'wait',
    }
}
```

**问题**：
- `reviewing` 真实含义是"立场已选、已入队 analyze"，但 `segment` 步骤在**进入 reviewing 状态之前**就完成了（`segmentClauses` 在 agent 启动前执行）。所以把 segment 置 done 在逻辑上 OK。
- 但 `totalClauses` 没回填 → ReviewProgress "分析中 X / null" 文案会显示"正在分析第 14 / 0 条"（因为 `totalClauses === null`），观感不好。
- 进度条 `width: ${(14/null)*100}%` → NaN%。

**修复建议**：`reviewing` 分支若能从 `r.risks.length` / playbookSnapshot 推算条款数就回填一个近似值；或者给 ReviewProgress 加 `v-if="totalClauses"` 守卫（现在只有对进度条 bar 做了 `v-if="totalClauses"`，但文案 `progressText` 依赖 both null 才返回 null，实现上已经避免了——**实际没有 bug**，撤回；仅 SSE 重连后 stageStatus 不回填这一点真正有问题，见 S1）。

**结论**：M4 降级为观察项，核心在 S1。

---

### [M5] `risks` 增量写未按 spec §5.2 实现（最终一次性 update）
**位置**：`contractReviewMainAgent.ts:486-489` + `updateContractReviewDAO`

**现状**：spec 要求"每 risk 出 → `risks = [...risks, newRisk]` 增量写 + updatedAt 乐观锁"；实现是**在 runAnalyzeLoop 完成后一次性 `updateContractReviewDAO({ risks })`**。SSE 虽然按条流式，但 DB 不是。

**影响**：
- 如果 worker 在分析中途崩溃，**前面已经发过 `risk` 事件但 DB 里什么都没有**。用户刷新页面 risks 是空的 → 所有已显示的卡片丢失。
- refreshReview 会覆盖前端增量的 risks.value（因为后端 risks 字段仍是 null/旧值），用户感觉"审查刚完成就消失一半"。

**修复建议**：按 spec 做增量写，或者至少在每次 `risk` 事件后批量 upsert 进 `contractRisks` 表（已有 Phase A 新表）。

---

## 三、一般（观察项）

### [L1] 三色计数卡"可否点击"的 spec 自相矛盾，实现选了不可点
**位置**：`OverviewPanel.vue:70-84`（`<div>` 而非 `<button>`）

- spec §6.1 A 说"三色计数卡（点击跳到右侧列表对应分组，不跳文档）"；
- spec §2 决策 ② 说跳转入口是 "1 + 2 + 4"（点卡片 / 点要点 / 悬停文档段）——**没列计数卡**。
- 实现端注释明确选边："纯展示不可点（spec 入口 1+2+4，未选入口 3）"。

**建议**：产品/设计拍板一次，保留现状（推荐，降低视觉噪音）或改为按钮并 emit `focusLevelList('high'|'medium'|'low')`。非阻塞。

---

### [L2] `hasHighlights` 只判空对象引用，不判空数组
**位置**：`OverviewPanel.vue:35`
```ts
const hasHighlights = computed(() => !!props.summary?.highlights)
```
- 如果 LLM 返回 `highlights: { high:[], medium:[], low:[] }` —— 三档都空 —— `hasHighlights` 为 true，会渲染整个"分档要点"区但**三个段落都没内容、只看到空白 + 一个标题**。
- 上面的 v-if 是按 `summary!.highlights!.high.length` 守卫每个段落，实际上三档都空时整个 template 不会渲染任何内容——**没视觉问题，但产生一个空的 template 外壳**。
- 更保险写成 `hasHighlights = computed(() => summary.value?.highlights && (high|medium|low 任一非空))`。

非阻塞。

---

### [L3] 版本回滚 / 版本对比 / "相对 v1 新增 N 条风险" UI 均未实现
- spec §6.5 "场景 5 · 对比两个版本"、§7.6 "对比抽屉"均属于 **Phase C**，Phase A 不交付 → **符合 spec**。
- spec §4.2 "版本不可删" → 实现里没有 DELETE /versions/:id 端点 → **符合 spec**。
- 时间线变更徽章（spec §7.1 "每节点显示变更徽章"）在 Phase A 未实现；ContractReviewVersionEntity 的 `stats` 字段 comment 标记为 "Phase B 再加"。→ **符合 spec 分期**。

本条仅作为"可追溯性清单"存档。

---

### [L4] 缺失的测试
- **没有 SSE 断线重连测试**：useContractReview / useStreamChat 层均未见 "中途断线 → 重连后 stage 与 risks 是否自愈"的 case（客观上需要 chrome-devtools MCP 或 MSW 模拟才能覆盖，Phase A 跳过可接受）。
- **没有"版本 snapshot.risks 结构 ↔ 新 contractRisks 表一致性"测试**：`saveContractReviewVersionService` 的 snapshot 用的是 `tx.contractRisks.findMany` 直接 dump，字段与 `ContractRiskEntity` 类型耦合。如果未来表加字段没同步到类型，ts 不会报错（snapshot 是 `Prisma.InputJsonValue`，类型宽松）。
- **auto_backup 幂等性测试**：已覆盖（`uploadClientVersion.service.test.ts:129`），✅。
- **summarizeOverview schema 宽容化**（slice/max）单测：未见独立 unit test 验证 "LLM 返 11 条 high 会被截 5 条"、"text 超 60 字会被 slice"，建议补。

---

## 四、正确确认（spec 一致，不用改）

- ✅ 5 段状态机定义与 spec §5.1 一致；`awaiting_stance` 在 `useContractReview.runStatus` 里优先级最高。
- ✅ 评分公式 `shared/utils/contractOverviewScore.ts:25-30` 与 spec §4.1 精确一致（`min(100, round(3h + 1.5m + 0.5l))`）。
- ✅ scoreLabel 分段（70/50/30）与 spec 一致。
- ✅ `ContractOverview` 类型放在 `shared/types/contract.ts`（而非 contract.version.ts 等），对齐 spec §4.1 "明确放位置"。
- ✅ `summarizeOverview` "0 条风险时不调 LLM、直接默认返回"—— 省 token，spec §异常分支合同极短场景符合精神。
- ✅ `summary` 字段从 string 改成 JsonB，加迁移把老数据包成 `{ highlights: null, overall: old_string }`（迁移代码未直接审，但兼容策略前端 `hasHighlights` 判空已做）。
- ✅ 版本号 `maxVersionNo` 原子 `{ increment: 1 }` + `@@unique([reviewId, versionNumber])` + handler 层捕 P2002 返回 409，并发安全 OK。
- ✅ `currentVersionId` 更新包在 `prisma.$transaction` 内，事务一致性 OK。
- ✅ 四种 `systemLabel`（initial_upload / lawyer_save / auto_backup / client_return）枚举全齐 + UI 展示映射表 `VERSION_SYSTEM_LABEL_DISPLAY` 到位。
- ✅ 导出不产生版本（`/reviews/:id/download` 与 `/reviews/:id/rebuild-docx` 均不写 contractReviewVersions 表）。
- ✅ 历史版本 docx 下载（spec §4.5 旧版本只读）实现不改 snapshotData、不回写 wordCommentRef（见 `contractReviewVersion.service.ts:181` 注释"只读操作"）。
- ✅ `useContractReviewVersion.isReadOnly` 守卫了 `updateRiskArchivedStatus / addLawyerAnnotation / updateAnnotation / deleteAnnotation / saveNewVersion`，版本预览态下编辑静默返回。
- ✅ `updateVersionNote` 不受 isReadOnly 约束（spec §4.6 "备注可编辑"）。
- ✅ SaveVersionDialog / VersionTimeline 交互符合 spec §7.1 收缩/展开态 + localStorage 持久化。
- ✅ ReviewProgress 组件 allDone 时自动隐藏（spec §7.3 "全部完成折叠"），rebuild 不占槽位。
- ✅ `persistRisksAndCreateV1Snapshot` 与 `runAnnotateAndUpload` 顺序正确（先落表再注入批注），失败降级不影响主流程。
- ✅ `useContractReview` 的 stream 版本号（`streamGeneration`）防止快速切换 review 时旧 stream completed 回调污染新 review。
- ✅ 错误 toast 文案统一、可见（spec §US-1 "单条失败实时 toast"已实现）。

---

## 五、修复优先级建议

| 级别 | 问题 | ETA |
|---|---|---|
| P0 | S1 summarize 永停 | 0.5d |
| P0 | S2 highlights.riskId 失配 | 0.5d |
| P1 | S3 SSE seq / risk 去重 | 1d |
| P1 | M1 空 body 400 | 5min |
| P1 | M2 annotation updatedAt 漏检 | 0.5d |
| P2 | M3 wordCommentRef 跨下载变 | 1d（Phase B+） |
| P2 | M5 risks 增量写 | 1d |
| P3 | L1-L4 观察项 | 按需 |

---

## 六、限制说明

本次审查**未**覆盖：
- 后端 `contractReviewMainAgent.ts` 的 agent 中间件栈 / LangGraph interrupt-resume 机制细节（归属 Task #1）
- `docx/` 目录的 Word 批注注入实现（归属 Task #2）
- `contractPlaybook*` / 管理端接口（归属 Task #4）
- `chat.branch.test.ts` 等工作流集成测试的真实 fixture 数据
- 前端 `ContractDocxPreview` 的滚动/定位实际运行（需 chrome-devtools MCP 端到端）

以上范围内问题如有发现请对应 owner 补充。
