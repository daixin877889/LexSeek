# invokeNodeJson schema fail 自动 retry + 合同审查 prompt 强化约束 · 设计文档

> **定位**：合同审查 PR8 — 解决 PR6 引入的 `risksSchema.builder` refine 强制 reject 含 `\r|\n` 的 `suggestedClauseText` 时整条 risk 被跳过的问题。
> **代号**：`contract-review-pr8-invoke-node-json-retry`（不在用户面前出现）
> **用户视角**：合同分析时不再频繁看到「条款 #N 已跳过」错误。
> **范围**：agent-platform 通用工具 `invokeNodeJson` 内置 schema fail 自动 retry（最多 3 次）+ contract 审查 system prompt v3→v4 加 `\n` 反例双保险。

---

## 1. 背景

### 1.1 现状问题

PR6 spec §8.3.3 在 `server/agents/contract/riskSchema.builder.ts:32-37` 强制 zod refine：

```ts
suggestedClauseText: z.string().max(10000)
    .refine(s => !/\r|\n/.test(s), {
        message: 'suggestedClauseText 不允许换行（v1 整段替换不支持多段插入；spec §8.3.3）',
    })
    .optional()
```

但 LLM（DeepSeek/Sonnet）prompt 约束不能 100% 遵守，偶发输出含 `\n` 的多段建议 → schema fail → `invokeNodeJson` 直接 throw → `uploadClientVersion.service.ts:525` catch 后 `logger.warn('条款 #${clause.index} 增量 AI 审查失败，跳过')` → **整条 risk 数据被丢弃**。

线上观察：约 5% 条款会因此被跳过，用户感知为「条款 #N 已跳过」错误。

### 1.2 为什么不放开 `\n` 限制

spec §8.3.3 是 v1 妥协：

- OOXML `<w:t>` 里 `\n` 被 Word 渲染成空格不换行
- 多段插入需要拆 `<w:p>` 多段 + 各加 `<w:ins>`，PR6 redlineInjector 未支持
- 放开 `\n` 反而会让律师 redline 模式看到错乱的"段落变空格"现象

v2 多段插入是另一独立路线，本 PR 不涉及。

### 1.3 现状 invokeNodeJson 行为

`server/services/agent-platform/tools/invokeNodeJson.ts:114-133` 的 schema fail 处理：

```ts
const parsed = schema.safeParse(rawJson)
if (!parsed.success) {
    // logger.warn(...)
    throw new Error(`${errorPrefix} schema 校验失败: ${pretty}`)
}
```

**完全没有 retry 机制**。schema fail 直接 throw，调用方负责 catch + skip。

---

## 2. 范围与边界

### 2.1 做的事

1. **invokeNodeJson 通用化 retry**：schema `safeParse` fail 时自动 retry 最多 3 次，retry prompt 拼接 zod issue
2. **DB prompt 强化约束**：`contractReviewAnalyzeClause` v3 → v4，加 `\n` 错误反例 + 分号串联正例
3. **三态埋点**：`retry 触发` / `retry 第 N 次成功` / `retry 仍 fail`，便于运维监控 retry 有效率

### 2.2 不做的事（YAGNI）

| 子项 | 理由 |
|---|---|
| 兜底「\n→空格」让 schema 通过 | spec §8.3.3 v1 妥协不破坏，破坏会让 redline 模式段落语义错乱；这是 B 方案独立 PR 主题 |
| 可配 `maxRetries` | YAGNI，硬编码 3 次足够 |
| 指数退避延迟 | DeepSeek/Anthropic 无 rate limit，无意义 |
| `JSON.parse` fail / `extractFirstJsonObject` fail / LLM invoke 抛错 retry | 这些场景 retry 大概率仍失败，浪费 token |
| 改其它调用方代码 | invokeNodeJson 通用化后所有调用方透明受益 |
| OOXML 多段插入支持（spec §8.3.3 v2 路线） | 独立 spec，超 PR8 范围 |

