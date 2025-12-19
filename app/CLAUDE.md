[根目录](../../CLAUDE.md) > **app**

# App 模块

## 模块职责

App 模块是 LexSeek 的前端核心模块，负责：
- Vue 页面组件和路由
- UI 组件库（基于 Shadcn-vue）
- 前端工具函数和共享逻辑
- 静态资源管理

## 入口与启动

- **应用入口**: Nuxt 自动从 `pages/` 目录生成路由
- **布局文件**: `layouts/dashboard.vue`, `layouts/baseLayout.vue`
- **插件配置**: `plugins/ssr-width.ts` - SSR 宽度适配

## 目录结构

```
app/
├── assets/          # 静态资源
│   ├── css/        # 样式文件
│   └── features/   # 功能展示图片
├── components/      # Vue组件
│   ├── ui/         # UI组件库
│   └── icons/      # 图标组件
├── layouts/         # 布局模板
├── lib/            # 库文件
├── pages/          # 页面路由
└── utils/          # 工具函数
```

## 对外接口

### 页面路由
- `/` - 首页
- `/features` - 产品功能展示
- `/privacy-agreement` - 隐私协议
- `/terms-of-use` - 服务条款
- `/reset-password` - 密码重置
- `/register` - 用户注册

### UI组件库

#### 基础组件
- `Button` - 按钮组件
- `Input` - 输入框
- `Dialog` - 对话框
- `AlertDialog` - 确认对话框
- `Sheet` - 侧边抽屉
- `Tooltip` - 工具提示
- `Skeleton` - 骨架屏
- `Separator` - 分割线

#### 复合组件
- `Sidebar` - 侧边栏导航
- `Breadcrumb` - 面包屑导航

## 关键依赖与配置

### 主要依赖
- `@nuxt/image` - 图片优化
- `@vueuse/core` - Vue组合式工具
- `reka-ui` - 无样式UI组件
- `shadcn-nuxt` - Shadcn集成
- `tailwindcss` - CSS框架

### 配置文件
- `nuxt.config.ts` - Nuxt配置
- `tailwind.config.js` - Tailwind配置
- `components.json` - Shadcn组件配置

## 样式系统

### Tailwind CSS
- 主样式文件：`assets/css/tailwind.css`
- 支持深色模式
- 响应式设计（sm/md/lg/xl/2xl）

### 主题定制
- 使用 CSS 变量定义颜色系统
- 组件样式遵循 `class-variance-authority` 规范

## 常见问题 (FAQ)

1. **如何添加新的UI组件？**
   ```bash
   npx shadcn-vue@latest add [组件名]
   ```

2. **如何使用图片优化？**
   ```vue
   <NuxtImg src="/path/to/image" alt="描述" />
   ```

3. **如何处理SSR hydration问题？**
   - 使用 `onMounted` 钩子处理客户端逻辑
   - 使用 `<ClientOnly>` 组件包装纯客户端组件

## 相关文件清单

### 核心页面
- `pages/features.vue` - 功能展示页
- `pages/privacy-agreement.vue` - 隐私协议
- `pages/terms-of-use.vue` - 服务条款
- `pages/reset-password.vue` - 密码重置
- `pages/register.vue` - 用户注册

### 布局
- `layouts/dashboard.vue` - 仪表板布局
- `layouts/baseLayout.vue` - 基础布局

### 工具函数
- `utils/logger.ts` - 日志工具
- `lib/utils.ts` - 通用工具函数

## 变更记录 (Changelog)

**2025-12-19**: 初始化 app 模块文档