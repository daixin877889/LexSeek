# 设计文档：法律法规内容编辑和自动拆分

## 概述

本功能为法律法规管理系统提供全量内容编辑和自动拆分能力。系统采用左右分栏（桌面端）或模式切换（移动端）的布局，左侧使用 RichTextEditor 编辑 Markdown 格式的法律内容，右侧使用 markstream-vue 实时预览拆分后的条文结构。保存时，系统将自动解析内容、拆分成条文、保存到数据库，并触发向量化处理。

## 架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      全量更新编辑页面                          │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │   编辑区（左侧）      │  │     预览区（右侧）            │ │
│  │                      │  │                              │ │
│  │  RichTextEditor      │  │  markstream-vue              │ │
│  │  (Markdown 编辑)     │  │  (拆分预览)                  │ │
│  │                      │  │                              │ │
│  └──────────────────────┘  └──────────────────────────────┘ │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              操作按钮区（保存、取消）                   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  保存处理流程  │
                    └───────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  ┌──────────┐      ┌──────────┐      ┌──────────┐
  │ 内容解析  │      │ 条文保存  │      │ 向量化   │
  │ (Parser) │ ───> │ (Service)│ ───> │ (API)    │
  └──────────┘      └──────────┘      └──────────┘
```

### 技术栈

- **前端框架**: Nuxt 4 + Vue 3
- **UI 组件**: shadcn-vue
- **编辑器**: RichTextEditor (已封装)
- **预览器**: markstream-vue (需安装)
- **布局**: ResizablePanelGroup (shadcn-vue)
- **后端**: H3 + Prisma
- **数据库**: PostgreSQL
- **解析器**: 移植自 lawSplitting.js

## 组件和接口

### 前端组件

#### 1. 全量更新编辑页面 (`/admin/legal-main/[id]/full-update.vue`)

**职责**：
- 提供全量内容编辑界面
- 管理编辑器和预览器的状态同步
- 处理保存和取消操作
- 响应式布局切换

**状态管理**：
```typescript
interface EditorState {
  content: string              // 编辑器内容
  parsedArticles: ParsedArticle[]  // 解析后的条文列表
  parseError: string | null    // 解析错误信息
  saving: boolean              // 保存状态
  hasUnsavedChanges: boolean   // 是否有未保存的更改
}
```

**本地缓存**：
- 使用 localStorage 缓存编辑器内容
- 缓存 key: `legal-editor-draft-${legalId}`
- 缓存 value: 编辑器的 Markdown 内容
- 缓存时机：每次内容变化时自动保存（使用防抖）
- 清除时机：保存成功后、用户退出登录后
- 加载时机：进入编辑页面时，优先加载缓存内容

**关键方法**：
- `loadLegalContent()`: 加载法律法规内容（优先从缓存加载）
- `saveDraftToCache(content: string)`: 保存草稿到本地缓存
- `loadDraftFromCache()`: 从本地缓存加载草稿
- `clearDraftCache()`: 清除本地缓存
- `handleContentChange(content: string)`: 处理内容变化，触发实时解析和缓存保存
- `handleSave()`: 保存内容并拆分，成功后清除缓存
- `handleCancel()`: 取消编辑，返回列表页

#### 2. 法律内容解析器 (`composables/useLegalParser.ts`)

**职责**：
- 封装解析逻辑
- 自动选择解析器（系统一或系统二）
- 提供错误处理

**接口**：
```typescript
interface UseLegalParser {
  parse(content: string): ParsedArticle[]
  parseError: Ref<string | null>
}

interface ParsedArticle {
  type: ArticleType
  l1?: string | null
  l1I?: number | null
  l2?: string | null
  l2I?: number | null
  l3?: string | null
  l3I?: number | null
  l4?: string | null
  l4I?: number | null
  l5?: string | null
  l5I?: number | null
  content?: string | null
  order: number
}
```

#### 3. 条文预览组件 (`components/legal/LegalArticlePreview.vue`)

**职责**：
- 使用 markstream-vue 渲染 Markdown 内容
- 显示拆分后的条文结构
- 按层级缩进展示

**Props**：
```typescript
interface Props {
  articles: ParsedArticle[]
  error?: string | null
}
```

### 后端 API

#### 1. 批量保存条文 API (`/api/v1/admin/legal-articles/batch-save.post.ts`)

**请求**：
```typescript
interface BatchSaveRequest {
  legalId: string
  content: string  // 编辑器的原始 Markdown 内容
  articles: CreateLegalArticleRequest[]
}

