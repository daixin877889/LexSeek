# 节点管理 outputSchema 编辑器设计

## 背景

节点管理模块的数据库和服务层已支持 `outputSchema` 字段（JSONB，用于定义 AI 节点的结构化输出格式），但前端管理界面和 API 验证层缺少对应支持。当前 `outputSchema` 只能通过直接操作数据库设置。

## 目标

在后台节点管理界面中补全 `outputSchema` 的完整 CRUD 支持，包括类型定义、API 验证、DAO 传递、前端表单编辑和详情展示。

## 修改范围

| 层 | 文件 | 改动 |
|---|---|---|
| 类型定义 | `shared/types/node.ts` | `CreateNodeInput` / `UpdateNodeInput` 添加 `outputSchema` |
| API 验证 | `server/api/v1/admin/nodes/index.post.ts` | Zod schema 添加 `outputSchema` |
| API 验证 | `server/api/v1/admin/nodes/[id].put.ts` | Zod schema 添加 `outputSchema` |
| 服务/DAO | `server/services/node/node.dao.ts` | `createNodeDao` / `updateNodeDao` 传递 `outputSchema` |
| 前端表单 | `app/components/admin/nodes/NodeFormDialog.vue` | 新增双模式 outputSchema 编辑器 |
| 前端详情 | `app/pages/admin/nodes/[id].vue` | 展示 outputSchema 内容 |

## 详细设计

### 1. 类型定义（shared/types/node.ts）

在 `CreateNodeInput` 中添加 `outputSchema` 可选字段：

```typescript
export interface CreateNodeInput {
    name: string
    title?: string | null
    description?: string | null
    type: NodeType
    priority?: number
    modelId: number
    tools?: string[]
    groupId?: number | null
    status?: number
    outputSchema?: Record<string, unknown> | null  // 新增
}
```

`UpdateNodeInput` 基于 `Partial<Omit<CreateNodeInput, 'name'>>` 自动继承。

### 2. API 验证层

#### 创建节点 API（index.post.ts）

在 Zod bodySchema 中新增：

```typescript
outputSchema: z.record(z.unknown()).optional().nullable()
```

#### 更新节点 API（[id].put.ts）

同上，在 Zod bodySchema 中新增相同字段。

### 3. DAO 层（node.dao.ts）

确保 `createNodeDao` 和 `updateNodeDao` 将入参中的 `outputSchema` 传入 Prisma `create` / `update` 的 `data` 对象。当前这两个函数使用解构传参，需要在解构列表和 Prisma data 中补充 `outputSchema`。

### 4. 前端表单 - 双模式编辑器（NodeFormDialog.vue）

#### 显示条件

仅当节点类型为 `extraction` 或 `agent` 时显示 outputSchema 编辑区域。用户切换类型时动态显示/隐藏。

#### 编辑模式

提供两个 Tab 切换：

**Tab 1：可视化模式**

以表单方式构建 JSON Schema：
- 字段列表，每行包含：字段名（Input）、类型（Select：string/number/boolean/array/object）、描述（Input）、是否必填（Checkbox）
- "添加字段"按钮
- 每行有删除按钮
- array 类型需额外指定 items 类型
- object 类型支持一层嵌套属性定义（展开子字段列表）

可视化模式生成的 JSON Schema 结构：

```json
{
    "type": "object",
    "properties": {
        "fieldName": {
            "type": "string",
            "description": "字段描述"
        }
    },
    "required": ["fieldName"]
}
```

**Tab 2：JSON 模式**

- 使用 `<Textarea>` 组件直接编辑 JSON Schema 原文
- 提供格式化按钮
- 实时 JSON 语法校验，错误时显示提示信息
- 行数自适应（min-rows: 8）

#### 模式同步

- 从可视化切换到 JSON 模式：将可视化构建器的数据序列化为 JSON 字符串显示
- 从 JSON 模式切换到可视化模式：尝试解析 JSON 并填充可视化表单；如果 JSON 结构不符合可视化模式支持的格式（例如复杂嵌套），提示用户并保持 JSON 模式

#### 表单数据流

- `form.outputSchema` 存储为 `Record<string, unknown> | null`
- 提交时：如果类型不是 extraction/agent 且 outputSchema 不为 null，自动清空为 null
- 编辑时回填：从节点数据中读取 `outputSchema` 填充编辑器

### 5. 详情页展示（[id].vue）

在节点详情页"基本信息"卡片下方，如果节点存在 `outputSchema`（非 null），新增一个展示区域：

- 标题："结构化输出 Schema"
- 内容：格式化后的 JSON 显示（使用 `<pre><code>` 包裹，monospace 字体）
- 使用 `JSON.stringify(outputSchema, null, 2)` 格式化

### 6. 列表页

列表页不需要变动，`outputSchema` 不适合在列表中展示（内容太长）。

## 不在范围内

- 不修改 `NodeConfig` 接口（服务层已支持 outputSchema）
- 不修改 `getNodeConfigDao` / `getNodeConfigByIdDao`（已正确查询 outputSchema）
- 不修改工作流节点执行逻辑（extractInfo.ts 等已正确使用）
- 不需要数据库迁移（字段已存在）

## 测试计划

- [ ] 创建 extraction 类型节点时能设置 outputSchema
- [ ] 创建 analysis 类型节点时不显示 outputSchema 编辑区
- [ ] 编辑节点时能回填已有 outputSchema
- [ ] 可视化模式和 JSON 模式之间正确同步
- [ ] JSON 模式下的语法错误能被正确提示
- [ ] 详情页正确展示 outputSchema
- [ ] 更新节点时能清空 outputSchema（设为 null）
- [ ] API 验证通过各种 outputSchema 格式（空对象、嵌套对象、null）
