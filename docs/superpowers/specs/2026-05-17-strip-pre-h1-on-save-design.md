# AI 分析结果落库前清洗：去除一级标题前的说明性文字

日期：2026-05-17

## 背景

案件分析模块（含案件大事记、案件概览、争议焦点、法律分析等子分析）由 LLM 生成 markdown 报告并直接写入 `caseAnalyses.analysisResult` 字段。线上观察到：模型时常会在正式的一级标题（如 `# 案件大事记`）之前输出说明性前言，例如：

> 好的，我已经详细阅读了技能的全部参考资料。现在开始提取和分析案件大事记。
>
> 根据两份材料（宝马二手车纠纷.docx + 谈判录音.m4a），我梳理了所有时间节点和事件。以下是整理结果：
>
> # 案件大事记
> ...

这些前言对最终用户没有价值，污染报告排版与下游消费（如 docx 导出、RAG 切片摘要）。提示词工程已经在 `提示词.md` 里要求"标题前不输出任何内容"，但模型实际遵守率不稳定，需要在落库链路加一层兜底清洗。

## 范围

| 接入 | 是否 |
|---|---|
| 案件分析（case-analysis vertical，含案件大事记等所有子分析） | ✅ |
| 模块对话（case-module vertical，包括 `save_analysis_result` 工具与 `afterAgent` 兜底） | ✅ |
| 小索（case-main vertical） | ❌（不直接落 `analyses` 表，由子代理触发 case-analysis 时自动覆盖） |
| 通用问答（legal-assistant vertical） | ❌（不落 `analyses` 表，只是流式对话） |
| 合同审查 / 文档起草 vertical | ❌（不在本次范围，将来需要时复用同一工具） |
| Service / DAO 层（人工编辑 / 导入路径） | ❌（清洗只在 agent 写库点做，避免误伤人工内容） |

## 设计

### 1. 通用工具

新增 [shared/utils/markdown.ts](shared/utils/markdown.ts)：

```ts
/**
 * 去除 markdown 第一个一级标题（# xxx）之前的所有内容。
 * 用于清洗 LLM 输出的说明性前言。
 * 若没有匹配到一级标题，原文不动返回。
 * 处理后不保留前导空行 / 空白，输出首字符即为 `#`。
 */
export function stripContentBeforeFirstH1(markdown: string | null | undefined): string
```

**匹配规则**：

- 第一个**行首**以 `# ` 开头的行（CommonMark：`#` 后必须有空格或换行，否则不是 ATX 标题）
- **不**匹配 `## ` / `### ` 等更深层级
- **不**匹配 fenced code block（``` 或 ~~~ 围栏）内的 `# xxx`
- **不**匹配 indented code block（行首 4 空格或 1 tab）内的 `# xxx`
- **不**匹配 blockquote（`> # xxx`）内的一级标题

**输出规则**：

- 匹配到 → 删除该一级标题行之前的所有内容（含空行 / 空白），输出从该一级标题行的行首开始；标题行及之后的内容（含其内部换行）保持原样
- 未匹配到（含无一级标题、空串、`null`、`undefined`）→ 原样返回（`null` / `undefined` 统一返回空串，与 `analysisResult` 字段非空契约一致）

### 2. 接入点

| # | 文件 / 位置 | 修改 |
|---|---|---|
| 1 | [server/services/workflow/caseAnalysisV2.workflow.ts:275](server/services/workflow/caseAnalysisV2.workflow.ts:275) — `updateAnalysisDao` 调用处 | 把传入的 `analysisResult: resultText` 改成 `analysisResult: stripContentBeforeFirstH1(resultText)` |
| 2 | [server/agents/case-module/middleware/analysisResultPersistence.middleware.ts](server/agents/case-module/middleware/analysisResultPersistence.middleware.ts) — `save_analysis_result` 工具体 | 工具读取到的 markdown 在传给 `completeAnalysisWithRAG` 之前调用 `stripContentBeforeFirstH1` |
| 3 | 同上文件 — `afterAgent` 兜底分支 | 从最后一条 AIMessage 取出 markdown 之后、写库之前调用 `stripContentBeforeFirstH1` |

不在 service / DAO 层做清洗，因为这两层除了 agent 写库还服务于人工编辑 / 导入路径，清洗会误伤合法内容。

### 3. 测试

新增 [tests/shared/utils/markdown.test.ts](tests/shared/utils/markdown.test.ts)，覆盖以下用例：

**Happy path**
- 前言 + `# 标题` + 正文 → 删前言，首字符为 `#`
- 无前言（首行就是 `# 标题`） → 完全不变
- 没有一级标题（纯文本 / 只有二级标题） → 完全不变

**空白处理**
- 前言后**紧跟多个空行**才到 `# 标题` → 空行一起删，输出第一行就是 `# 标题`
- 入参只是空白前缀（`   \n\n# 标题`） → 输出第一行就是 `# 标题`
- 一级标题前的内容只有空白字符（无任何文字） → 同样视为"需要清洗"，结果首行为 `# 标题`

**边界 / 抗误判**
- fenced code block 内有 `# foo`，外面真有一级标题 → 仍找外面那个
- fenced code block 内有 `# foo`，外面没有真一级标题 → 原样返回
- indented code block（4 空格）内的 `# foo` → 不算
- blockquote `> # foo` → 不算
- 多个一级标题 → 只在第一个之前删
- 首行 `#标题`（# 后无空格）→ 不算
- 首行 `#` 单独一行 → 不算

**防御**
- 入参 `null` → 返回 `''`
- 入参 `undefined` → 返回 `''`
- 入参 `''` → 返回 `''`

不另写集成测试。三个接入点的写库流程已有 vitest 套件覆盖（worker 级 DB 隔离），在已有套件中各加一条 happy-path 断言（"含前言的 markdown 写入后，DB 里 `analysisResult` 首字符为 `#`"）即可。

## 不改动

- `summary` 字段（RAG 异步生成的摘要）—— 由 LLM 单独短文本生成，不带一级标题
- `chat_messages` / LangGraph checkpoint 的对话消息体 —— 出于聊天体验考虑保留
- contract / document vertical —— 本次不在范围，将来需要时复用 `stripContentBeforeFirstH1`
- 提示词文件 —— 提示词层"标题前不输出任何内容"约束保留，本次只是兜底
- 前端展示层 —— 不预清洗（前端展示数据库里已经清洗过的内容即可）

## 范围外（留待后续）

- 合同审查 / 文档起草若发现同样问题，复用 `stripContentBeforeFirstH1` 接入
- 历史已落库的旧记录不做回溯清洗（成本与价值不匹配）

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| LLM 输出一级标题嵌在前言代码块里举例（如解释格式时引用 ``` # 案件大事记 ```） | 工具实现已跳过 fenced / indented code block 与 blockquote 内的 `# xxx` |
| 模型偶然输出报告**完全没有**一级标题（如直接用列表/段落开头） | 工具返回原文不动；这种输出本身违反提示词约束，需要在提示词层继续治理，不在本工具职责内 |
| 人工编辑路径误走 agent 写库点 | 人工编辑走的是 `saveAnalysisResultService` / DAO 层，不经 agent 写库点，本设计不影响 |