interface CreateLegalArticleRequest {
  type: ArticleType
  l1?: string | null
  l1I?: number | null
  l2?: string | null
  l2I?: number | null
  l3?: string | null
  l3I?: number | null
  l4?: string | null
  l4I?: number | null
  l5?: string | null
  l5I?: number | null
  content?: string | null
  order: number
  publishDate?: string | null
  effectiveDate?: string | null
  invalidDate?: string | null
}
```

**响应**：
```typescript
interface BatchSaveResponse {
  success: boolean
  message: string
  data: {
    deleted: number  // 删除的旧条文数量
    created: number  // 创建的新条文数量
  }
}
```

**处理流程**：
1. 验证用户权限
2. 验证请求参数
3. 开启数据库事务
4. 更新 legal_main 表的 content 字段为编辑器内容
5. 删除该法律法规的所有现有条文（软删除）
6. 批量创建新条文
7. 提交事务
8. 触发向量化处理
9. 返回结果

#### 2. 批量向量化 API（已存在）

**路径**: `/api/v1/admin/legal-articles/batch-embed.post.ts`

**请求**：
```typescript
interface BatchEmbedRequest {
  legalId: string
  forceAll?: boolean
}
```

### 服务层

#### 1. 法律内容解析服务 (`server/services/legal/parser.service.ts`)

**职责**：
- 移植 lawSplitting.js 的解析逻辑
- 提供 TypeScript 类型安全的接口
- 处理解析错误

**接口**：
```typescript
// 解析 Markdown 格式文档（系统一）
export function parseDocument(rawText: string): ParsedArticle[]

// 解析司法文档格式（系统二）
export function parseJudicialDocument(rawText: string): ParsedArticle[]

// 自动选择解析器
export function parseContent(rawText: string): ParsedArticle[]

// 中文数字转阿拉伯数字
export function convertChineseNumberToArabic(chineseStr: string): number
```

#### 2. 条文批量保存服务 (`server/services/legal/article.service.ts`)

**职责**：
- 处理条文的批量删除和创建
- 管理数据库事务
- 生成 UUID v7 标识符

**接口**：
```typescript
// 批量保存条文（更新 legal_main.content，删除旧条文，创建新条文）
export async function batchSaveArticles(
  legalId: string,
  content: string,
  articles: CreateLegalArticleRequest[],
  legalInfo: { publishDate?: Date | null; effectiveDate?: Date | null; invalidDate?: Date | null }
): Promise<{ deleted: number; created: number }>

// 更新法律法规的 content 字段
export async function updateLegalContent(legalId: string, content: string): Promise<void>

// 删除法律法规的所有条文（软删除）
export async function deleteArticlesByLegalId(legalId: string): Promise<number>

