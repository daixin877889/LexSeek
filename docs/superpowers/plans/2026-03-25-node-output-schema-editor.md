# 节点 outputSchema 编辑器实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为节点管理后台补全 outputSchema 字段的全栈 CRUD 支持，包含双模式编辑器（可视化 + JSON 原文）。

**Architecture:** 自底向上实施：类型定义 → API 验证 → DAO/Service → 前端表单 → 详情展示。使用成熟库 `json-editor-vue`（JSON 编辑）和 `@jianmu/json-schema-editor-vue3`（Schema 可视化构建）避免重写。

**Tech Stack:** TypeScript, Zod, Prisma, Vue 3, Nuxt 4, shadcn-vue, json-editor-vue, @jianmu/json-schema-editor-vue3

**Spec:** `docs/superpowers/specs/2026-03-25-node-output-schema-editor-design.md`

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `shared/types/node.ts` | CreateNodeInput 添加 outputSchema 字段 |
| Modify | `server/api/v1/admin/nodes/index.post.ts` | Zod 验证添加 outputSchema |
| Modify | `server/api/v1/admin/nodes/[id].put.ts` | Zod 验证添加 outputSchema |
| Modify | `server/services/node/node.dao.ts` | createNodeDao / updateNodeDao 传递 outputSchema |
| Modify | `server/services/node/node.service.ts` | 创建/更新时非 extraction/agent 类型清空 outputSchema |
| Create | `app/components/admin/nodes/OutputSchemaEditor.vue` | 双模式 outputSchema 编辑器组件 |
| Modify | `app/components/admin/nodes/NodeFormDialog.vue` | 集成 OutputSchemaEditor |
| Modify | `app/pages/admin/nodes/[id].vue` | 详情页展示 outputSchema |
| Create | `tests/server/node/node-output-schema.test.ts` | outputSchema CRUD 测试 |

---

### Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 JSON 编辑器和 Schema 可视化编辑器依赖**

```bash
bun add json-editor-vue vanilla-jsoneditor @jianmu/json-schema-editor-vue3
```

- [ ] **Step 2: 验证安装成功**

```bash
bun run build 2>&1 | head -20
```

如果构建有模块解析问题，检查是否需要在 `nuxt.config.ts` 中添加 transpile 配置。

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: 添加 JSON 编辑器和 Schema 可视化构建器依赖"
```

---

### Task 2: 类型定义 + API 验证 + DAO/Service 层

**Files:**
- Modify: `shared/types/node.ts:88-99`
- Modify: `server/api/v1/admin/nodes/index.post.ts:12-45`
- Modify: `server/api/v1/admin/nodes/[id].put.ts:17-48`
- Modify: `server/services/node/node.dao.ts:207-240,480-515`
- Modify: `server/services/node/node.service.ts:188-210,273-300`
- Create: `tests/server/node/node-output-schema.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/node/node-output-schema.test.ts`：

```typescript
/**
 * 节点 outputSchema CRUD 测试
 *
 * **Feature: node-management**
 * **Validates: outputSchema 字段的创建、读取、更新、清空**
 */
import { describe, it, expect, afterAll } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '../../../.env.testing') })

const createTestPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL 环境变量未设置')
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const testPrisma = createTestPrisma()
const createdNodeIds: number[] = []

// 获取一个可用的 modelId
let testModelId: number

afterAll(async () => {
    // 清理测试数据
    for (const id of createdNodeIds) {
        await testPrisma.nodes.delete({ where: { id } }).catch(() => {})
    }
    await testPrisma.$disconnect()
})