### 2.3 用户语言

- 不暴露 "schema fail" / "retry" 等技术词
- 用户感知：合同分析「条款 #N 已跳过」频率从 ~5% 降到 ~0.2%（3 次 retry 后 LLM 仍违规的极小概率）

---

## 3. invokeNodeJson 改造细节

### 3.1 当前实现（`invokeNodeJson.ts:114-133`）

```ts
const parsed = schema.safeParse(rawJson)
if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map(...)
    logger.warn(`${errorPrefix}: schema 校验失败`, { ... })
    const firstIssue = parsed.error.issues[0]
    const pretty = firstIssue ? `${firstIssue.path.join('.') || '(root)'}: ${firstIssue.message}` : 'unknown'
    throw new Error(`${errorPrefix} schema 校验失败: ${pretty}`)
}
return parsed.data
```

### 3.2 改造后目标行为

```ts
const MAX_RETRIES = 3 // 顶部 const，不暴露 API

// 内部 attempt 函数：单次 invoke + JSON 提取 + safeParse
// 返回：success → 数据；recoverable schema fail → { firstIssue, rawContent }；不可恢复（JSON fail / invoke 抛错）→ 直接 throw

let lastFirstIssue = ''
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const currentPrompt = attempt === 1
        ? buildPrompt(template)
        : buildPrompt(template) + `\n\n## 上次输出违反 schema：\n${lastFirstIssue}\n请重新生成符合 schema 的 JSON。`

    const result = await attemptInvoke(currentPrompt, attempt)
    if (result.success) {
        if (attempt > 1) {
            logger.warn(`${errorPrefix}: retry 第 ${attempt} 次成功`, { ..., attempt })
        }
        return result.data
    }
    lastFirstIssue = result.firstIssue
    if (attempt < MAX_RETRIES) {
        logger.warn(`${errorPrefix}: schema 校验失败，触发 retry`, { ..., attempt, firstIssue: result.firstIssue })
    }
}

// 3 次都 fail
logger.warn(`${errorPrefix}: retry ${MAX_RETRIES} 次仍 fail`, { ..., totalAttempts: MAX_RETRIES, firstIssue: lastFirstIssue })
throw new Error(`${errorPrefix} schema 校验失败: ${lastFirstIssue}`)
```

### 3.3 retry prompt 拼接策略

- **基础**：每次 retry 用 `buildPrompt(template)` 重新渲染（不复用上次的 prompt 字符串，避免 retry 提示堆积）
- **追加**：在重新渲染后的 prompt 末尾追加：
  ```
  
  
  ## 上次输出违反 schema：
  {path}: {message}
  请重新生成符合 schema 的 JSON。
  ```
- **不带 history**：不传 `[system, user, assistant(失败响应), user(违规说明)]` 多轮消息，单次 prompt 拼接已足够，避免 multi-turn token 翻倍

### 3.4 埋点 schema

| 事件 | logger 级别 | 字段 |
|---|---|---|
| `${errorPrefix}: schema 校验失败，触发 retry` | warn | `attempt`、`firstIssue`（拼接好的 `path: message` 字符串）、`rawShape`、`logContext` 透传 |
| `${errorPrefix}: retry 第 N 次成功` | warn | `attempt`、`logContext` 透传 |
| `${errorPrefix}: retry ${MAX_RETRIES} 次仍 fail` | warn | `totalAttempts`、`firstIssue`（拼接好的字符串）、`logContext` 透传 |

`firstIssue` 拼接格式与 §3.1 现状 `pretty = ${path}: ${message}` 保持一致，便于运维 SQL 字符串匹配。

> 用 warn 而非 info：retry 命中本身是异常通路，运维需要在常规告警面板能看到（与 spec §10.3 quote_match_source 监控同思路）。

### 3.5 监控思路（运维参考）

项目目前没有结构化 application_logs 表，logger 输出落到 stdout / 文件 / 阿里云 SLS。运维侧按下面三类 message 字符串做关键字告警与统计：

| 关键字 | 含义 | 健康阈值 |
|---|---|---|
| `触发 retry` | retry 触发次数（含未成功） | — |
| `retry 第`...`次成功` | retry 命中次数 | `succeeded / triggered ≥ 80%` |
| `retry`...`次仍 fail` | 3 次 retry 仍 fail 次数 | `final_failed / triggered ≤ 5%` |

`final_failed / triggered` 长期超 10% 时考虑：(a) 升级 LLM model、(b) 强化 prompt、(c) 在 `InvokeNodeJsonOptions` 加可配 maxRetries（YAGNI 路线见 §8）。

> 后续如接入结构化日志（OpenTelemetry / Loki / 阿里云 SLS 索引），可按 `errorPrefix` 维度切片观察按节点的 retry 分布。

---

## 4. DB prompt 强化（v3 → v4）

### 4.1 现有 v3 内容（节选）

PR3 commit `3a50568c` 的 `contractReviewAnalyzeClause` v3 包含：

- `{{sentencesNumbered}}`（PR3 加的切句标号）
- `{{clauseTextRaw}}`（原条款全文）
- `problemSentenceIds` 输出指引

### 4.2 v4 追加段（在 v3 末尾）

```
## suggestedClauseText 输出格式约束（铁律）