// 批量创建条文
export async function createArticles(
  legalId: string,
  articles: CreateLegalArticleRequest[],
  legalInfo: { publishDate?: Date | null; effectiveDate?: Date | null; invalidDate?: Date | null }
): Promise<number>
```

## 数据模型

### 法律主表 (legalMain)

```prisma
model legalMain {
  id               String          @id @default(uuid(7))
  name             String
  code             String
  type             String
  category         String?
  content          String          @db.Text
  issuingAuthority String?
  documentNumber   String?
  publishDate      DateTime?       @db.Date
  effectiveDate    DateTime?       @db.Date
  invalidDate      DateTime?       @db.Date
  lastEditedAt     DateTime?       @default(now())
  lastEmbeddingAt  DateTime?
  createdAt        DateTime?       @default(now())
  updatedAt        DateTime?       @default(now()) @updatedAt
  deletedAt        DateTime?
  legalArticles    legalArticles[]
}
```

### 法律条文表 (legalArticles)

```prisma
model legalArticles {
  id              String    @id @default(uuid(7))
  legalId         String
  type            String
  l1              String?
  l1I             Int?
  l2              String?
  l2I             Int?
  l3              String?
  l3I             Int?
  l4              String?
  l4I             Int?
  l5              String?
  l5I             Int?
  order           Int?
  content         String?   @db.Text
  publishDate     DateTime? @db.Date
  effectiveDate   DateTime? @db.Date
  invalidDate     DateTime? @db.Date
  lastEditedAt    DateTime? @default(now())
  lastEmbeddingAt DateTime?
  createdAt       DateTime? @default(now())
  updatedAt       DateTime? @default(now()) @updatedAt
  deletedAt       DateTime?
  legalMain       legalMain @relation(fields: [legalId], references: [id])
}
```

## 正确性属性

*属性是一个特征或行为，应该在系统的所有有效执行中保持为真——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### 属性 1：内容解析一致性

*对于任何*有效的法律内容，如果内容包含 Markdown 标题（#），则解析器应使用系统一进行解析；如果内容包含中文数字标题（一、），则解析器应使用系统二进行解析。

**验证：需求 4.2, 4.3, 8.1, 8.2**

### 属性 2：标签解析正确性

*对于任何*包含特殊标签（>notice<, >header<, >footer<, >annex<）的内容，解析器应将其正确识别并解析为对应类型的条文。

**验证：需求 8.3, 8.4, 8.5, 8.6**

### 属性 3：中文数字转换正确性

*对于任何*包含中文数字的标题，解析器应正确将其转换为阿拉伯数字索引（l1I-l5I），且转换结果应与原始中文数字的数值相等。

**验证：需求 8.7**

### 属性 4：条文保存原子性

*对于任何*法律法规的全量更新操作，删除旧条文和创建新条文应在同一个数据库事务中执行，任何步骤失败都应回滚所有操作。

**验证：需求 6.2, 6.3, 6.5, 9.1, 9.2**

### 属性 5：条文 ID 唯一性

*对于任何*批量保存的条文，每个条文应被分配一个唯一的 UUID v7 标识符，且所有 ID 应互不相同。

**验证：需求 9.4**

### 属性 6：条文顺序正确性

*对于任何*批量保存的条文列表，条文的 order 字段应按照列表顺序从 1 开始递增，且每个条文的 order 值应等于其在列表中的位置（从 1 开始）。

**验证：需求 9.5**

### 属性 7：日期继承正确性

*对于任何*保存的条文，其 publishDate、effectiveDate 和 invalidDate 应继承自所属法律法规的对应日期字段。

**验证：需求 9.3**

### 属性 8：向量化触发正确性

*对于任何*成功保存的条文批次，系统应自动调用批量向量化 API，且向量化失败不应影响条文保存的成功状态。

**验证：需求 6.4, 7.1, 7.4, 11.3**

### 属性 9：实时预览同步性

*对于任何*编辑器内容的变化，预览区应实时更新显示拆分后的条文结构，且更新应在内容变化后立即发生。

**验证：需求 3.4, 4.1**

### 属性 10：响应式布局正确性

*对于任何*窗口宽度，当宽度 ≥768px 时应显示左右分栏布局，当宽度 <768px 时应显示单栏布局并提供模式切换按钮。

**验证：需求 1.2, 5.1, 5.2**

### 属性 11：空内容验证

*对于任何*保存操作，如果编辑器内容为空或仅包含空白字符，系统应拒绝保存并显示错误提示。

**验证：需求 6.1**

### 属性 12：解析错误处理

*对于任何*无效的法律内容，解析器应捕获错误并在预览区显示友好的错误消息，而不是抛出未捕获的异常。

**验证：需求 4.4, 11.1**

### 属性 13：未保存更改提示

*对于任何*有未保存更改的编辑会话，当用户尝试离开页面时，系统应显示确认对话框，防止意外丢失数据。

**验证：需求 10.4**

### 属性 14：操作反馈完整性

*对于任何*用户操作（保存、向量化等），系统应显示相应的状态指示器（加载中、成功、失败），且每个操作应有明确的反馈。

**验证：需求 10.1, 10.2, 10.3, 7.2**

### 属性 15：草稿缓存正确性

*对于任何*编辑会话，编辑器内容应自动缓存到 localStorage，缓存 key 应为 `legal-editor-draft-${legalId}`，且在保存成功或用户退出登录后应清除缓存。

**验证：需求 2.2**

### 属性 16：草稿加载优先级

*对于任何*进入编辑页面的操作，如果存在对应法律法规的缓存草稿，应优先加载缓存内容而不是数据库中的原始内容。

**验证：需求 2.2**

### 属性 17：法律内容同步更新

*对于任何*成功保存的条文批次，legal_main 表的 content 字段应被更新为编辑器的原始 Markdown 内容，确保法律法规的完整内容与拆分后的条文保持一致。

**验证：需求 6.3**

## 错误处理

### 1. 内容解析错误

**场景**：用户输入的内容格式不符合预期，解析器无法正确解析。

**处理**：
- 捕获解析异常
- 在预览区显示友好的错误消息
- 提供错误原因和修复建议
- 不阻止用户继续编辑

### 2. 数据库操作错误

**场景**：保存条文时数据库操作失败（连接超时、约束违反等）。

**处理**：
- 回滚数据库事务
- 记录详细错误日志
- 向用户显示通用错误消息
- 提供重试选项

### 3. 向量化失败

**场景**：条文保存成功，但向量化 API 调用失败。

**处理**：
- 记录错误日志
- 显示警告提示（而非错误）
- 不影响条文保存的成功状态
- 用户可以稍后手动触发向量化

### 4. 网络请求超时

**场景**：保存或向量化请求超时。

**处理**：
- 显示超时提示
- 提供重试按钮
- 记录超时日志
- 考虑增加超时时间配置

### 5. 权限不足

**场景**：用户没有编辑法律法规的权限。

**处理**：
- 在页面加载时检查权限
- 显示权限错误提示
- 禁用编辑和保存功能
- 提供返回列表的选项

## 测试策略

### 单元测试

**测试范围**：
- 解析器函数（parseDocument, parseJudicialDocument）
- 中文数字转换函数（convertChineseNumberToArabic）
- 服务层函数（batchSaveArticles, deleteArticlesByLegalId）

**测试工具**：
- vitest
- fast-check（属性测试）

**测试用例**：
- 解析包含不同层级标题的 Markdown 内容
- 解析包含特殊标签的内容
- 中文数字转换的边界情况
- 数据库事务的回滚机制

### 属性测试

**测试配置**：
- 每个属性测试运行 100 次迭代
- 使用 fast-check 生成随机测试数据

**测试标签格式**：
```typescript
/**
 * Feature: legal-content-split-editor
 * Property 1: 内容解析一致性
 */