describe('节点 outputSchema CRUD', () => {
    it('准备测试数据：获取可用模型ID', async () => {
        const model = await testPrisma.models.findFirst({ where: { status: 1 } })
        expect(model).not.toBeNull()
        testModelId = model!.id
    })

    it('创建节点时应支持设置 outputSchema', async () => {
        const schema = {
            type: 'object',
            properties: {
                title: { type: 'string', description: '案件标题' },
                plaintiff: { type: 'array', items: { type: 'string' } },
            },
            required: ['title'],
        }

        const node = await testPrisma.nodes.create({
            data: {
                name: `test_output_schema_${Date.now()}`,
                title: '测试节点',
                type: 'extraction',
                modelId: testModelId,
                outputSchema: schema,
            },
        })
        createdNodeIds.push(node.id)

        expect(node.outputSchema).toEqual(schema)
    })

    it('读取节点时应返回 outputSchema', async () => {
        const nodeId = createdNodeIds[0]
        const node = await testPrisma.nodes.findUnique({ where: { id: nodeId } })
        expect(node).not.toBeNull()
        expect(node!.outputSchema).not.toBeNull()
        expect((node!.outputSchema as any).type).toBe('object')
    })

    it('更新节点时应能修改 outputSchema', async () => {
        const nodeId = createdNodeIds[0]
        const newSchema = {
            type: 'object',
            properties: {
                summary: { type: 'string', description: '案件概要' },
            },
            required: ['summary'],
        }

        const updated = await testPrisma.nodes.update({
            where: { id: nodeId },
            data: { outputSchema: newSchema },
        })

        expect(updated.outputSchema).toEqual(newSchema)
    })

    it('更新节点时应能清空 outputSchema 为 null', async () => {
        const nodeId = createdNodeIds[0]
        // Prisma 中使用 DbNull 来将 Json? 字段设为 null
        const { Prisma } = await import('../../../generated/prisma/client')
        const updated = await testPrisma.nodes.update({
            where: { id: nodeId },
            data: { outputSchema: Prisma.DbNull },
        })

        expect(updated.outputSchema).toBeNull()
    })

    it('创建非 extraction/agent 类型节点时 outputSchema 应为 null', async () => {
        const node = await testPrisma.nodes.create({
            data: {
                name: `test_analysis_no_schema_${Date.now()}`,
                title: '分析节点',
                type: 'analysis',
                modelId: testModelId,
                outputSchema: undefined,
            },
        })
        createdNodeIds.push(node.id)

        expect(node.outputSchema).toBeNull()
    })
})
```

- [ ] **Step 2: 运行测试确认失败（应该通过，因为这是 Prisma 直接操作）**

```bash
npx vitest run tests/server/node/node-output-schema.test.ts --reporter=verbose
```

预期：PASS（因为数据库字段已存在，这组测试验证的是 Prisma 层面的基础能力）

- [ ] **Step 3: 修改类型定义**

在 `shared/types/node.ts` 的 `CreateNodeInput` 接口中，在 `status` 字段后添加：

```typescript
    outputSchema?: Record<string, unknown> | null
```

`UpdateNodeInput` 基于 `Partial<Omit<CreateNodeInput, 'name'>>` 自动继承，无需额外修改。

- [ ] **Step 4: 修改创建节点 API 验证**

在 `server/api/v1/admin/nodes/index.post.ts` 的 `bodySchema` 中，`status` 字段后添加：

```typescript
    outputSchema: z.record(z.unknown()).optional().nullable(),
```

- [ ] **Step 5: 修改更新节点 API 验证**

在 `server/api/v1/admin/nodes/[id].put.ts` 的 `bodySchema` 中，`status` 字段后添加：

```typescript
    outputSchema: z.record(z.unknown()).optional().nullable(),
```

- [ ] **Step 6: 修改 createNodeDao**

在 `server/services/node/node.dao.ts` 的 `createNodeDao` 函数中，`prisma.nodes.create` 的 `data` 对象里，`status` 行后添加：

```typescript
                outputSchema: data.outputSchema ?? null,
```

- [ ] **Step 7: 修改 updateNodeDao**

在 `server/services/node/node.dao.ts` 的 `updateNodeDao` 函数中，`data` 对象的条件展开列表中，`status` 行后添加：

```typescript
                ...(data.outputSchema !== undefined && { outputSchema: data.outputSchema }),
```

- [ ] **Step 8: 修改 createNodeService 添加类型约束**

在 `server/services/node/node.service.ts` 的 `createNodeService` 函数中，`return await createNodeDao(data)` 之前添加：

```typescript
    // 非 extraction/agent 类型强制清空 outputSchema
    const SCHEMA_TYPES = ['extraction', 'agent']
    if (!SCHEMA_TYPES.includes(data.type) && data.outputSchema) {
        data = { ...data, outputSchema: null }
    }
```

注意：需要将函数参数从 `data: CreateNodeInput` 改为 `let` 语义，或在传参前创建新对象。推荐直接用新变量：

```typescript
    const cleanedData = (!SCHEMA_TYPES.includes(data.type) && data.outputSchema)
        ? { ...data, outputSchema: null }
        : data
    return await createNodeDao(cleanedData)