`suggestedClauseText` 必须是单段连续文字，**绝对不可包含**：
- 换行符（`\n` / `\r` / 任何形式的换行）
- 项目符号（`-` / `•` / `1.` / `(1)` 等列表标记开头）
- 多段（用空行分隔的多个段落）

理由：Word 文档导出时，OOXML 的 `<w:t>` 元素里换行会被渲染成空格不换行，多段建议会变成"一长串混在一起的文字"，律师无法判断段落结构。

❌ 错误示例（schema 会 reject 整条建议）：

```json
"suggestedClauseText": "第一款 甲方应支付货款。\n第二款 逾期支付按 0.5% 加收滞纳金。"
```

```json
"suggestedClauseText": "1. 甲方应支付货款；2. 逾期支付按 0.5% 加收滞纳金"
```

✅ 正确示例（用分号 / 逗号串联多句）：

```json
"suggestedClauseText": "甲方应支付货款；逾期支付按 0.5% 加收滞纳金，且累计超 30 日的乙方有权解除合同。"
```

如果有多个独立条款建议，请合并成单段语义连贯的文字，用分号或逗号串联。
```

### 4.3 落地方式

按项目惯例（`.claude/rules/api.md` 「管理端 API 注册流程」段），prompt 改动**不走 seedData.sql / migration**，而是：

1. 通过管理后台 → 「提示词管理」找到 `contractReviewAnalyzeClause` v3
2. 创建 v4 版本（content = v3 内容 + 4.2 追加段）
3. 启用 v4，禁用 v3
4. 操作记录在管理后台审计日志

或通过 prompt update API（管理端接口）脚本化执行。

> PR8 plan 会包含具体的 prompt update SQL（仅对开发库）+ 操作步骤文档（生产库）。

---

## 5. 测试策略

### 5.1 单元测试（agent-platform 覆盖率约束 ≥90%）

文件：`tests/server/agent-platform/tools/invokeNodeJson.retry.test.ts`（新增）

| 用例 | 验证 |
|---|---|
| 首次 PASS 不触发 retry | mock chatModel 返回合规 JSON → 单次 invoke + 无 retry warn |
| 首次 fail + 第 2 次 PASS | mock 第 1 次返回违规、第 2 次返回合规 → retry 触发 1 次 + "retry 第 2 次成功" warn 命中 + 返回数据 |
| 前 2 次 fail + 第 3 次 PASS | mock 前 2 次违规、第 3 次合规 → 2 次 retry 触发 + "retry 第 3 次成功" warn 命中 |
| 3 次都 fail → throw | mock 3 次都违规 → throw + "retry 3 次仍 fail" warn 命中 |
| `JSON.parse` fail 不触发 retry | mock 返回非 JSON 字符串 → 直接 throw + 无 retry warn |
| `extractFirstJsonObject` 返回 null 不触发 retry | mock 返回纯文字 → 直接 throw + 无 retry warn |
| LLM invoke 抛错不触发 retry | mock `model.invoke` reject → 直接 throw + 无 retry warn |
| retry prompt 包含 zod issue | spy on `model.invoke` 第二次调用的 prompt → 验证含「上次输出违反 schema: ${path}: ${message}」 |
| retry prompt 不堆叠 | 第 3 次 retry 的 prompt 中 "上次输出违反 schema" 段只出现 1 次（不是 2 次） |

### 5.2 回归测试

跑既有所有调用方测试无回归：

- `tests/server/assistant/contract/analyzeSingleClause.test.ts`
- `tests/server/assistant/contract/summarizeOverview.test.ts`
- `tests/server/agents/contract/uploadClientVersion.service.test.ts`
- 其它 grep `invokeNodeJson` 命中的测试

### 5.3 集成验证（手工冒烟）

1. 在合同审查 prompt v4 上线后，上传一份历史触发过 `\n` 跳过的合同 docx
2. 跑 AI 审查，监控日志是否有 「retry 第 N 次成功」warn 命中
3. 验证用户看不到「条款 #N 已跳过」（除非 3 次 retry 都 fail，极小概率）
4. 检查 `contract_risks` 表是否所有条款都有 risk 行（不再丢失）

---

## 6. PR 拆分

| # | PR | 内容 | 工期 |
|---|---|---|---|
| 8 | `contract-pr8-invokeNodeJson-retry` | invokeNodeJson 通用 retry + DB prompt v3→v4 + 测试 | 1 天 |

合并发布约束：

- 改动是 agent-platform 通用工具 + DB prompt 改动，无前置依赖
- 与 PR7 独立（如果 PR7 还没 push 也可以并行 push，commits 互不冲突）
- prompt v4 依赖 invokeNodeJson retry 上线后即时生效（v3 切 v4 是运行时操作）

---

## 7. 风险与 mitigation

| 风险 | 影响 | mitigation |
|---|---|---|
| LLM 多次 retry 增加延迟 | 3% fail 场景下平均 +6s | 仅 fail 时增加，正常路径零变化；3 次后停止避免长尾；监控 final_failed > 5% 时考虑升级 model |
| retry token 消耗 ~3× | fail 场景成本增加 | 同上，仅 fail 时；正常审查路径不变 |
| agent-platform 通用化影响下游 | 所有调用方行为变化 | invokeNodeJson 契约不变（成功返回数据 / 失败 throw），retry 只是内部多了几次尝试，调用方透明。回归测试覆盖既有调用方 |
| prompt 反例本身被 LLM 误抄到输出 | LLM 把 `\n` 当字面量输出到 suggestedClauseText | zod refine 兜底（PR6 已有），retry 兜底（PR8 新增），三层防御（prompt 约束 + schema reject + retry） |
| retry prompt 拼接时模板变量未替换 | 如果 buildPrompt 内含 `{{var}}` 没替换，retry 也带过去 | `warnUnreplacedTemplateVars` 已有保护；retry 重新渲染 `buildPrompt(template)` 不复用上次 prompt 字符串 |

---

## 8. 后续路线（不在 PR8 范围）

- **OOXML 多段插入**（spec §8.3.3 v2）：放开 suggestedClauseText 含 `\n` 的限制，redlineInjector 拆 `<w:p>` 多段插入。独立 spec → plan → 实施。
- **可配 maxRetries**：如果不同 vertical 需要差异化次数（如 globalReview 重要性高需要 5 次 / quick analysis 1 次），将 maxRetries 加到 `InvokeNodeJsonOptions`。当前 YAGNI。
- **retry 间隔 / 指数退避**：如果 LLM provider 加 rate limit，加 sleep 间隔。当前 YAGNI。
