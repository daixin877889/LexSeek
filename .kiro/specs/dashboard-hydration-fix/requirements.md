# 需求文档

## 简介

解决 Dashboard 布局组件中的 Nuxt 水合（Hydration）不匹配问题。当前实现在 `navUserRight.vue`、`navUser.vue` 和 `dashboard.vue` 中使用 `useMediaQuery` 检测屏幕宽度来条件渲染内容，导致 SSR 和客户端水合时 DOM 结构不一致。

## 术语表

- **Hydration（水合）**: Nuxt/Vue SSR 中，客户端接管服务端渲染的 HTML 并使其具有交互性的过程
- **SSR（服务端渲染）**: 在服务器上生成 HTML 内容的技术
- **Media_Query**: 用于检测屏幕宽度的 CSS/JS 技术
- **isMobile**: 基于 Media Query 判断当前是否为移动设备的响应式变量
- **Sidebar_Provider**: 提供侧边栏状态和 isMobile 检测的上下文组件
- **ClientOnly**: Nuxt 提供的组件，用于仅在客户端渲染内容

## 需求

### 需求 1：SSR 安全的响应式布局

**用户故事：** 作为用户，我希望页面在任何设备上加载时都不会出现闪烁或布局跳动。

#### 验收标准

1. THE Sidebar_Provider SHALL 在 SSR 阶段提供一个稳定的默认 isMobile 值
2. WHEN 客户端水合完成后，THE Sidebar_Provider SHALL 更新 isMobile 为真实的屏幕宽度检测结果
3. THE Dashboard_Layout SHALL 确保 SSR 和客户端初始渲染的 DOM 结构一致

### 需求 2：移动端导航组件水合一致性

**用户故事：** 作为移动端用户，我希望导航菜单能正确显示，不会出现水合警告。

#### 验收标准

1. THE NavUserRight_Component SHALL 使用 ClientOnly 包裹仅客户端渲染的内容
2. WHEN 在 SSR 阶段，THE NavUserRight_Component SHALL 渲染一个占位符或骨架屏
3. WHEN 客户端水合完成，THE NavUserRight_Component SHALL 显示完整的用户菜单

### 需求 3：桌面端导航组件水合一致性

**用户故事：** 作为桌面端用户，我希望侧边栏用户菜单能正确显示。

#### 验收标准

1. THE NavUser_Component SHALL 使用 ClientOnly 包裹依赖 isMobile 的内容
2. THE NavUser_Component SHALL 确保 DropdownMenu 的 side 属性在 SSR 和客户端一致

### 需求 4：Dashboard 布局水合一致性

**用户故事：** 作为用户，我希望 Dashboard 页面加载时布局稳定，不会出现元素闪烁。

#### 验收标准

1. THE Dashboard_Layout SHALL 使用 CSS 而非 v-if 来处理响应式显示/隐藏
2. WHERE 必须使用 v-if 基于 isMobile 条件渲染，THE Dashboard_Layout SHALL 使用 ClientOnly 组件包裹
3. THE Dashboard_Layout SHALL 确保 header 中的元素在 SSR 和客户端数量一致

### 需求 5：用户体验优化

**用户故事：** 作为用户，我希望在等待客户端渲染完成时有良好的视觉反馈。

#### 验收标准

1. WHEN 使用 ClientOnly 时，THE Component SHALL 提供合适的 fallback 占位内容
2. THE Fallback_Content SHALL 与最终内容尺寸相近，避免布局跳动
3. IF 无法提供占位内容，THEN THE Component SHALL 使用 CSS visibility 而非 display 隐藏