```

- [ ] **Step 9: 修改 updateNodeService 添加类型约束**

在 `server/services/node/node.service.ts` 的 `updateNodeService` 函数中，`return await updateNodeDao(id, data)` 之前添加：

```typescript
    // existing 已在上方通过 findNodeByIdDao 查询获得
    const finalType = data.type ?? existing.type
    const SCHEMA_TYPES = ['extraction', 'agent']
    const cleanedData = (!SCHEMA_TYPES.includes(finalType) && data.outputSchema !== undefined)
        ? { ...data, outputSchema: null }
        : data
    return await updateNodeDao(id, cleanedData)
```

注意：将最后一行 `return await updateNodeDao(id, data)` 替换为 `return await updateNodeDao(id, cleanedData)`。

- [ ] **Step 10: 运行测试**

```bash
npx vitest run tests/server/node/node-output-schema.test.ts --reporter=verbose
```

预期：全部 PASS

- [ ] **Step 11: 运行类型检查**

```bash
npx nuxi typecheck
```

预期：无新增类型错误

- [ ] **Step 12: Commit**

```bash
git add shared/types/node.ts server/api/v1/admin/nodes/index.post.ts server/api/v1/admin/nodes/\[id\].put.ts server/services/node/node.dao.ts server/services/node/node.service.ts tests/server/node/node-output-schema.test.ts
git commit -m "feat(analysis): 后端支持节点 outputSchema 的 CRUD 操作"
```

---

### Task 3: 前端 OutputSchemaEditor 组件

**Files:**
- Create: `app/components/admin/nodes/OutputSchemaEditor.vue`

**前置知识：**
- `json-editor-vue` 文档：https://github.com/cloydlau/json-editor-vue
- `@jianmu/json-schema-editor-vue3` 文档：https://github.com/zyqwst/json-schema-editor-vue3
- 项目使用 shadcn-vue 的 `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` 组件

- [ ] **Step 1: 创建 OutputSchemaEditor 组件**

创建 `app/components/admin/nodes/OutputSchemaEditor.vue`：

```vue
<template>
    <div class="space-y-3">
        <div class="flex items-center justify-between">
            <Label>结构化输出 Schema</Label>
            <div class="flex items-center gap-2">
                <Button
                    v-if="activeTab === 'json'"
                    variant="ghost"
                    size="sm"
                    @click="formatJson"
                >
                    <WrapText class="h-4 w-4 mr-1" />
                    格式化
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    @click="clearSchema"
                >
                    <Trash2 class="h-4 w-4 mr-1" />
                    清空
                </Button>
            </div>
        </div>

        <Tabs v-model="activeTab" class="w-full">
            <TabsList class="grid w-full grid-cols-2">
                <TabsTrigger value="visual">可视化编辑</TabsTrigger>
                <TabsTrigger value="json">JSON 编辑</TabsTrigger>
            </TabsList>

            <TabsContent value="visual" class="mt-3">
                <div class="border rounded-md p-3">
                    <ClientOnly>
                        <JsonSchemaEditorVue3
                            v-model="schemaForVisual"
                            :show-raw="false"
                            lang="zh_CN"
                        />
                        <template #fallback>
                            <div class="text-sm text-muted-foreground">加载中...</div>
                        </template>
                    </ClientOnly>
                </div>
            </TabsContent>

            <TabsContent value="json" class="mt-3">
                <ClientOnly>
                    <JsonEditorVue
                        v-model="jsonValue"
                        mode="text"
                        :main-menu-bar="false"
                        :navigation-bar="false"
                        :status-bar="true"
                        class="jse-theme-dark min-h-[200px]"
                        @update:model-value="onJsonChange"
                    />
                    <template #fallback>
                        <div class="text-sm text-muted-foreground">加载中...</div>
                    </template>
                </ClientOnly>
                <p v-if="jsonError" class="text-xs text-destructive mt-1">{{ jsonError }}</p>
            </TabsContent>
        </Tabs>

        <p class="text-xs text-muted-foreground">
            定义节点的结构化输出格式（JSON Schema），用于约束 AI 的输出结构
        </p>
    </div>
</template>

<script setup lang="ts">
import { WrapText, Trash2 } from 'lucide-vue-next'

// 延迟导入避免 SSR 问题
const JsonEditorVue = defineAsyncComponent(() => import('json-editor-vue'))
const JsonSchemaEditorVue3 = defineAsyncComponent(() =>
    import('@jianmu/json-schema-editor-vue3').then(m => m.default || m)
)

const modelValue = defineModel<Record<string, unknown> | null>({ default: null })

const activeTab = ref<'visual' | 'json'>('visual')
const jsonError = ref('')

