<template>
    <!-- 导出选项对话框 -->
    <Dialog :open="open" @update:open="$emit('update:open', $event)">
        <DialogContent class="theme-brand max-w-sm">
            <DialogHeader>
                <DialogTitle>导出兑换码</DialogTitle>
                <DialogDescription>选择导出范围</DialogDescription>
            </DialogHeader>
            <div class="py-4 space-y-3">
                <div class="flex items-center space-x-2">
                    <RadioGroup v-model="exportOption" class="space-y-2">
                        <div class="flex items-center space-x-2">
                            <RadioGroupItem value="current" id="export-current" :class="adminBrandFocusClass" />
                            <Label for="export-current">导出当前筛选结果</Label>
                        </div>
                        <div class="flex items-center space-x-2">
                            <RadioGroupItem value="all" id="export-all" :class="adminBrandFocusClass" />
                            <Label for="export-all">导出全部兑换码</Label>
                        </div>
                        <div v-if="selectedCount > 0" class="flex items-center space-x-2">
                            <RadioGroupItem value="selected" id="export-selected" :class="adminBrandFocusClass" />
                            <Label for="export-selected">导出选中的 {{ selectedCount }} 项</Label>
                        </div>
                    </RadioGroup>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" :class="adminBrandFocusClass" @click="$emit('update:open', false)">取消</Button>
                <Button :class="adminBrandPrimaryButtonClass" @click="handleExport" :disabled="exporting">
                    <Loader2 v-if="exporting" class="h-4 w-4 mr-2 animate-spin" />
                    导出
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
    adminBrandFocusClass,
    adminBrandPrimaryButtonClass,
} from '~/utils/adminBrandStyles'

// 定义 props
const props = defineProps<{
    open: boolean
    selectedCount: number
    selectedIds: number[]
    filters: {
        code?: string
        remark?: string
        status?: string
        type?: string
    }
}>()

// 定义事件
const emit = defineEmits<{
    'update:open': [value: boolean]
}>()

// 导出选项
const exportOption = ref<'current' | 'all' | 'selected'>('current')

// 导出中状态
const exporting = ref(false)

// 监听对话框打开，设置默认选项
watch(() => props.open, (newVal) => {
    if (newVal) {
        exportOption.value = props.selectedCount > 0 ? 'selected' : 'current'
    }
})

// 执行导出
const handleExport = () => {
    exporting.value = true
    try {
        const params: Record<string, any> = {}

        if (exportOption.value === 'selected' && props.selectedIds.length > 0) {
            params.ids = props.selectedIds.join(',')
        } else if (exportOption.value === 'current') {
            if (props.filters.code) params.code = props.filters.code
            if (props.filters.remark) params.remark = props.filters.remark
            if (props.filters.status && props.filters.status !== 'all') params.status = parseInt(props.filters.status)
            if (props.filters.type && props.filters.type !== 'all') params.type = parseInt(props.filters.type)
        }
        // exportOption === 'all' 时不传任何筛选参数

        const queryString = new URLSearchParams(params).toString()
        const url = `/api/v1/admin/redemption-codes/export${queryString ? '?' + queryString : ''}`
        window.open(url, '_blank')
        toast.success('导出成功')
        emit('update:open', false)
    } finally {
        exporting.value = false
    }
}
</script>
