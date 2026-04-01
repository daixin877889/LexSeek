# 案件分析结果导出文档 设计文档

## 目标

在案件详情页头部添加导出按钮，点击后弹出导出弹窗，支持模块选择和拖拽排序，将选中的分析结果 Markdown 内容转为 .docx 文件下载。PC 和移动端双端兼容。

## 架构

纯前端方案：从 `analysisResults` 获取分析模块数据 → 弹窗中选择/排序 → 拼接 Markdown → `markdown-docx` 转 .docx → `file-saver` 下载。拖拽排序使用 `vue-draggable-plus`（项目已安装，基于 SortableJS）自动兼容鼠标和触摸。

## 交互流程

1. 案件详情页 header 中添加「导出」按钮（DownloadIcon），仅在有分析结果时可用
2. 点击打开 `CaseExportDialog` 弹窗
3. 弹窗内容：
   - 顶部：标题 + 「选择导出模块」Checkbox 切换选择模式
   - 中部：模块列表，每项有 GripIcon 拖拽手柄 + 模块图标 + 标题，选择模式下显示 Checkbox
   - 底部：「取消」+「确认导出（N个模块）」按钮
4. 确认导出：拼接选中模块 Markdown → 生成 .docx → 浏览器下载 `【LexSeek 分析】{案件标题}.docx`

## 依赖

| 包 | 用途 | 状态 |
|---|---|---|
| `vue-draggable-plus` | 拖拽排序（PC/移动端兼容） | 已安装 v0.6.0 |
| `file-saver` | 文件下载 `saveAs(blob, filename)` | 已安装 v2.0.5 |
| `markdown-docx` | Markdown → docx（主要转换） | 需安装（旧项目用 v1.5.1） |
| `html-docx-js-typescript` | 备用转换（fallback） | 需安装（旧项目用 v0.1.5） |

`marked` 已安装（v17.0.1），用于 fallback 时 Markdown → HTML 转换。

## 数据来源

从 `useCaseDetail` 的 `analysisResults: AnalysisResult[]` 获取，每个结果包含：
- `moduleName` — 模块标识（如"summary"），**用作唯一 key**
- `moduleTitle` — 模块标题（如"案情摘要"）
- `content` — Markdown 格式的分析内容
- `analyzedAt` — 分析时间
- `version` — 版本号

注：`nodeId` 在 init-analysis 场景下固定为 0，不能作为唯一标识，统一使用 `moduleName` 作为 key。

## 组件设计

### CaseExportDialog

**Props：**
- `open: boolean` — v-model 控制弹窗开关
- `title: string` — 案件标题（用于生成文件名）
- `results: AnalysisResult[]` — 分析结果列表

**内部状态：**
- `exportItems: Array<{ moduleName, moduleTitle, content, selected: boolean }>` — 可导出项（弹窗打开时从 results 初始化，默认全选）
- `selectMode: boolean` — 是否处于选择模式（默认 false，显示已选项；true 显示全部可勾选）
- `exporting: boolean` — 导出中状态

**导出逻辑（纯前端，参考旧项目 ExportDocumentDialog）：**
```typescript
import markdownDocx, { Packer } from 'markdown-docx'
import { saveAs } from 'file-saver'
import { asBlob } from 'html-docx-js-typescript'
import { marked } from 'marked'

// 1. 拼接选中模块的 Markdown
let md = `# ${title}\n\n`
for (const item of selectedItems) {
  md += item.content + '\n\n'
}

// 2. 主方案：markdown-docx
try {
  const doc = await markdownDocx(md, { ignoreHtml: true })
  const blob = await Packer.toBlob(doc)
  saveAs(blob, sanitizeFilename(`【LexSeek 分析】${title}.docx`))
} catch {
  // 3. 备用方案：marked → html-docx-js-typescript
  const html = await marked(md)
  const blob = await asBlob(html)
  saveAs(blob, sanitizeFilename(`【LexSeek 分析】${title}.docx`))
}
```

**文件名处理：**
- 替换非法字符（`/\:*?"<>|`）为空格
- 截断至 100 字符
- title 为空时使用 "案件报告" 作为 fallback

### 页面集成

**`[id].vue` 修改：**
- header 中添加导出按钮（DownloadIcon），放在小索图标左侧，PC 和移动端均显示
- `analysisResults.length > 0` 时按钮可用，否则 disabled
- 点击设置 `showExportDialog = true`
- 弹窗组件传入 `caseInfo.title` 和 `analysisResults`

## 错误处理

- 无分析结果时按钮禁用
- 未选择任何模块时导出按钮禁用
- markdown-docx 失败时自动尝试 html-docx-js-typescript 备用方案
- 备用方案也失败时 toast 提示错误
- 导出期间按钮显示 loading 状态，防止重复点击

## 文件清单

| 文件 | 操作 |
|------|------|
| `app/components/caseDetail/CaseExportDialog.vue` | 新建 |
| `app/pages/dashboard/cases/[id].vue` | 修改：添加导出按钮和弹窗 |
| `package.json` | 修改：安装 markdown-docx、html-docx-js-typescript |