// 可视化编辑器使用的数据
const schemaForVisual = ref<Record<string, unknown>>({
    type: 'object',
    properties: {},
    required: [],
})

// JSON 编辑器使用的数据
const jsonValue = ref<any>(null)

// 从外部值初始化
const initFromModelValue = () => {
    if (modelValue.value && typeof modelValue.value === 'object') {
        schemaForVisual.value = { ...modelValue.value }
        jsonValue.value = { ...modelValue.value }
    } else {
        schemaForVisual.value = { type: 'object', properties: {}, required: [] }
        jsonValue.value = { type: 'object', properties: {}, required: [] }
    }
}

// 监听外部值变化
watch(modelValue, initFromModelValue, { immediate: true })

// Tab 切换时同步数据
watch(activeTab, (newTab) => {
    if (newTab === 'json') {
        // 可视化 → JSON：序列化可视化数据
        jsonValue.value = { ...schemaForVisual.value }
        jsonError.value = ''
    } else {
        // JSON → 可视化：解析 JSON 数据
        if (jsonValue.value && typeof jsonValue.value === 'object') {
            schemaForVisual.value = { ...jsonValue.value }
        }
    }
})

// 可视化编辑器变化时同步到 modelValue
watch(schemaForVisual, (val) => {
    if (activeTab.value === 'visual' && val) {
        modelValue.value = { ...val }
    }
}, { deep: true })

// JSON 编辑器变化回调
const onJsonChange = (val: any) => {
    if (typeof val === 'object' && val !== null) {
        jsonError.value = ''
        modelValue.value = { ...val }
    } else if (typeof val === 'string') {
        // 文本模式下可能返回字符串
        try {
            const parsed = JSON.parse(val)
            jsonError.value = ''
            modelValue.value = parsed
        } catch {
            jsonError.value = 'JSON 格式不正确'
        }
    }
}

// 格式化 JSON
const formatJson = () => {
    if (jsonValue.value && typeof jsonValue.value === 'object') {
        // json-editor-vue 内置格式化，触发重新赋值即可
        jsonValue.value = JSON.parse(JSON.stringify(jsonValue.value))
    }
}

// 清空
const clearSchema = () => {
    const empty = { type: 'object', properties: {}, required: [] }
    schemaForVisual.value = { ...empty }
    jsonValue.value = { ...empty }
    modelValue.value = null
}

// 初始化
initFromModelValue()
</script>

<style>
/* json-editor-vue 最小高度 */
.jse-theme-dark {
    --jse-theme-color: hsl(var(--primary));
}
</style>
```

> **注意**：使用 `ClientOnly` 和 `defineAsyncComponent` 避免 SSR 兼容问题。实际集成时可能需要根据 `json-editor-vue` 和 `@jianmu/json-schema-editor-vue3` 的 Nuxt 兼容情况做适配调整。如果 `@jianmu/json-schema-editor-vue3` 与 Nuxt 4 不兼容，可退回使用自定义简单表单方案。

- [ ] **Step 2: 验证组件可渲染**

启动 dev server，在浏览器中临时测试组件是否可加载：

```bash
bun dev
```

在开发者工具中检查是否有报错。

- [ ] **Step 3: Commit**

```bash
git add app/components/admin/nodes/OutputSchemaEditor.vue
git commit -m "feat(ui): 创建双模式 OutputSchemaEditor 组件"
```

---

### Task 4: 集成 OutputSchemaEditor 到 NodeFormDialog

**Files:**
- Modify: `app/components/admin/nodes/NodeFormDialog.vue`

- [ ] **Step 1: 添加 outputSchema 到表单数据**

在 `NodeFormDialog.vue` 的 `getDefaultForm()` 中添加：

```typescript
function getDefaultForm() {
    return {
        name: '',
        title: '',
        description: '',
        type: '',
        priority: 100,
        modelId: '',
        groupId: 'none',
        tools: [] as string[],
        status: '1',
        outputSchema: null as Record<string, unknown> | null,  // 新增
    }
}
```

- [ ] **Step 2: 在模板中添加 OutputSchemaEditor（条件显示）**

在模板的"工具列表"区域和"状态"区域之间，添加：

```vue
                <!-- 结构化输出 Schema（仅 extraction/agent 类型） -->
                <div v-if="showOutputSchema" class="space-y-2">
                    <AdminNodesOutputSchemaEditor v-model="form.outputSchema" />
                </div>
