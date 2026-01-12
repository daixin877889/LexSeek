<template>
    <!-- MinerU Token 创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent class="max-w-lg max-h-[85vh] flex flex-col" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="flex-shrink-0">
                <DialogTitle>{{ isEdit ? '编辑 MinerU Token' : '新增 MinerU Token' }}</DialogTitle>
                <DialogDescription>{{ isEdit ? '修改 Token 配置' : '创建新的 MinerU API Token' }}</DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <!-- Token 名称 -->
                <div class="space-y-2">
                    <Label>Token 名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="如：主账号 Token" />
                    <p class="text-xs text-muted-foreground">用于标识不同的 Token</p>
                </div>

                <!-- Token 值 -->
                <div class="space-y-2">
                    <Label>Token 值 <span class="text-destructive">*</span></Label>
                    <div class="relative">
                        <Input v-model="form.token" :type="showToken ? 'text' : 'password'"
                            :placeholder="isEdit ? '留空则不修改' : '请输入 MinerU API Token'" class="pr-10" />
                        <Button type="button" variant="ghost" size="icon"
                            class="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                            @click="showToken = !showToken">
                            <Eye v-if="!showToken" class="h-4 w-4 text-muted-foreground" />
                            <EyeOff v-else class="h-4 w-4 text-muted-foreground" />
                        </Button>
                    </div>
                    <p v-if="isEdit" class="text-xs text-muted-foreground">编辑时留空表示不修改 Token 值</p>
                </div>

                <!-- 备注 -->
                <div class="space-y-2">
                    <Label>备注</Label>
                    <Textarea v-model="form.remark" placeholder="Token 的用途说明或备注信息" rows="3" />
                </div>

                <!-- 状态 -->
                <div class="space-y-2">
                    <Label>状态</Label>
                    <Select v-model="form.status">
                        <SelectTrigger class="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">启用</SelectItem>
                            <SelectItem value="0">禁用</SelectItem>
                        </SelectContent>
                    </Select>
                    <p class="text-xs text-muted-foreground">系统会使用最新创建的启用状态 Token</p>
                </div>
            </div>
            <DialogFooter class="flex-shrink-0">
                <Button variant="outline" @click="open = false">取消</Button>
                <Button @click="handleSubmit" :disabled="submitting">
                    <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                    {{ isEdit ? '保存' : '创建' }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Loader2, Eye, EyeOff } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

// MinerU Token 接口（脱敏版本）
interface MineruTokenMasked {
    id: number
    name: string
    tokenMasked: string
    remark?: string | null
    status: number
    createdAt: Date | string
    updatedAt: Date | string
}

// 定义事件
const emit = defineEmits<{
    success: []
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const showToken = ref(false)
const selectedItem = ref<MineruTokenMasked | null>(null)

// 表单数据
const form = ref(getDefaultForm())

// 获取默认表单值
function getDefaultForm() {
    return {
        name: '',
        token: '',
        remark: '',
        status: '1',
    }
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
    showToken.value = false
}

// 打开创建对话框
const openCreate = () => {
    isEdit.value = false
    selectedItem.value = null
    resetForm()
    open.value = true
}

// 打开编辑对话框
const openEdit = (item: MineruTokenMasked) => {
    isEdit.value = true
    selectedItem.value = item
    form.value = {
        name: item.name,
        token: '', // 编辑时不显示原 Token
        remark: item.remark || '',
        status: String(item.status),
    }
    showToken.value = false
    open.value = true
}

// 提交表单
const handleSubmit = async () => {
    // 验证必填字段
    if (!form.value.name.trim()) {
        toast.error('请输入 Token 名称')
        return
    }

    // 创建时 Token 必填
    if (!isEdit.value && !form.value.token.trim()) {
        toast.error('请输入 Token 值')
        return
    }

    submitting.value = true
    try {
        const body: Record<string, any> = {
            name: form.value.name.trim(),
            remark: form.value.remark?.trim() || null,
            status: parseInt(form.value.status),
        }

        // 只有填写了 Token 才传递
        if (form.value.token.trim()) {
            body.token = form.value.token.trim()
        }

        let result
        if (isEdit.value && selectedItem.value) {
            result = await useApiFetch(`/api/v1/admin/mineru-tokens/${selectedItem.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            result = await useApiFetch('/api/v1/admin/mineru-tokens', {
                method: 'POST',
                body,
            })
        }

        if (result !== null) {
            toast.success(isEdit.value ? '保存成功' : '创建成功')
            open.value = false
            emit('success')
        }
    } finally {
        submitting.value = false
    }
}

// 暴露方法给父组件
defineExpose({
    openCreate,
    openEdit,
})
</script>
