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
                <div class="border rounded-md p-3 schema-editor-wrapper">
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
import { WrapText, Trash2 } from 'lucide-vue-next'

// 延迟导入避免 SSR 问题
const JsonEditorVue = defineAsyncComponent(() => import('json-editor-vue'))
const JsonSchemaEditorVue3 = defineAsyncComponent(() =>
    import('@jianmu/json-schema-editor-vue3/lib/json-schema-editor-vue3.css').then(
        // @ts-expect-error - 该库无类型声明，默认导出是 Vue 插件，组件在 [0] 位置
        () => import('@jianmu/json-schema-editor-vue3').then((m: any) => {
            const plugin = m.default || m
            return plugin[0] || plugin
        })
    )
)

const modelValue = defineModel<Record<string, unknown> | null>({ default: null })

const activeTab = ref<'visual' | 'json'>('visual')
const jsonError = ref('')

const DEFAULT_SCHEMA: Record<string, unknown> = { type: 'object', properties: {}, required: [] }

// 可视化编辑器使用的数据
const schemaForVisual = ref<Record<string, unknown>>({ ...DEFAULT_SCHEMA })

// JSON 编辑器使用的数据
const jsonValue = ref<unknown>(null)

// 从外部值初始化
const initFromModelValue = () => {
    if (modelValue.value && typeof modelValue.value === 'object') {
        schemaForVisual.value = { ...modelValue.value }
        jsonValue.value = { ...modelValue.value }
    } else {
        schemaForVisual.value = { ...DEFAULT_SCHEMA }
        jsonValue.value = { ...DEFAULT_SCHEMA }
    }
}

// 监听外部值变化
watch(modelValue, initFromModelValue, { immediate: true })

// Tab 切换时同步数据
watch(activeTab, (newTab) => {
    if (newTab === 'json') {
        jsonValue.value = { ...schemaForVisual.value }
        jsonError.value = ''
    } else if (jsonValue.value && typeof jsonValue.value === 'object') {
        schemaForVisual.value = { ...(jsonValue.value as Record<string, unknown>) }
    }
})

// 可视化编辑器变化时同步到 modelValue
watch(schemaForVisual, (val) => {
    if (activeTab.value === 'visual' && val) {
        modelValue.value = { ...val }
    }
}, { deep: true })

// JSON 编辑器变化回调
const onJsonChange = (val: unknown) => {
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
}

// 格式化 JSON
const formatJson = () => {
    if (jsonValue.value && typeof jsonValue.value === 'object') {
        jsonValue.value = JSON.parse(JSON.stringify(jsonValue.value))
    }
}

// 清空
const clearSchema = () => {
    schemaForVisual.value = { ...DEFAULT_SCHEMA }
    jsonValue.value = { ...DEFAULT_SCHEMA }
    modelValue.value = null
}
</script>

<style>
/* 限制 @jianmu/json-schema-editor-vue3 的 Ant Design 样式泄漏 */
.schema-editor-wrapper {
    all: initial;
    display: block;
    font-family: inherit;
    color: inherit;
}
</style>
