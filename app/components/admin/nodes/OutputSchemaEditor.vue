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

            <!-- 可视化编辑 -->
            <TabsContent value="visual" class="mt-3">
                <div class="space-y-3">
                    <AdminNodesSchemaFieldList
                        :fields="fields"
                        @update="syncToModel"
                        @remove="removeField"
                    />

                    <!-- 空状态 -->
                    <div v-if="fields.length === 0"
                        class="border border-dashed rounded-md p-6 text-center text-sm text-muted-foreground">
                        暂无字段，点击下方按钮添加
                    </div>

                    <!-- 添加字段按钮 -->
                    <Button variant="outline" size="sm" class="w-full" @click="addField(fields)">
                        <Plus class="h-4 w-4 mr-1" />
                        添加字段
                    </Button>
                </div>
            </TabsContent>

            <!-- JSON 编辑 -->
            <TabsContent value="json" class="mt-3">
                <ClientOnly>
                    <!-- @vue-ignore json-editor-vue mode prop accepts string -->
                    <JsonEditorVue
                        v-model="jsonValue"
                        mode="text"
                        :main-menu-bar="false"
                        :navigation-bar="false"
                        :status-bar="true"
                        :class="['min-h-[200px]', isDark ? 'jse-theme-dark' : '']"
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
import { Plus, WrapText, Trash2 } from 'lucide-vue-next'
import AdminNodesSchemaFieldList from '~/components/admin/nodes/SchemaFieldList.vue'
import { useColorMode } from '~/composables/useColorMode'

// 延迟导入避免 SSR 问题
const JsonEditorVue = defineAsyncComponent(() =>
    import('vanilla-jsoneditor/themes/jse-theme-dark.css').then(
        () => import('json-editor-vue')
    )
)

const { isDark } = useColorMode()

/** 可视化字段定义 */
interface SchemaField {
    name: string
    type: string
    description: string
    required: boolean
    itemsType: string
    /** array items 为 object 时的子字段 */
    children: SchemaField[]
}

const BASIC_TYPES = [
    { value: 'string', label: 'string' },
    { value: 'number', label: 'number' },
    { value: 'boolean', label: 'boolean' },
]

const FIELD_TYPES = [
    ...BASIC_TYPES,
    { value: 'array', label: 'array' },
    { value: 'object', label: 'object' },
]

/** array items 类型选项（含 object） */
const ITEMS_TYPES = [
    ...BASIC_TYPES,
    { value: 'object', label: 'object' },
]

const modelValue = defineModel<Record<string, unknown> | null>({ default: null })

const activeTab = ref<'visual' | 'json'>('visual')
const jsonError = ref('')

// 可视化字段列表
const fields = ref<SchemaField[]>([])

// JSON 编辑器数据
const jsonValue = ref<unknown>(null)

// 内部同步标记，避免循环触发
let syncing = false

// ---------- 可视化 ↔ JSON Schema 转换 ----------

const fieldsToSchema = (fieldList: SchemaField[]): Record<string, unknown> => {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const f of fieldList) {
        if (!f.name) continue
        const prop: Record<string, unknown> = { type: f.type }
        if (f.description) prop.description = f.description

        if (f.type === 'array') {
            if (f.itemsType === 'object' && f.children.length > 0) {
                // array of objects：递归生成 items schema
                prop.items = fieldsToSchema(f.children)
            } else {
                prop.items = { type: f.itemsType || 'string' }
            }
        }

        properties[f.name] = prop
        if (f.required) required.push(f.name)
    }

    return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
    }
}

const schemaToFields = (schema: Record<string, unknown>): SchemaField[] => {
    // 先用 JSON 序列化去除 Vue 响应式代理
    const raw = JSON.parse(JSON.stringify(schema))
    const props = (raw.properties ?? {}) as Record<string, any>
    const req = (raw.required ?? []) as string[]
    return Object.entries(props).map(([name, def]) => {
        const field: SchemaField = {
            name,
            type: def?.type ?? 'string',
            description: def?.description ?? '',
            required: req.includes(name),
            itemsType: 'string',
            children: [],
        }

        if (def?.type === 'array' && def?.items) {
            if (def.items.type === 'object' && def.items.properties) {
                // array of objects：递归解析 items
                field.itemsType = 'object'
                field.children = schemaToFields(def.items)
            } else {
                field.itemsType = def.items.type ?? 'string'
            }
        }

        return field
    })
}

// ---------- 数据源：以 modelValue 为单一真相源 ----------

// modelValue → fields + jsonValue
const syncFromModel = () => {
    if (syncing) return
    syncing = true
    const raw = modelValue.value
    if (raw && typeof raw === 'object') {
        const plain = JSON.parse(JSON.stringify(raw))
        if (plain.properties || plain.type) {
            fields.value = schemaToFields(plain)
            jsonValue.value = plain
        } else {
            fields.value = []
            jsonValue.value = { type: 'object', properties: {} }
        }
    } else {
        fields.value = []
        jsonValue.value = { type: 'object', properties: {} }
    }
    nextTick(() => { syncing = false })
}

watch(modelValue, syncFromModel, { immediate: true })

// Tab 切换时：从 modelValue 重新同步到两个编辑器
watch(activeTab, () => {
    syncFromModel()
})

// ---------- 可视化操作 ----------

const syncToModel = () => {
    if (syncing) return
    syncing = true
    const schema = fieldsToSchema(fields.value)
    modelValue.value = schema
    // 同时同步到 jsonValue
    jsonValue.value = JSON.parse(JSON.stringify(schema))
    nextTick(() => { syncing = false })
}

const createField = (): SchemaField => ({
    name: '',
    type: 'string',
    description: '',
    required: false,
    itemsType: 'string',
    children: [],
})

const addField = (target: SchemaField[]) => {
    target.push(createField())
}

const removeField = (index: number, target?: SchemaField[]) => {
    const list = target ?? fields.value
    list.splice(index, 1)
    syncToModel()
}

// ---------- JSON 编辑操作 ----------

const onJsonChange = (val: unknown) => {
    if (syncing) return
    syncing = true
    if (typeof val === 'object' && val !== null) {
        jsonError.value = ''
        modelValue.value = JSON.parse(JSON.stringify(val))
        fields.value = schemaToFields(val as Record<string, unknown>)
    } else if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val)
            jsonError.value = ''
            modelValue.value = parsed
            fields.value = schemaToFields(parsed)
        } catch {
            jsonError.value = 'JSON 格式不正确'
        }
    }
    nextTick(() => { syncing = false })
}

const formatJson = () => {
    if (jsonValue.value && typeof jsonValue.value === 'object') {
        jsonValue.value = JSON.parse(JSON.stringify(jsonValue.value))
    }
}

const clearSchema = () => {
    syncing = true
    fields.value = []
    jsonValue.value = { type: 'object', properties: {} }
    modelValue.value = null
    nextTick(() => { syncing = false })
}

// 暴露给子组件
provide('addField', addField)
provide('removeField', removeField)
provide('syncToModel', syncToModel)
provide('FIELD_TYPES', FIELD_TYPES)
provide('ITEMS_TYPES', ITEMS_TYPES)
provide('BASIC_TYPES', BASIC_TYPES)
</script>
