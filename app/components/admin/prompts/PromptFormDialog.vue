<template>
    <!-- 提示词创建/编辑对话框 -->
    <Dialog v-model:open="open">
        <DialogContent
            class="w-full! h-full! max-w-none! max-h-none! md:w-[80vw]! md:max-h-[90vh]! flex flex-col rounded-non!e md:rounded-lg!"
            :class="contentClass"
            :overlay-class="overlayClass"
            @interactOutside="(e) => e.preventDefault()">
            <DialogHeader class="shrink-0">
                <DialogTitle>{{ isEdit ? '编辑提示词' : '新增提示词' }}</DialogTitle>
                <DialogDescription>
                    {{ isEdit ? '修改提示词内容将创建新版本，不会覆盖当前版本' : '创建新的提示词配置' }}
                </DialogDescription>
            </DialogHeader>
            <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                <!-- 提示词名称（创建时必填，编辑时不可修改） -->
                <div v-if="!isEdit" class="space-y-2">
                    <Label>提示词名称 <span class="text-destructive">*</span></Label>
                    <Input v-model="form.name" placeholder="如：case_summary_system" />
                    <p class="text-xs text-muted-foreground">唯一标识符，同名称的提示词会自动管理版本</p>
                </div>

                <!-- 提示词标题 -->
                <div class="space-y-2">
                    <Label>提示词标题</Label>
                    <Input v-model="form.title" placeholder="如：案件概要系统提示词" />
                </div>

                <!-- 提示词类型（仅创建时） -->
                <div v-if="!isEdit" class="space-y-2">
                    <Label>提示词类型 <span class="text-destructive">*</span></Label>
                    <Select v-model="form.type">
                        <SelectTrigger class="w-full md:w-1/2">
                            <SelectValue placeholder="选择类型" />
                        </SelectTrigger>
                        <SelectContent :class="innerOverlayClass">
                            <SelectItem value="system">系统提示词</SelectItem>
                            <SelectItem value="user">用户提示词</SelectItem>
                            <SelectItem value="assistant">助手提示词</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <!-- 提示词内容 -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <Label>提示词内容 <span class="text-destructive">*</span></Label>
                        <Button type="button" variant="ghost" size="sm" @click="insertVariable">
                            <Plus class="h-3 w-3 mr-1" />
                            插入变量
                        </Button>
                    </div>
                    <GeneralRichTextEditor v-model="form.content" placeholder="输入提示词内容，使用 {{变量名}} 格式插入变量"
                        output-format="markdown" :show-toolbar="true" content-class="min-h-[250px]" />
                    <p class="text-xs text-muted-foreground">
                        支持 Markdown 格式和变量占位符，变量格式：双花括号variableName双花括号
                    </p>
                </div>

                <!-- 提取的变量 -->
                <div v-if="extractedVariables.length" class="space-y-2">
                    <Label class="text-muted-foreground">检测到的变量</Label>
                    <div class="flex flex-wrap gap-2">
                        <Badge v-for="(v, index) in extractedVariables" :key="index" variant="outline">
                            {{ formatVariable(v) }}
                        </Badge>
                    </div>
                </div>
            </div>
            <DialogFooter class="shrink-0">
                <Button variant="outline" @click="open = false">取消</Button>
                <Button @click="handleSubmit" :disabled="submitting">
                    <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                    {{ isEdit ? '保存（创建新版本）' : '创建' }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <!-- 插入变量对话框 -->
    <Dialog v-model:open="variableDialogOpen">
        <DialogContent class="max-w-sm" :class="innerContentClass" :overlay-class="innerOverlayClass">
            <DialogHeader>
                <DialogTitle>插入变量</DialogTitle>
                <DialogDescription>输入变量名称，将自动插入到提示词内容中</DialogDescription>
            </DialogHeader>
            <div class="space-y-4 py-4">
                <div class="space-y-2">
                    <Label>变量名称</Label>
                    <Input v-model="newVariable" placeholder="如：caseInfo" @keyup.enter="confirmInsertVariable" />
                </div>
                <div class="space-y-2">
                    <Label class="text-muted-foreground">常用变量</Label>
                    <div class="flex flex-wrap gap-2">
                        <Badge v-for="v in commonVariables" :key="v" variant="outline" class="cursor-pointer"
                            @click="newVariable = v">
                            {{ v }}
                        </Badge>
                    </div>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" @click="variableDialogOpen = false">取消</Button>
                <Button @click="confirmInsertVariable" :disabled="!newVariable.trim()">插入</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Loader2, Plus } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { PromptWithRelations } from '#shared/types/node'
import GeneralRichTextEditor from '~/components/general/RichTextEditor.vue'
import { useApiFetch } from '~/composables/useApiFetch'

// 定义 props
// nestedZIndex：嵌套打开（如从 NodeFormDialog 内部打开）时传入更高 z-index，
// 默认沿用 shadcn Dialog 的 z-50。Phase 8 节点弹框新增提示词 tab 场景下传入 200+。
const props = defineProps<{
    nestedZIndex?: number
}>()

// 定义事件
const emit = defineEmits<{
    success: []
    /** 新建/保存成功后回传新 prompt id（Phase 8 嵌套场景用于自动选中） */
    created: [id: number]
}>()