```

- [ ] **Step 3: 添加 showOutputSchema 计算属性和类型切换清空逻辑**

在 `<script setup>` 中添加：

```typescript
// 是否显示 outputSchema 编辑器
const showOutputSchema = computed(() =>
    ['extraction', 'agent'].includes(form.value.type)
)

// 类型切换时自动清空 outputSchema（UX 一致性）
watch(() => form.value.type, (newType) => {
    if (!['extraction', 'agent'].includes(newType)) {
        form.value.outputSchema = null
    }
})
```

- [ ] **Step 4: 编辑模式回填 outputSchema**

在 `openEdit` 函数的 `form.value = { ... }` 中添加：

```typescript
        outputSchema: (node.outputSchema as Record<string, unknown>) ?? null,
```

- [ ] **Step 5: 提交时包含 outputSchema**

在 `handleSubmit` 函数的 `body` 构建中添加：

```typescript
            outputSchema: showOutputSchema.value ? (form.value.outputSchema ?? null) : null,
```

- [ ] **Step 6: 验证功能**

1. 启动 `bun dev`
2. 进入节点管理页面
3. 新增节点，选择 `extraction` 类型 → 应显示 outputSchema 编辑器
4. 切换为 `analysis` 类型 → 编辑器应隐藏
5. 编辑已有 extraction 节点 → 应回填 outputSchema
6. 切换"可视化编辑" / "JSON 编辑" Tab → 数据应同步

- [ ] **Step 7: Commit**

```bash
git add app/components/admin/nodes/NodeFormDialog.vue
git commit -m "feat(ui): 节点表单集成 outputSchema 双模式编辑器"
```

---

### Task 5: 详情页展示 outputSchema

**Files:**
- Modify: `app/pages/admin/nodes/[id].vue`

- [ ] **Step 1: 在基本信息卡片中添加 outputSchema 展示**

在 `[id].vue` 模板中，"工具列表"展示区域（约 L94-102）之后，`</div>` 闭合标签之前添加：

```vue
                        <!-- outputSchema 展示 -->
                        <div v-if="node.outputSchema" class="col-span-full space-y-1">
                            <Label class="text-muted-foreground">结构化输出 Schema</Label>
                            <div class="bg-muted rounded-md p-4 overflow-auto max-h-96">
                                <pre class="text-sm font-mono whitespace-pre-wrap">{{ formatOutputSchema(node.outputSchema) }}</pre>
                            </div>
                        </div>
```

- [ ] **Step 2: 添加格式化函数**

在 `<script setup>` 中添加：

```typescript
// 格式化 outputSchema
const formatOutputSchema = (schema: unknown) => {
    try {
        return JSON.stringify(schema, null, 2)
    } catch {
        return String(schema)
    }
}
```

- [ ] **Step 3: 验证功能**

1. 启动 `bun dev`
2. 查看一个有 outputSchema 的节点详情页 → 应显示格式化的 JSON
3. 查看一个没有 outputSchema 的节点详情页 → 不应显示该区域

- [ ] **Step 4: Commit**

```bash
git add app/pages/admin/nodes/\[id\].vue
git commit -m "feat(ui): 节点详情页展示 outputSchema"
```

---

### Task 6: 全量验证

- [ ] **Step 1: 运行类型检查**

```bash
npx nuxi typecheck
```

预期：无类型错误

- [ ] **Step 2: 运行节点相关测试**

```bash
npx vitest run tests/server/node/ --reporter=verbose
```

预期：所有测试通过

- [ ] **Step 3: 运行全量测试**

```bash
npx vitest run --reporter=verbose
```

预期：所有 1586+ 测试通过

- [ ] **Step 4: 端到端手动验证**

在 `bun dev` 环境下验证以下场景：

1. 创建 extraction 节点，设置 outputSchema（可视化模式）→ 保存 → 详情页展示正确
2. 编辑该节点，切换到 JSON 模式修改 → 保存 → 详情页展示更新
3. 将类型改为 analysis → 保存 → outputSchema 应被清空
4. 创建 agent 节点，设置 outputSchema → 保存 → 正常工作
5. 编辑节点，清空 outputSchema → 保存 → 详情页不再显示该区域

- [ ] **Step 5: 使用 simplify 技能优化代码**

按 CLAUDE.md 要求，完成编码后运行 simplify 技能。

- [ ] **Step 6: 最终 Commit**

如有优化改动，提交：

```bash
git add -A
git commit -m "refactor(analysis): 优化 outputSchema 编辑器代码"
```
