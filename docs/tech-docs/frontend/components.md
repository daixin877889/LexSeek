# 前端组件体系

LexSeek 前端组件采用按业务域划分的目录结构，共约 770 个 `.vue` 文件，分布在 24 个顶层目录中，覆盖管理后台、AI 交互、案件管理、会员支付等核心业务场景。

## 目录总览

```
app/components/
├── admin/            # 32 个组件 - 管理后台
├── ai/               # 18 个组件 - AI 功能入口
├── ai-elements/      # 381 个组件 - AI 交互元素库（50 子目录）
├── auth/             # 1 个组件 - 认证相关
├── case/             # 16 个组件 - 案件通用组件
├── caseAnalysis/     # 12 个组件 - 案件分析
├── caseCreation/     # 3 个组件 - 案件创建
├── caseDetail/       # 8 个组件 - 案件详情
├── cases/            # 6 个组件 - 案件列表
├── dashboard/        # 5 个组件 - 仪表盘
├── diskSpace/        # 6 个组件 - 磁盘空间管理
├── general/          # 14 个组件 - 通用业务组件
├── icon/             # 2 个组件 - 图标组件
├── icons/            # 9 个组件 - 业务图标集
├── initAnalysis/     # 5 个组件 - 初始分析
├── legal/            # 5 个组件 - 法律知识
├── legal-search/     # 6 个组件 - 法律搜索
├── membership/       # 8 个组件 - 会员管理
├── order/            # 4 个组件 - 订单管理
├── payment/          # 1 个组件 - 支付组件
├── points/           # 9 个组件 - 积分系统
├── purchase/         # 1 个组件 - 购买流程
├── redeem/           # 4 个组件 - 兑换码
└── ui/               # 214 个组件 - shadcn-vue 基础组件（40 子目录）
```

## 组件分类详解

### 1. ui/ - shadcn-vue 基础组件（禁止修改）

`ui/` 目录包含 214 个由 shadcn-vue 管理的基础 UI 组件，分布在 40 个子目录中：

```
ui/
├── accordion/        # 手风琴
├── alert/            # 警告提示
├── alert-dialog/     # 警告对话框
├── avatar/           # 头像
├── badge/            # 徽标
├── breadcrumb/       # 面包屑
├── button/           # 按钮
├── button-group/     # 按钮组
├── calendar/         # 日历
├── card/             # 卡片
├── carousel/         # 轮播
├── checkbox/         # 复选框
├── collapsible/      # 折叠面板
├── combobox/         # 组合框
├── command/          # 命令面板
├── dialog/           # 对话框
├── dropdown-menu/    # 下拉菜单
├── hover-card/       # 悬浮卡片
├── input/            # 输入框
├── input-group/      # 输入组
├── label/            # 标签
├── native-select/    # 原生选择器
├── popover/          # 弹出层
├── progress/         # 进度条
├── radio-group/      # 单选组
├── resizable/        # 可调整大小
├── scroll-area/      # 滚动区域
├── select/           # 选择器
├── separator/        # 分隔线
├── sheet/            # 侧边面板
├── sidebar/          # 侧边栏
├── skeleton/         # 骨架屏
├── sonner/           # 消息通知
├── stepper/          # 步骤条
├── switch/           # 开关
├── table/            # 表格
├── tabs/             # 标签页
├── textarea/         # 文本域
├── tiptap/           # 富文本编辑器
└── tooltip/          # 工具提示
```

**重要规则**：
- `ui/` 下的组件由 shadcn-vue 工具安装和管理
- **严禁手动修改**这些组件，因为重新安装时会被覆盖
- 自定义 UI 需求应在 `ui/` 之外的目录创建新组件

### 2. ai-elements/ - AI 交互元素库

`ai-elements/` 是项目中最大的组件模块，包含 381 个组件，分布在 50 个子目录中。这是一套完整的 AI 对话和交互 UI 组件库：

