# 案件分析导出 Word 时 Mermaid 图表转图片

> 日期：2026-05-16
> 状态：设计已确认，待写实施计划

## 背景与目标

案件分析结果支持导出为 Word 文档（`CaseExportDialog.vue`）。当前导出流程把选中的分析模块内容拼成 Markdown，再用 `markdown-docx` 转 docx（失败时回退到 `marked` + `html-docx-js`）。

分析内容里包含 Mermaid 图表（以 ` ```mermaid ` 围栏代码块形式存在）。当前导出后这些图表只会以**原始代码文本**出现在 Word 里，用户看不到图形。

**目标**：导出 Word 时，把 Mermaid 图表渲染成图片嵌入文档，让用户在 Word 里直接看到图形。

## 现状

- **导出入口**：`app/components/caseDetail/CaseExportDialog.vue` 的 `executeExport`，在 `app/pages/dashboard/cases/[id].vue` 中使用。是目前唯一的案件分析 Word 导出入口。
- **现有转换能力**：`app/composables/useMermaidHdPng.ts` 已有一套成熟的「Mermaid 源码 → SVG → 高清 PNG」逻辑（修正过 viewBox 缺失、DPR、中文/emoji 编码、canvas tainted 等坑），但这套逻辑是 composable 内部私有函数，且耦合了 App 明暗模式、`toast`、浏览器下载。
- **关键扩展点**：`markdown-docx@1.5.1` 提供 `imageAdapter` 钩子——`(token: Tokens.Image) => Promise<MarkdownImageItem | null>`，`MarkdownImageItem = { type, data, width, height }`，`data` 可为 `Uint8Array`。这是把 PNG 字节喂进 docx 的官方扩展点。

## 方案选型

采用**方案 B：抽取可复用的「Markdown → 含图 docx」composable**。

- 方案 A（内联在导出对话框里）：改动集中，但不利于未来其它导出场景复用。
- **方案 B（采纳）**：把「Mermaid 预渲染 + imageAdapter + docx 打包」整体封装成 `useMarkdownDocxExport` composable，未来合同审查、文档起草等导出可复用。
- 方案 C（服务端渲染）：需无头浏览器 / mermaid-cli，依赖重；导出本就在浏览器端完成，**排除**。

## 架构与模块划分

按职责单一原则拆成 4 个文件：

| 文件 | 类型 | 职责 |
|------|------|------|
| `app/utils/mermaidImage.ts` | 新增·纯函数 | ① `mermaidToPng(code, { theme, scale })`：Mermaid 源码 → SVG → 修正 viewBox/DPR → canvas 栅格化 → `{ data, width, height }`；② `extractMermaidBlocks(md)` / `replaceMermaidBlocks(md, ...)`：扫描和替换 ` ```mermaid ` 围栏块的纯字符串逻辑；③ `extractViewBoxSize` / `injectSvgDimensions`：从 `useMermaidHdPng.ts` 搬迁的纯辅助函数 |
| `app/composables/useMarkdownDocxExport.ts` | 新增·编排层 | 对外暴露 `exportMarkdownToDocx(markdown, filename)`。内部：预处理 Mermaid → 主路径打包 → 回退路径 → 触发下载。这是方案 B 的可复用层 |
| `app/composables/useMermaidHdPng.ts` | 修改 | 删除自带的「SVG→PNG」实现，改为复用 `mermaidImage.ts`。对外 `exportHd` / `markdownControls` 接口不变 |
| `app/components/caseDetail/CaseExportDialog.vue` | 修改 | `executeExport` 里现有的 markdown-docx / 回退两段逻辑，替换成一行 `exportMarkdownToDocx(...)` 调用 |

设计要点：
- **转换逻辑只保留一份**——下沉到 `mermaidImage.ts` 后，Word 导出和小索对话内的高清 PNG 下载共用同一份实现。
- **纯逻辑与编排分离**——`mermaidImage.ts` 全是无副作用纯函数（易测试、可 fast-check 模糊测试）；`useMarkdownDocxExport.ts` 只做编排与 IO。

## 导出数据流

`exportMarkdownToDocx` 内部流程：

```
1. 拼接选中模块 → 完整 Markdown
2. extractMermaidBlocks(md)：扫描所有 ```mermaid 围栏块
3. 逐个 mermaidToPng(code, { theme: 'default', scale })
   ├─ 成功 → PNG 字节存入内存图片表，记 { 占位符key → {data,width,height} }
   └─ 失败 → 该块标记为「保留原始代码」
