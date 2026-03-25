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
                    <!-- 字段列表 -->
                    <div v-for="(field, index) in fields" :key="index"
                        class="border rounded-md p-3 space-y-2">
                        <div class="flex items-center gap-2">
                            <div class="flex-1 grid grid-cols-3 gap-2">
                                <Input
                                    v-model="field.name"
                                    placeholder="字段名"
                                    class="font-mono text-sm"
                                    @input="syncToModel"
                                />
                                <Select v-model="field.type" @update:model-value="syncToModel">
                                    <SelectTrigger>
                                        <SelectValue placeholder="类型" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem v-for="t in FIELD_TYPES" :key="t.value" :value="t.value">
                                            {{ t.label }}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                <Input
                                    v-model="field.description"
                                    placeholder="描述（可选）"
                                    class="text-sm"
                                    @input="syncToModel"
                                />
                            </div>
                            <Button variant="ghost" size="icon" class="shrink-0"
                                @click="removeField(index)">
                                <X class="h-4 w-4" />
                            </Button>
                        </div>
                        <div class="flex items-center gap-4">
                            <label class="flex items-center gap-2 text-sm cursor-pointer">
                                <Checkbox
                                    :checked="field.required"
                                    @update:checked="(val: boolean) => { field.required = val; syncToModel() }"
                                />
                                必填
                            </label>
                            <!-- array 类型额外配置 items 类型 -->
                            <div v-if="field.type === 'array'" class="flex items-center gap-2 text-sm">
                                <span class="text-muted-foreground">元素类型:</span>
                                <Select v-model="field.itemsType" @update:model-value="syncToModel">
                                    <SelectTrigger class="w-28 h-8">
                                        <SelectValue placeholder="类型" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem v-for="t in BASIC_TYPES" :key="t.value" :value="t.value">
                                            {{ t.label }}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    <!-- 空状态 -->
                    <div v-if="fields.length === 0"
                        class="border border-dashed rounded-md p-6 text-center text-sm text-muted-foreground">
                        暂无字段，点击下方按钮添加
                    </div>

                    <!-- 添加字段按钮 -->
                    <Button variant="outline" size="sm" class="w-full" @click="addField">
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
                        class="min-h-[200px]"
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
import { Plus, WrapText, Trash2, X } from 'lucide-vue-next'

// 延迟导入避免 SSR 问题
const JsonEditorVue = defineAsyncComponent(() => import('json-editor-vue'))

/** 可视化字段定义 */
interface SchemaField {
    name: string
    type: string
    description: string
    required: boolean
    itemsType: string // array 类型的 items 类型
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

const modelValue = defineModel<Record<string, unknown> | null>({ default: null })

const activeTab = ref<'visual' | 'json'>('visual')
const jsonError = ref('')

// 可视化字段列表
const fields = ref<SchemaField[]>([])

// JSON 编辑器数据
const jsonValue = ref<unknown>(null)

// 内部同步标记，避免循环触发
let syncing = false

// ---------- 可视化 → JSON Schema 转换 ----------

const fieldsToSchema = (fieldList: SchemaField[]): Record<string, unknown> => {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const f of fieldList) {
        if (!f.name) continue
        const prop: Record<string, unknown> = { type: f.type }
        if (f.description) prop.description = f.description
        if (f.type === 'array') {
            prop.items = { type: f.itemsType || 'string' }
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

// ---------- JSON Schema → 可视化字段转换 ----------

const schemaToFields = (schema: Record<string, unknown>): SchemaField[] => {
    const props = (schema.properties ?? {}) as Record<string, any>
    const req = (schema.required ?? []) as string[]
    return Object.entries(props).map(([name, def]) => ({
        name,
        type: def?.type ?? 'string',
        description: def?.description ?? '',
        required: req.includes(name),
        itemsType: def?.items?.type ?? 'string',
    }))
}

// ---------- 初始化 ----------

const initFromModelValue = () => {
    if (syncing) return
    syncing = true
    if (modelValue.value && typeof modelValue.value === 'object') {
        fields.value = schemaToFields(modelValue.value)
        jsonValue.value = { ...modelValue.value }
    } else {
        fields.value = []
        jsonValue.value = { type: 'object', properties: {} }
    }
    nextTick(() => { syncing = false })
}

watch(modelValue, initFromModelValue, { immediate: true })

// ---------- Tab 切换同步 ----------

watch(activeTab, (newTab) => {
    syncing = true
    if (newTab === 'json') {
        // 可视化 → JSON
        const schema = fieldsToSchema(fields.value)
        jsonValue.value = schema
        jsonError.value = ''
    } else {
        // JSON → 可视化
        if (jsonValue.value && typeof jsonValue.value === 'object') {
            const schema = jsonValue.value as Record<string, unknown>
            fields.value = schemaToFields(schema)
        }
    }
    nextTick(() => { syncing = false })
})

// ---------- 可视化操作 ----------

const syncToModel = () => {
    if (syncing) return
    syncing = true
    modelValue.value = fieldsToSchema(fields.value)
    nextTick(() => { syncing = false })
}

const addField = () => {
    fields.value.push({
        name: '',
        type: 'string',
        description: '',
        required: false,
        itemsType: 'string',
    })
}

const removeField = (index: number) => {
    fields.value.splice(index, 1)
    syncToModel()
}

// ---------- JSON 编辑操作 ----------

const onJsonChange = (val: unknown) => {
    if (syncing) return
    syncing = true
    if (typeof val === 'object' && val !== null) {
        jsonError.value = ''
        modelValue.value = { ...(val as Record<string, unknown>) }
    } else if (typeof val === 'string') {
        try {
            const parsed = JSON.parse(val)
            jsonError.value = ''
            modelValue.value = parsed
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
</script>