```
ai-elements/
├── agent/            # Agent 执行展示
├── artifact/         # 生成产物展示
├── attachments/      # 附件管理
├── audio-player/     # 音频播放器
├── canvas/           # 画布组件
├── chain-of-thought/ # 思维链展示
├── checkpoint/       # 检查点组件
├── code-block/       # 代码块
├── commit/           # 提交组件
├── confirmation/     # 确认组件
├── connection/       # 连接状态
├── context/          # 上下文管理
├── controls/         # 控制面板
├── conversation/     # 对话组件
├── edge/             # 边缘组件
├── environment-variables/ # 环境变量
├── file-tree/        # 文件树
├── image/            # 图片展示
├── inline-citation/  # 行内引用
├── loader/           # 加载器
├── message/          # 消息组件
├── mic-selector/     # 麦克风选择器
├── model-selector/   # 模型选择器
├── node/             # 节点组件
├── open-in-chat/     # 在聊天中打开
├── package-info/     # 包信息
├── panel/            # 面板组件
├── persona/          # 角色设定
├── plan/             # 计划组件
├── prompt-input/     # 提示输入
├── queue/            # 队列管理
├── reasoning/        # 推理展示
├── sandbox/          # 沙箱环境
├── schema-display/   # 结构展示
├── shimmer/          # 闪烁效果
├── snippet/          # 代码片段
├── sources/          # 来源引用
├── speech-input/     # 语音输入
├── stack-trace/      # 堆栈追踪
├── suggestion/       # 建议组件
├── task/             # 任务组件
├── terminal/         # 终端组件
├── test-results/     # 测试结果
├── tool/             # 工具组件
├── toolbar/          # 工具栏
├── transcription/    # 转写组件
├── voice-selector/   # 语音选择器
└── web-preview/      # 网页预览
```

**@repo/shadcn-vue 别名映射**：

`ai-elements/` 中的组件使用 `@repo/shadcn-vue` 路径导入基础 UI 组件和工具函数。在 `nuxt.config.ts` 中配置了别名映射：

```typescript
// nuxt.config.ts
alias: {
    '@repo/shadcn-vue/lib': resolve(__dirname, 'app/lib'),
    '@repo/shadcn-vue/components/ui': resolve(__dirname, 'app/components/ui'),
}
```

这使得 ai-elements 组件可以使用如下导入方式：
```typescript
import { Button } from '@repo/shadcn-vue/components/ui/button'
import { cn } from '@repo/shadcn-vue/lib/utils'
```

### 3. 业务域组件

#### 案件管理组件群

| 目录 | 数量 | 职责 |
|------|------|------|
| `case/` | 16 | 案件通用组件（类型选择、状态展示等） |
| `caseCreation/` | 3 | 案件创建流程 |
| `caseDetail/` | 8 | 案件详情页展示 |
| `caseAnalysis/` | 12 | 案件分析结果展示 |
| `cases/` | 6 | 案件列表和筛选 |
| `initAnalysis/` | 5 | 初始化分析流程 |

#### 会员与支付组件群

| 目录 | 数量 | 职责 |
|------|------|------|
| `membership/` | 8 | 会员等级和权益展示 |
| `payment/` | 1 | 支付交互 |
| `purchase/` | 1 | 购买流程 |
| `order/` | 4 | 订单列表和详情 |
| `points/` | 9 | 积分展示和使用 |
| `redeem/` | 4 | 兑换码输入和验证 |

#### 管理后台组件

| 目录 | 数量 | 职责 |
|------|------|------|
| `admin/` | 32 | 后台管理界面（用户管理、系统配置等） |
| `dashboard/` | 5 | 数据概览仪表盘 |

#### 其他业务组件

| 目录 | 数量 | 职责 |
|------|------|------|
| `general/` | 14 | 通用业务组件（页头、页脚、导航等） |
| `legal/` | 5 | 法律知识展示 |
| `legal-search/` | 6 | 法律条文搜索 |
| `diskSpace/` | 6 | 文件存储空间管理 |
| `ai/` | 18 | AI 功能入口和配置 |
| `auth/` | 1 | 认证相关 UI |

