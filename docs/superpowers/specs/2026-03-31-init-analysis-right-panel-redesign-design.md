# 设计文档：初始化分析页面右侧面板重构 (Init Analysis Right Panel Redesign)

## 1. 背景与目标
当前 `/dashboard/cases/init-analysis/[sessionId]` 页面的右侧面板采用传统的垂直堆叠布局，随着分析模块和案件材料的增加，界面显得杂乱且扩展性差。本方案旨在参照用户提供的“卡片式仪表盘”风格，对右侧面板进行重构，提升视觉质感和信息密度。

### 核心目标：
- **去繁就简**：将长列表转化为紧凑的卡片网格（Grid）。
- **图标化驱动**：利用图标区分材料类型和分析模块，增强直观性。
- **沉浸式阅读**：点击分析模块后，全屏覆盖显示详细结果，提供更好的 Markdown 阅读体验。
- **高度扩展性**：支持动态增加分析模块和案件材料，而不破坏整体布局。

## 2. 视觉规范 (Visual Spec)
- **主题风格**：延续项目的 Shadcn Vue 风格，支持暗色/亮色适配（参考图为深色背景）。
- **布局结构**：
    - **Section 1: 案件信息**：垂直排列，Label (12px, muted) 与 Value (14px, bold) 并排。
    - **Section 2: 案件材料**：2 列网格。卡片背景 `bg-muted/50` 或 `bg-card`，左侧带彩色背景图标，右侧为文件名与属性。
    - **Section 3: 分析结果**：2 列网格。卡片包含大图标 (20px)、模块标题与版本/状态文本。

## 3. 技术方案 (Technical Implementation)

### 3.1 组件重构
1.  **`InitAnalysisCaseInfoCard.vue`**
    - 重构 `<template>`，从简单的 `flex-col` 布局改为 `space-y-3` 的标签对比布局。
    - 支持显示 `extraFields`（动态扩展字段）。
2.  **`InitAnalysisMaterialList.vue`**
    - 从垂直单行列表改为 `grid-cols-2`。
    - 强化图标显示，为不同 MIME 类型配置专属颜色背景。
3.  **`CaseAnalysisResults.vue` (位于 `app/components/case/AnalysisResults.vue`)**
    - 创建一个“概览视图”模式，默认显示卡片网格。
    - 引入 `Overlay` 或 `Drawer` 逻辑，点击卡片后展示原有的 Markdown 内容和操作按钮（复制、重生成）。

### 3.2 数据处理
- 继续沿用 `useInitAnalysis` 组合式函数提供的数据流。
- 对于 `AnalysisResult[]`，按 `nodeId` 渲染对应的卡片。

## 4. 交互流程 (Interaction Flow)
1.  **常驻显示**：右侧面板始终显示 Dashboard 概览。
2.  **预览材料**：点击材料卡片，调用现有的 `openMaterialPreview` 方法弹出全屏预览。
3.  **查看结果**：点击分析卡片，右侧面板内部滑出 (Slide up) 一个覆盖层，显示该模块的完整分析结果。提供“返回”按钮回到概览。

## 5. 待办事项 (Todos)
- [ ] 备份现有组件代码。
- [ ] 修改 `CaseInfoCard` 布局。
- [ ] 修改 `MaterialList` 为网格卡片样式。
- [ ] 重构分析结果展示逻辑。
- [ ] 优化移动端/窄屏下的响应式表现（自动切换回单列）。

---
*Created by Gemini CLI on 2026-03-31*