4. replaceMermaidBlocks：
   ├─ 成功的块 → 替换成图片占位符 ![diagram](key)
   └─ 失败的块 → 原样保留 ```mermaid 代码
5. 主路径：markdownDocx(processedMd, { imageAdapter, ignoreHtml })
   imageAdapter 收到图片 token → 从内存图片表按 key 取 PNG 字节返回
6. Packer.toBlob → file-saver 下载
```

## 关键设计点

- **强制浅色主题**：Word 是白底，导出时 Mermaid 固定用 `default` 主题，**不跟随** App 明暗模式（避免深色图表贴白纸看不清）。这是与 `useMermaidHdPng` 的行为差异——后者跟随 App 主题，导出场景需显式传 `theme: 'default'`。
- **图片尺寸**：从图表 viewBox 算宽高比，`MarkdownImageItem` 的显示宽度钳制到 Word 正文宽度（A4 竖版约 600px），高度按比例缩放。PNG 实际栅格分辨率取显示尺寸的约 2 倍以保证清晰，**不沿用** `useMermaidHdPng` 默认的 `5 × DPR` 倍率（会让 docx 体积爆掉）。
- **围栏块识别**：`mermaidImage.ts` 用稳健的围栏正则匹配 ` ```mermaid ` 块（容忍语言标记后的尾随空格、缩进），与 `markstream-vue` / `markdown-docx` 对 mermaid 代码块的判定保持一致。
- **占位符 key 唯一性**：替换用的占位符 key 需保证不与原文已有的图片链接冲突（如带随机后缀），imageAdapter 仅对自己生成的 key 做映射，其它图片 token 返回 `null` 走默认处理。

## 失败与回退处理

| 失败层级 | 处理 |
|---------|------|
| 单个图表渲染失败（语法错误等） | 该块**保留原始 ` ```mermaid ` 代码**（产品确认），不中断导出，其它图表正常转图 |
| 主路径 `markdown-docx` 整体抛错 | 回退 `marked` + `html-docx-js`；图表以 base64 data URL 形式内嵌（复用同一批已渲染好的 PNG，不重复渲染） |
| 整个导出失败 | 沿用现有的 `toast.error('导出文档失败，请稍后重试')` |

说明：回退路径里图片靠 data URL 内嵌，`html-docx-js` 对 data URL 图片的支持不如主路径稳定——但回退仅在主路径崩溃时触发，且文字内容不受影响，可接受这一降级。

## 测试策略

项目要求 TDD（先写测试）。

| 层级 | 覆盖对象 | 说明 |
|------|---------|------|
| 单元测试 | `mermaidImage.ts` 纯函数 | `extractMermaidBlocks` / `replaceMermaidBlocks` / `extractViewBoxSize` / `injectSvgDimensions`。用例：无 mermaid、单个/多个块、带缩进、语言标记尾随空格、空代码块、渲染失败保留原码；替换逻辑加 fast-check 模糊测试，保证不破坏非 mermaid 内容 |
| E2E（chrome-devtools） | 整条导出链路 | 打开案件详情 → 导出对话框 → 导出 → 校验 docx。canvas 栅格化和 mermaid 渲染只有真实浏览器能跑 |
| 不写单测 | `mermaidToPng` / `useMarkdownDocxExport` 编排 | jsdom 下 canvas 是 stub，无法真实栅格化，靠 E2E 覆盖 |

已有 `tests/app/composables/useMermaidHdPng.test.ts` 测的是 `extractViewBoxSize` / `injectSvgDimensions`——这两个函数搬到 `mermaidImage.ts` 后，对应测试迁移到 `tests/app/utils/mermaidImage.test.ts` 并更新 import 路径。

## 完整改动清单

```
新增  app/utils/mermaidImage.ts                      纯函数：mermaid→PNG + 围栏块扫描/替换
新增  app/composables/useMarkdownDocxExport.ts        编排：预处理→打包→回退→下载
改    app/composables/useMermaidHdPng.ts              复用 mermaidImage.ts，删重复实现
改    app/components/caseDetail/CaseExportDialog.vue  executeExport 改调新 composable
新增  tests/app/utils/mermaidImage.test.ts            纯函数单元测试
改    tests/app/composables/useMermaidHdPng.test.ts   迁移/精简（helper 已搬走）
```

## 收尾验收

- `npx nuxi typecheck` 通过。
- `simplify` 技能过一遍代码。
- E2E 验证：导出的 docx 中 Mermaid 图表显示为图片，语法错误的图表保留代码块。