```

**关键属性测试**：
1. 属性 1：内容解析一致性
2. 属性 3：中文数字转换正确性
3. 属性 4：条文保存原子性
4. 属性 5：条文 ID 唯一性
5. 属性 6：条文顺序正确性

### 集成测试

**测试范围**：
- API 端点（batch-save, batch-embed）
- 前后端数据流
- 数据库操作

**测试场景**：
- 完整的保存和拆分流程
- 向量化触发和失败处理
- 并发保存的事务隔离

### UI 测试

**测试工具**：
- vibium（浏览器自动化测试）

**测试场景**：
- 编辑器和预览器的实时同步
- 响应式布局切换
- 保存和取消操作
- 错误提示显示

**测试账号**：
- 手机号：13064768490
- 密码：daixin88

## 实现注意事项

### 1. 依赖安装

在开始实现前，需要安装 markstream-vue：

```bash
bun add markstream-vue
```

### 2. 解析器移植

将 `lawSplitting.js` 的解析逻辑移植到 TypeScript 时：
- 保持原有的解析逻辑不变
- 添加 TypeScript 类型定义
- 移除数据库相关代码（由服务层处理）
- 添加错误处理和日志记录

### 3. 性能优化

- 使用防抖（debounce）处理实时解析，避免频繁计算
- 大量条文时考虑虚拟滚动
- 批量数据库操作使用事务和批量插入

### 4. 用户体验

- 保存前显示确认对话框（如果条文数量很大）
- 提供保存进度提示
- 支持键盘快捷键（Ctrl+S 保存）
- 自动保存草稿到 localStorage
- 进入编辑页面时优先加载缓存草稿
- 保存成功后清除缓存
- 用户退出登录时清除所有编辑器缓存

### 5. 安全性

- 验证用户权限
- 防止 SQL 注入（使用 Prisma 参数化查询）
- 限制内容长度
- 验证输入数据格式

### 6. 兼容性

- 确保移动端布局正常
- 测试不同浏览器的兼容性
- 处理旧版本数据的兼容

## 部署和配置

### 环境变量

无需额外的环境变量，使用现有的数据库配置。

### 数据库迁移

无需数据库迁移，使用现有的表结构。

### 依赖版本

- markstream-vue: 最新稳定版
- 其他依赖使用项目现有版本

## 未来扩展

### 1. 版本控制

- 保存每次编辑的历史版本
- 支持版本对比和回滚

### 2. 协同编辑

- 多用户同时编辑提示
- 冲突检测和解决

### 3. 导入导出

- 支持从 Word/PDF 导入
- 导出为多种格式

### 4. 智能提示

- 根据法律类型提供模板
- 自动补全常用法律术语

### 5. 批量操作

- 批量导入多个法律法规
- 批量更新和拆分