// 对话框状态
const open = defineModel<boolean>('open', { default: false })
const isEdit = ref(false)
const submitting = ref(false)
const selectedPrompt = ref<PromptWithRelations | null>(null)

// 嵌套 z-index 计算：内层 SelectContent / 二级 Dialog 再 +10 压过本层
const overlayClass = computed(() => (props.nestedZIndex ? `z-[${props.nestedZIndex - 1}]` : ''))
const contentClass = computed(() => (props.nestedZIndex ? `z-[${props.nestedZIndex}]` : ''))
const innerContentClass = computed(() => (props.nestedZIndex ? `z-[${props.nestedZIndex + 10}]` : ''))
const innerOverlayClass = computed(() => (props.nestedZIndex ? `z-[${props.nestedZIndex + 9}]` : ''))

/**
 * Tailwind v4 JIT 安全清单锚点：
 * 上面的 `z-[xxx]` 是运行时拼接，JIT 扫不到字面量；这里把所有可能用到的 z-index 类
 * 以静态字符串形式列出，让 JIT 在源码扫描时生成对应 CSS。如新增其它 nestedZIndex
 * 取值，必须同步在此处补上对应静态串。
 *
 * 当前支持：nestedZIndex = 200
 *   外层 Dialog: z-[200] / z-[199]
 *   嵌套 Select / 内层 Dialog: z-[210] / z-[209]
 */
// safelist: z-[199] z-[200] z-[209] z-[210]

// 变量插入对话框
const variableDialogOpen = ref(false)
const newVariable = ref('')
const commonVariables = ['caseInfo', 'materials', 'plaintiff', 'defendant', 'caseType', 'extractedInfo']

// 表单数据
const form = ref(getDefaultForm())

// 获取默认表单值
function getDefaultForm() {
    return {
        name: '',
        title: '',
        content: '',
        type: '',
    }
}

// 计算属性：提取的变量
const extractedVariables = computed(() => {
    const regex = /\{\{(\w+)\}\}/g
    const variables: string[] = []
    let match
    while ((match = regex.exec(form.value.content)) !== null) {
        const varName = match[1]
        if (varName && !variables.includes(varName)) {
            variables.push(varName)
        }
    }
    return variables
})

// 格式化变量显示
const formatVariable = (v: string) => {
    return `\{\{${v}\}\}`
}

// 重置表单
const resetForm = () => {
    form.value = getDefaultForm()
}

// 插入变量
const insertVariable = () => {
    newVariable.value = ''
    variableDialogOpen.value = true
}

// 确认插入变量
const confirmInsertVariable = () => {
    const varName = newVariable.value.trim()
    if (varName) {
        form.value.content += `{{${varName}}}`
        variableDialogOpen.value = false
        newVariable.value = ''
    }
}

// 打开创建对话框
const openCreate = () => {
    isEdit.value = false
    selectedPrompt.value = null
    resetForm()
    open.value = true
}

// 打开编辑对话框
const openEdit = (prompt: PromptWithRelations) => {
    isEdit.value = true
    selectedPrompt.value = prompt
    form.value = {
        name: prompt.name,
        title: prompt.title || '',
        content: prompt.content,
        type: prompt.type,
    }
    open.value = true
}

// 提交表单
const handleSubmit = async () => {
    // 验证必填字段
    if (!isEdit.value) {
        if (!form.value.name) {
            toast.error('请输入提示词名称')
            return
        }
        if (!form.value.type) {
            toast.error('请选择提示词类型')
            return
        }
    }
    if (!form.value.content) {
        toast.error('请输入提示词内容')
        return
    }

    submitting.value = true
    try {
        let result: { id: number } | null = null
        if (isEdit.value && selectedPrompt.value) {
            // 编辑模式：创建新版本（节点关联通过 node_prompts 表 PATCH 维护，本接口不再传 nodeId）
            // version 在已有版本号末尾追加时间戳，避免与现有同名版本冲突
            const oldVersion = selectedPrompt.value.version || 'v1'
            const nextVersion = `${oldVersion}-${Date.now()}`
            result = await useApiFetch<{ id: number }>('/api/v1/admin/prompts', {
                method: 'POST',
                body: {
                    name: selectedPrompt.value.name,
                    title: form.value.title || null,
                    content: form.value.content,
                    type: selectedPrompt.value.type,
                    variables: extractedVariables.value,
                    version: nextVersion,
                    status: 1,
                },
            })
        } else {
            // 创建模式（节点关联通过 node_prompts 表 PATCH 维护，本接口不再传 nodeId）
            result = await useApiFetch<{ id: number }>('/api/v1/admin/prompts', {
                method: 'POST',
                body: {
                    name: form.value.name,
                    title: form.value.title || null,
                    content: form.value.content,
                    type: form.value.type,
                    variables: extractedVariables.value,
                    version: 'v1',
                    status: 1,
                },
            })
        }

        if (result) {
            toast.success(isEdit.value ? '新版本创建成功' : '创建成功')
            open.value = false
            emit('success')
            if (typeof result.id === 'number') {
                emit('created', result.id)
            }
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
