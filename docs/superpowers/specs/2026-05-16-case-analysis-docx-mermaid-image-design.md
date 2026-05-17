# 案件分析导出 Word 时 Mermaid 图表转图片

> 日期：2026-05-16
> 状态：设计已确认 + 经 5 维度审查修订，待写实施计划

## 背景与目标

案件分析结果支持导出为 Word 文档（`CaseExportDialog.vue`）。当前导出流程把选中的分析模块内容拼成 Markdown，再用 `markdown-docx` 转 docx（失败时回退到 `marked` + `html-docx-js`）。

分析内容里包含 Mermaid 图表（以 ` ```mermaid ` 围栏代码块形式存在）。当前导出后这些图表只会以**原始代码文本**出现在 Word 里，用户看不到图形。

**目标**：导出 Word 时，把 Mermaid 图表渲染成图片嵌入文档，让用户在 Word 里直接看到图形。

## 现状

- **导出入口**：`app/components/caseDetail/CaseExportDialog.vue` 的 `executeExport`，在 `app/pages/dashboard/cases/[id].vue` 中使用。经审查确认是案件分析 Word 导出的**唯一**入口（`app/components/case/FloatingActions.vue` 含导出 UI 但无任何引用，是孤儿组件，不构成入口）。
- **现有转换能力**：`app/composables/useMermaidHdPng.ts` 已有一套成熟的「Mermaid 源码 → SVG → 高清 PNG」逻辑（修正过 viewBox 缺失、DPR、中文/emoji 编码、canvas tainted 等坑），服务于「小索对话内的 PNG 下载」。其中 `extractViewBoxSize` / `injectSvgDimensions` 已对外导出，`renderToSvg` / `loadSvgImage` / `svgToDataUrl` / `svgToPngBlob` 等为内部私有函数。
- **依赖现状**：`markdown-docx@1.5.1`、`mermaid@11.x`、`html-docx-js-typescript@0.1.5`、`marked@17.x`、`file-saver@2.x` 均已在 `package.json`，本设计**不引入新依赖**。
- **为何不复用合同模块的 docx 基建**：合同模块的 docx 能力（`server/agents/contract/docx/`、`textToDocx.service.ts`）是**服务端**对「已上传的 Word 文件」做 OOXML 批注 / 修订改写，不渲染 Markdown、不嵌入图片，与本需求「浏览器端 Markdown → 含图 docx」是不同关注点，不可复用。浏览器端 Markdown → docx 用 `markdown-docx` 是正确选择。

## 方案选型

采用**方案 B：抽取可复用的「Markdown → 含图 docx」composable**。

- 方案 A（内联在导出对话框里）：改动集中，但不利于未来其它导出场景复用。
- **方案 B（采纳）**：把「Mermaid 预渲染 + docx 打包」整体封装成 `useMarkdownDocxExport` composable，未来合同审查、文档起草等导出可复用。
- 方案 C（服务端渲染）：需无头浏览器 / mermaid-cli，依赖重；导出本就在浏览器端完成，**排除**。

## 关键技术结论（来自 5 维度审查的源码调研）

以下结论经核对 `markdown-docx@1.5.1` 源码与项目代码得出，是本次设计修订的依据：

1. **不需要自定义 `imageAdapter`**。`markdown-docx` 默认图片下载器 `downloadImage` 内部用浏览器原生 `fetch(href)` 取图——`fetch()` 原生支持 `data:image/png;base64,...` 这类 data URL。因此只要把 Mermaid 图渲染成 **data URL 图片**写进 Markdown，默认下载器即可正确解码嵌入，**无需传任何自定义 `imageAdapter`**。
2. **传自定义 `imageAdapter` 会整体替换默认下载器且无兜底**——一旦传入，真实图片 `![](https://…)` 若不被该 adapter 处理会被静默降级成字面文本、图丢失。改用 data URL 方案后规避了这个坑：默认下载器始终在位，真实图片照常可导出。
3. **图片显示尺寸用 image token 的 `title` 控制**。`markdown-docx` 的 `parseImageTitleSize` 支持 `![alt](url "宽x高")` 语法，title 里的 `宽x高` 会覆盖图片在 Word 里的显示尺寸（单位像素）。无需自定义 adapter 也能把图钳制到正文宽度。
4. **案件分析正文不含真实 markdown 图片**。分析内容由 AI 纯文本生成（`saveAnalysisResult.tool.ts` 只落库 LLM 文本）；分析模块 system prompt 明确铁律「关系图/流程图/时间轴等强制用 Mermaid」；用户素材图走 OCR 转文字进分析、不以外链回到正文。因此分析正文除 ` ```mermaid ` 围栏块外不会出现 `![](url)`。即便如此，data URL 方案因保留了默认下载器，未来正文若出现真实图片也能正常导出。
5. **`html-docx-js-typescript` 支持 data URL 图片**。其 `utils.js` 用正则把 `<img src="data:…">` 抽成 MHT 图片部件嵌入。回退路径用同一份 data URL Markdown 即可嵌图（仅显示尺寸不受 `title` 控制，见「失败与回退处理」）。

**修订要点**：原设计的「自定义 `imageAdapter` + 内存图片表 + 占位符 key 唯一性」整套机制被**删除**，改为「Mermaid 块替换成带尺寸 title 的 data URL 图片」。主路径与回退路径共用同一份 Markdown，设计大幅简化。

## 架构与模块划分

| 文件 | 类型 | 职责 |
|------|------|------|
| `app/utils/mermaidMarkdown.ts` | 新增·纯函数 | `extractMermaidBlocks(md)`：扫描 Markdown 里所有 ` ```mermaid ` 围栏块（容忍缩进、语言标记尾随空格）；`replaceMermaidBlocks(md, results)`：把成功渲染的块替换成 `![diagram](dataURL "宽x高")`，失败的块原样保留代码。纯字符串逻辑，可单测、可 fast-check |
| `app/lib/mermaidRaster.ts` | 新增 | Mermaid 渲染工具。`mermaidToPng(code, { theme, scale })`：Mermaid 源码 → `mermaid.render` 出 SVG → 修正 viewBox/尺寸 → canvas 栅格化（含 DPR、`MAX_CANVAS_SIDE` 钳制、data URL 编码避坑）→ 返回 `{ dataUrl, blob, width, height }`。内含纯辅助 `extractViewBoxSize` / `injectSvgDimensions` / `clampDiagramSize`（单独导出供单测）。文件含 DOM 副作用，定位为渲染工具而非纯工具 |
| `app/composables/useMarkdownDocxExport.ts` | 新增·编排层 | 对外暴露 `exportMarkdownToDocx(markdown, filename)`。内部：预处理 Mermaid → 主路径打包 → 回退路径 → 触发下载。这是方案 B 的可复用层 |
| `app/composables/useMermaidHdPng.ts` | 修改 | 删除自带的 SVG→PNG 私有实现，改为复用 `mermaidRaster.ts` 的 `mermaidToPng`（传自己的 `scale`）。对外 `exportHd` / `markdownControls` 接口与行为**保持不变** |
| `app/components/caseDetail/CaseExportDialog.vue` | 修改 | `executeExport` 里现有的 markdown-docx / 回退两段逻辑，替换成一行 `exportMarkdownToDocx(...)` 调用 |

设计要点：
- **栅格化逻辑只保留一份**——SVG→PNG 那套「坑」修复（viewBox/DPR/编码/canvas tainted）下沉到 `mermaidRaster.ts`，Word 导出与小索对话 PNG 下载共用。`mermaidToPng` 以 `{ theme, scale }` 参数化，两个调用方各传各的值（导出用浅色 + 约 2× 倍率，下载沿用现状）；这是「抽取共用」而非「复刻一份」，规避重复造轮子。重构保持 `useMermaidHdPng` 公开 API 不变，靠 `nuxi typecheck` 与迁移后的单测防回归。
- **纯逻辑与渲染分离**——Markdown 围栏块扫描/替换（`mermaidMarkdown.ts`）是纯字符串逻辑、独立成文件且全量单测；DOM 栅格化（`mermaidRaster.ts`）靠 E2E 覆盖。

## 导出数据流

`exportMarkdownToDocx` 内部流程：

```
1. 拼接选中模块 → 完整 Markdown
2. extractMermaidBlocks(md)：扫描所有 ```mermaid 围栏块
3. 逐个 mermaidToPng(code, { theme: 'default', scale })
   ├─ 成功 → 得到 PNG 的 data URL + 由 viewBox 算出的显示宽高
   └─ 失败 → 该块标记为「保留原始代码」
4. replaceMermaidBlocks：
   ├─ 成功的块 → 替换成 ![diagram](data:image/png;base64,... "宽x高")
   └─ 失败的块 → 原样保留 ```mermaid 代码
5. 主路径：markdownDocx(processedMd, { ignoreHtml }) —— 不传 imageAdapter，
   默认下载器 fetch 解码 data URL 嵌图；title 的「宽x高」控制显示尺寸
6. 主路径整体抛错时回退：marked(processedMd) → html-docx-js asBlob
   （同一份 processedMd，data URL 图经 MHT 嵌入）
7. Packer.toBlob / asBlob → file-saver 下载
```

## 关键设计点

- **强制浅色主题**：Word 是白底，导出时 Mermaid 固定用 `default` 主题，**不跟随** App 明暗模式（避免深色图表贴白纸看不清）。这是与 `useMermaidHdPng` 的行为差异——后者跟随 App 主题，导出场景显式传 `theme: 'default'`。
- **图片尺寸**：从图表 viewBox 算宽高比，`clampDiagramSize` 把显示宽度钳制到 Word 正文宽度（A4 竖版约 600px），高度按比例缩放，写进 image token 的 `title`。PNG 实际栅格分辨率取约 2× 显示尺寸以保证清晰，**不沿用** `useMermaidHdPng` 默认的 `5 × DPR`（会让 docx 体积过大）。
- **围栏块识别**：`extractMermaidBlocks` 用稳健的围栏正则匹配 ` ```mermaid ` 块（容忍语言标记后的尾随空格、缩进），与 `markstream-vue` / `markdown-docx` 对 mermaid 代码块的判定保持一致。

## 失败与回退处理

| 失败层级 | 处理 |
|---------|------|
| 单个图表渲染失败（语法错误等） | 该块**保留原始 ` ```mermaid ` 代码**（产品确认），不中断导出，其它图表正常转图 |
| 主路径 `markdown-docx` 整体抛错 | 回退 `marked` + `html-docx-js`，**复用同一份已替换好 data URL 的 Markdown**，无额外代码——data URL 图经 html-docx-js 的 MHT 处理嵌入 |
| 整个导出失败 | 沿用现有的 `toast.error('导出文档失败，请稍后重试')` |

说明：回退路径里图片靠 data URL 内嵌——`html-docx-js` 能嵌入，但 `marked` 生成的 `<img>` 不带 width/height（image token 的 `title` 不会变成尺寸属性），图片按 PNG 栅格原始像素显示，可能偏大。回退仅在主路径整体崩溃时触发，属极少命中的兜底路径，文字内容不受影响，此降级可接受；**不为此再加图片尺寸注入逻辑**（避免为罕见路径过度设计）。

## 测试策略

项目要求 TDD（先写测试）。

| 层级 | 覆盖对象 | 说明 |
|------|---------|------|
| 单元测试 | `mermaidMarkdown.ts` 纯函数 | `extractMermaidBlocks` / `replaceMermaidBlocks`。用例：无 mermaid、单个/多个块、带缩进、语言标记尾随空格、空代码块、渲染失败保留原码；替换逻辑加 fast-check 模糊测试，保证不破坏非 mermaid 内容 |
| 单元测试 | `mermaidRaster.ts` 纯辅助 | `extractViewBoxSize` / `injectSvgDimensions` / `clampDiagramSize`（从 `useMermaidHdPng` 迁移而来的纯函数） |
| E2E（chrome-devtools） | 整条导出链路 | 打开案件详情 → 导出对话框 → 导出 → 校验 docx。canvas 栅格化和 mermaid 渲染只有真实浏览器能跑 |
| 不写单测 | `mermaidToPng` / `useMarkdownDocxExport` 编排 | jsdom 下 canvas 是 stub，无法真实栅格化，靠 E2E 覆盖 |

已有 `tests/app/composables/useMermaidHdPng.test.ts` 测的是 `extractViewBoxSize` / `injectSvgDimensions`——这两个函数搬到 `mermaidRaster.ts` 后，对应测试迁移到 `tests/app/lib/mermaidRaster.test.ts` 并更新 import 路径。

## 完整改动清单

```
新增  app/utils/mermaidMarkdown.ts                   纯函数：围栏块扫描 / 替换为 data URL 图片
新增  app/lib/mermaidRaster.ts                       Mermaid 源码 → PNG data URL（DOM 栅格化 + 纯辅助）
新增  app/composables/useMarkdownDocxExport.ts        编排：预处理 → 打包 → 回退 → 下载
改    app/composables/useMermaidHdPng.ts              复用 mermaidRaster.ts，删重复实现
改    app/components/caseDetail/CaseExportDialog.vue  executeExport 改调新 composable
新增  tests/app/utils/mermaidMarkdown.test.ts         围栏块扫描/替换单元测试
新增  tests/app/lib/mermaidRaster.test.ts             viewBox/尺寸纯辅助单元测试（含迁移用例）
改    tests/app/composables/useMermaidHdPng.test.ts   移除已迁出的 helper 测试
```

> 项目已关闭自动导入扫描，新增的 composable / utils / lib 在使用处均需**显式 import**。

## 收尾验收

- `npx nuxi typecheck` 通过。
- `simplify` 技能过一遍代码。
- E2E 验证：导出的 docx 中 Mermaid 图表显示为图片、尺寸适配正文宽度；语法错误的图表保留代码块；正文其余文字与格式正常。
- 回归冒烟：`useMermaidHdPng` 重构后，手动验证小索对话内的「PNG 下载」仍正常（E2E 未覆盖此入口）。
