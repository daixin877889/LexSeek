<template>
    <div v-for="(field, index) in fields" :key="`${field.name}-${index}`"
        class="border rounded-md p-3 space-y-2">
        <!-- 字段主行 -->
        <div class="flex items-center gap-2">
            <div class="flex-1 grid grid-cols-3 gap-2">
                <Input
                    v-model="field.name"
                    placeholder="字段名"
                    class="font-mono text-sm"
                    @input="syncToModel"
                />
                <Select v-model="field.type"
                    @update:model-value="(val: AcceptableValue) => onTypeChange(field, val)">
                    <SelectTrigger class="w-full">
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
                @click="emit('remove', index)">
                <X class="h-4 w-4" />
            </Button>
        </div>

        <!-- 选项行 -->
        <div class="flex items-center gap-4">
            <label class="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                    :model-value="field.required"
                    @update:model-value="(val: boolean | 'indeterminate') => { field.required = val === true; syncToModel() }"
                />
                必填
            </label>

            <!-- array 类型：选择元素类型 -->
            <div v-if="field.type === 'array'" class="flex items-center gap-2 text-sm">
                <span class="text-muted-foreground">元素类型:</span>
                <Select v-model="field.itemsType"
                    @update:model-value="(val: AcceptableValue) => onItemsTypeChange(field, val)">
                    <SelectTrigger class="w-28 h-8">
                        <SelectValue placeholder="类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem v-for="t in ITEMS_TYPES" :key="t.value" :value="t.value">
                            {{ t.label }}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>

        <!-- array of objects：嵌套子字段 -->
        <div v-if="field.type === 'array' && field.itemsType === 'object'"
            class="ml-4 pl-3 border-l-2 border-muted space-y-2 mt-2">
            <p class="text-xs text-muted-foreground">数组元素属性：</p>
            <!-- 递归渲染子字段 -->
            <AdminNodesSchemaFieldList
                :fields="field.children"
                @update="syncToModel"
                @remove="(i: number) => removeChild(field, i)"
            />
            <Button variant="outline" size="sm" class="w-full" @click="addChild(field)">
                <Plus class="h-3 w-3 mr-1" />
                添加子字段
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'
import type { AcceptableValue } from 'reka-ui'
import AdminNodesSchemaFieldList from '~/components/admin/nodes/SchemaFieldList.vue'

interface SchemaField {
    name: string
    type: string
    description: string
    required: boolean
    itemsType: string
    children: SchemaField[]
}

defineProps<{
    fields: SchemaField[]
}>()

const emit = defineEmits<{
    update: []
    remove: [index: number]
}>()

const FIELD_TYPES = inject<{ value: string; label: string }[]>('FIELD_TYPES', [])
const ITEMS_TYPES = inject<{ value: string; label: string }[]>('ITEMS_TYPES', [])

const syncToModel = () => emit('update')

const onTypeChange = (field: SchemaField, val: AcceptableValue) => {
    field.type = String(val ?? 'string')
    if (val !== 'array') {
        field.itemsType = 'string'
        field.children = []
    }
    syncToModel()
}

const onItemsTypeChange = (field: SchemaField, val: AcceptableValue) => {
    field.itemsType = String(val ?? 'string')
    if (val !== 'object') {
        field.children = []
    }
    syncToModel()
}

const addChild = (field: SchemaField) => {
    field.children.push({
        name: '',
        type: 'string',
        description: '',
        required: false,
        itemsType: 'string',
        children: [],
    })
}

const removeChild = (field: SchemaField, index: number) => {
    field.children.splice(index, 1)
    syncToModel()
}
</script>