## 组件命名约定

### Nuxt 自动注册规则

组件按文件路径转换为 PascalCase 名称自动注册（shadcn-vue 组件除外）：

```
文件路径                                    → 组件名
app/components/diskSpace/FileList.vue      → <DiskSpaceFileList />
app/components/case/StatusBadge.vue        → <CaseStatusBadge />
app/components/admin/UserTable.vue         → <AdminUserTable />
```

shadcn-vue 的 `ui/` 组件使用短名称直接引用：

```vue
<template>
  <Button>按钮</Button>
  <Card>
    <CardHeader>标题</CardHeader>
    <CardContent>内容</CardContent>
  </Card>
</template>
```

### 文件组织原则

- 每个业务域目录内按功能进一步拆分
- 单个组件文件不超过 500 行，超出则拆分子组件
- 复杂业务逻辑提取到 `composables/` 目录
- 组件必须支持深色模式（使用 Tailwind v4 dark 变体）

## 状态管理

业务组件通过 Pinia Store 管理全局状态，Store 文件位于 `app/store/`：

| Store 文件 | 用途 |
|-----------|------|
| `auth.ts` | 用户认证状态 |
| `user.ts` | 用户信息 |
| `role.ts` | 角色权限 |
| `permission.ts` | 权限控制 |
| `caseAnalysis.ts` | 案件分析状态 |
| `file.ts` | 文件管理状态 |
| `adminMenu.ts` | 后台菜单状态 |
| `alertDialog.ts` | 全局对话框状态 |
| `wxSupport.ts` | 微信支持状态 |

## 页面路由

页面组件位于 `app/pages/` 目录，使用 Nuxt 文件系统路由：

```
pages/
├── index.vue              # 首页
├── login.vue              # 登录
├── register.vue           # 注册
├── reset-password.vue     # 重置密码
├── 403.vue                # 权限不足
├── about.vue              # 关于
├── features.vue           # 功能介绍
├── pricing.vue            # 定价
├── admin/                 # 管理后台页面
├── dashboard/             # 仪表盘页面
└── landing/               # 落地页
```

每个页面需定义 `definePageMeta`：

```typescript
definePageMeta({
    layout: 'dashboard',
    title: '页面标题',
    icon: 'IconName',
})
```

## Composables

组件常用的组合式函数位于 `app/composables/`，均通过 Nuxt 自动导入，无需手动 import：

| Composable | 用途 |
|-----------|------|
| `useApi` | SSR 兼容的数据请求 |
| `useApiFetch` | 客户端数据请求（自动提取 data 字段） |
| `useCaseChat` | 案件对话管理 |
| `useCaseCreation` | 案件创建流程 |
| `useCaseDetail` | 案件详情数据 |
| `useFileReader` | 文件读取 |
| `useFileRecognition` | 文件识别 |
| `useFileUploadWorker` | 文件上传 Worker |
| `useLegalParser` | 法律文档解析 |
| `useInitAnalysis` | 初始分析流程 |
| `useColorMode` | 颜色模式切换 |
| `useFormatters` | 格式化工具 |
| `useDraggableResize` | 拖拽调整大小 |
| `useCrossTabEvents` | 跨 Tab 事件通信 |

## 注意事项

1. **useApiFetch 陷阱**：`useApiFetch` 会自动提取响应中的 `data` 字段，不需要 `response?.data?.xxx`，直接使用 `response?.xxx`
2. **类型导入**：类型必须使用 `import type` 手动导入，如 `import type { UserInfo } from '#shared/types/user'`
3. **禁止修改 ui/**：shadcn-vue 组件由工具管理，任何修改都会在下次安装时丢失
4. **Tailwind v4**：使用最新的 Tailwind CSS v4 语法和类名
