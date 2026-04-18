<template>
    <div class="p-4 md:p-6 space-y-6">
        <!-- 页面标题 -->
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
                <h1 class="text-2xl md:text-3xl font-bold mb-1">我的文书模板</h1>
                <p class="text-muted-foreground text-sm">管理个人文书模板</p>
            </div>
            <Tooltip>
                <TooltipTrigger as-child>
                    <Button
                        @click="openUploadDialog"
                        :disabled="quotaReached"
                    >
                        <Upload class="h-4 w-4 mr-2" />
                        上传模板
                    </Button>
                </TooltipTrigger>
                <TooltipContent v-if="quotaReached">
                    已达配额上限，请先删除不用的模板
                </TooltipContent>
            </Tooltip>
        </div>

        <!-- 配额提示 -->
        <div class="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <div class="flex items-center justify-between">
                <div>
                    <p class="text-sm font-medium text-foreground">模板配额</p>
                    <p class="text-xs text-muted-foreground mt-1">每个用户最多可上传 20 个私人模板</p>
                </div>
                <div class="text-right">
                    <p class="text-2xl font-bold text-primary">{{ templateCount }}/20</p>
                </div>
            </div>
        </div>

        <!-- 筛选 -->
        <div class="flex flex-col md:flex-row gap-4">
            <Select v-model="categoryFilter">
                <SelectTrigger class="w-full md:w-52">
                    <SelectValue placeholder="选择分类" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">全部分类</SelectItem>
                    <SelectItem v-for="cat in DOCUMENT_CATEGORIES" :key="cat.key" :value="cat.key">
                        {{ cat.label }}
                    </SelectItem>
                </SelectContent>
            </Select>
            <Select v-model="statusFilter">
                <SelectTrigger class="w-full md:w-32">
                    <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="1">启用</SelectItem>
                    <SelectItem value="0">禁用</SelectItem>
                </SelectContent>
            </Select>
            <div class="flex-1">
                <Input
                    v-model="keyword"
                    placeholder="搜索模板名称..."
                    class="w-full md:w-64"
                />
            </div>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="flex justify-center py-12">
            <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
        </div>

        <!-- 空状态 -->
        <div v-else-if="!templates.length" class="flex flex-col items-center justify-center py-12 text-center">
            <FileText class="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 class="text-lg font-medium mb-1">暂无模板</h3>
            <p class="text-muted-foreground text-sm">点击上方按钮上传文书模板</p>
        </div>

        <!-- 模板列表 -->
        <template v-else>
            <!-- 桌面表格 -->
            <div v-if="isDesktop" class="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>模板名称</TableHead>
                            <TableHead class="w-[160px]">分类</TableHead>
                            <TableHead class="w-[100px]">占位符数</TableHead>
                            <TableHead class="w-[80px]">状态</TableHead>
                            <TableHead class="w-[160px]">创建时间</TableHead>
                            <TableHead class="w-[100px] text-right">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <TableRow v-for="tpl in templates" :key="tpl.id">
                            <TableCell>
                                <div>
                                    <div class="font-medium">{{ tpl.name }}</div>
                                    <div v-if="tpl.description" class="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">
                                        {{ tpl.description }}
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell>
                                <Badge variant="secondary">{{ getCategoryLabel(tpl.category) }}</Badge>
                            </TableCell>
                            <TableCell>
                                <span class="text-sm text-muted-foreground">
                                    {{ (Array.isArray(tpl.placeholders) ? tpl.placeholders.length : 0) }} 个
                                </span>
                            </TableCell>
                            <TableCell>
                                <Badge :variant="tpl.status === 1 ? 'default' : 'secondary'">
                                    {{ tpl.status === 1 ? '启用' : '禁用' }}
                                </Badge>
                            </TableCell>
                            <TableCell class="text-sm text-muted-foreground">
                                {{ formatDate(tpl.createdAt) }}
                            </TableCell>
                            <TableCell class="text-right">
                                <DropdownMenu>
                                    <DropdownMenuTrigger as-child>
                                        <Button variant="ghost" size="icon">
                                            <MoreHorizontal class="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem @click="openEditDialog(tpl)">
                                            <Pencil class="h-4 w-4 mr-2" />
                                            编辑元信息
                                        </DropdownMenuItem>
                                        <DropdownMenuItem @click="handleToggleStatus(tpl)">
                                            <Power class="h-4 w-4 mr-2" />
                                            {{ tpl.status === 1 ? '禁用' : '启用' }}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem class="text-destructive" @click="handleDelete(tpl)">
                                            <Trash2 class="h-4 w-4 mr-2" />
                                            删除
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>

            <!-- 移动卡片 -->
            <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div
                    v-for="tpl in templates"
                    :key="tpl.id"
                    class="group relative flex gap-3 rounded-xl border border-border bg-card p-3.5 transition-all hover:border-primary/60 hover:shadow-lg hover:-translate-y-0.5"
                    :class="{ 'opacity-60': tpl.status !== 1 }"
                >
                    <!-- 左侧图标 -->
                    <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300">
                        <FileText class="size-5" />
                    </div>

                    <!-- 主体内容 -->
                    <div class="flex-1 min-w-0 flex flex-col">
                        <!-- 第一行：名称 + 禁用小标 + 菜单 -->
                        <div class="flex items-start gap-1.5">
                            <h3 class="flex-1 min-w-0 text-sm font-medium leading-snug line-clamp-2">{{ tpl.name }}</h3>
                            <span
                                v-if="tpl.status !== 1"
                                class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >已禁用</span>
                            <DropdownMenu>
                                <DropdownMenuTrigger as-child>
                                    <Button variant="ghost" size="icon" class="size-6 shrink-0 -mr-1">
                                        <MoreHorizontal class="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem @click="openEditDialog(tpl)">
                                        <Pencil class="h-4 w-4 mr-2" />
                                        编辑元信息
                                    </DropdownMenuItem>
                                    <DropdownMenuItem @click="handleToggleStatus(tpl)">
                                        <Power class="h-4 w-4 mr-2" />
                                        {{ tpl.status === 1 ? '禁用' : '启用' }}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem class="text-destructive" @click="handleDelete(tpl)">
                                        <Trash2 class="h-4 w-4 mr-2" />
                                        删除
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        <!-- 描述 -->
                        <p v-if="tpl.description" class="text-xs text-muted-foreground mt-1 line-clamp-1">
                            {{ tpl.description }}
                        </p>

                        <!-- 底部：分类 -->
                        <div class="mt-2">
                            <span class="inline-block rounded bg-muted/70 px-1.5 py-0.5 text-xs text-foreground/70">{{ getCategoryLabel(tpl.category) }}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 分页 -->
            <GeneralPagination
                :current-page="pagination.page"
                :page-size="pagination.pageSize"
                :total="pagination.total"
                @change="changePage"
            />
        </template>
    </div>

    <!-- 上传对话框 -->
    <Dialog v-model:open="uploadDialogOpen">
        <DialogContent class="sm:max-w-[500px]">
            <DialogHeader>
                <DialogTitle>上传文书模板</DialogTitle>
                <DialogDescription>上传 .docx 格式的模板文件（≤ 20MB），系统将自动扫描占位符。</DialogDescription>
            </DialogHeader>
            <div class="space-y-4">
                <!-- 文件选择 -->
                <div class="space-y-2">
                    <Label>模板文件 <span class="text-destructive">*</span></Label>
                    <div
                        class="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                        @click="triggerFileInput"
                        @dragover.prevent
                        @drop.prevent="handleFileDrop">
                        <input ref="fileInputRef" type="file" accept=".docx" class="hidden" @change="handleFileSelect" />
                        <template v-if="uploadForm.file">
                            <FileText class="h-8 w-8 mx-auto mb-2 text-primary" />
                            <p class="text-sm font-medium">{{ uploadForm.file.name }}</p>
                            <p class="text-xs text-muted-foreground">{{ formatFileSize(uploadForm.file.size) }}</p>
                        </template>
                        <template v-else>
                            <Upload class="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                            <p class="text-sm text-muted-foreground">点击或拖拽上传 .docx 文件</p>
                        </template>
                    </div>
                </div>
                <!-- 名称 -->
                <div class="space-y-2">
                    <Label for="upload-name">模板名称 <span class="text-destructive">*</span></Label>
                    <Input id="upload-name" v-model="uploadForm.name" placeholder="请输入模板名称" />
                </div>
                <!-- 分类 -->
                <div class="space-y-2">
                    <Label>分类 <span class="text-destructive">*</span></Label>
                    <Select v-model="uploadForm.category">
                        <SelectTrigger>
                            <SelectValue placeholder="请选择分类" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="cat in DOCUMENT_CATEGORIES" :key="cat.key" :value="cat.key">
                                {{ cat.label }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <!-- 描述 -->
                <div class="space-y-2">
                    <Label for="upload-desc">描述</Label>
                    <Textarea id="upload-desc" v-model="uploadForm.description" placeholder="请输入模板描述（可选）"
                        :rows="3" />
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" @click="uploadDialogOpen = false" :disabled="uploading">取消</Button>
                <Button @click="confirmUpload" :disabled="uploading || !uploadForm.file || !uploadForm.name || !uploadForm.category">
                    <Loader2 v-if="uploading" class="h-4 w-4 mr-2 animate-spin" />
                    {{ uploading ? '上传中...' : '确认上传' }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <!-- 编辑元信息对话框 -->
    <Dialog v-model:open="editDialogOpen">
        <DialogContent class="sm:max-w-[500px]">
            <DialogHeader>
                <DialogTitle>编辑模板元信息</DialogTitle>
                <DialogDescription>修改模板的名称、分类、描述和状态。</DialogDescription>
            </DialogHeader>
            <div class="space-y-4">
                <!-- 名称 -->
                <div class="space-y-2">
                    <Label for="edit-name">模板名称 <span class="text-destructive">*</span></Label>
                    <Input id="edit-name" v-model="editForm.name" placeholder="请输入模板名称" />
                </div>
                <!-- 分类 -->
                <div class="space-y-2">
                    <Label>分类</Label>
                    <Select v-model="editForm.category">
                        <SelectTrigger>
                            <SelectValue placeholder="请选择分类" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="cat in DOCUMENT_CATEGORIES" :key="cat.key" :value="cat.key">
                                {{ cat.label }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <!-- 描述 -->
                <div class="space-y-2">
                    <Label for="edit-desc">描述</Label>
                    <Textarea id="edit-desc" v-model="editForm.description" placeholder="请输入模板描述（可选）"
                        :rows="3" />
                </div>
                <!-- 状态 -->
                <div class="space-y-2">
                    <Label>状态</Label>
                    <Select v-model="editForm.statusStr">
                        <SelectTrigger>
                            <SelectValue placeholder="请选择状态" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">启用</SelectItem>
                            <SelectItem value="0">禁用</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" @click="editDialogOpen = false" :disabled="saving">取消</Button>
                <Button @click="confirmEdit" :disabled="saving || !editForm.name">
                    <Loader2 v-if="saving" class="h-4 w-4 mr-2 animate-spin" />
                    {{ saving ? '保存中...' : '保存' }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <!-- 删除确认对话框 -->
    <AlertDialog v-model:open="deleteDialogOpen">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>确认删除</AlertDialogTitle>
                <AlertDialogDescription>
                    确定要删除模板「{{ selectedTemplate?.name }}」吗？此操作为软删除，不可从列表恢复。
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction @click="confirmDelete" :disabled="deleting">
                    <Loader2 v-if="deleting" class="h-4 w-4 mr-2 animate-spin" />
                    确认删除
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>

<script setup lang="ts">
import {
    Upload, Loader2, FileText,
    MoreHorizontal, Pencil, Trash2, Power,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useMediaQuery, refDebounced } from '@vueuse/core'
import { DOCUMENT_CATEGORIES } from '#shared/types/document'
import type { DocumentCategoryKey } from '#shared/types/document'
import type { documentTemplates } from '#shared/types/prisma'

definePageMeta({
    layout: 'dashboard-layout',
    title: '文书模板',
    icon: 'FileText',
})

// ─── 类型 ───────────────────────────────────────────────────────────────────
// API 经 HTTP 序列化后 createdAt 为 ISO 字符串，覆盖 Prisma 的 Date 类型定义
type TemplateRow = Pick<documentTemplates,
    'id' | 'name' | 'category' | 'scope' | 'description' | 'status' | 'placeholders'
> & { createdAt: string }

// ─── 状态 ────────────────────────────────────────────────────────────────────
const { formatDate } = useFormatters()

const loading = ref(false)
const templates = ref<TemplateRow[]>([])
const templateCount = ref(0)
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const categoryFilter = ref('all')
const statusFilter = ref('all')
const keyword = ref('')

// PC 表格，移动卡片（与 DraftHistory 一致，阈值 768px）
const isDesktop = useMediaQuery('(min-width: 768px)')

const quotaReached = computed(() => templateCount.value >= 20)

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────
const getCategoryLabel = (key: string) =>
    DOCUMENT_CATEGORIES.find(c => c.key === key)?.label ?? key

const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ─── 加载列表 ─────────────────────────────────────────────────────────────────
const loadTemplates = async () => {
    loading.value = true
    try {
        // 该页面仅管理用户个人模板（scope='user' + 当前用户的 userId，由后端 DAO 过滤）。
        // 不展示系统全局模板；配额计数直接使用 total。
        const params: Record<string, any> = {
            scope: 'user',
            skip: 0,
            take: 100,
        }
        if (categoryFilter.value !== 'all') params.category = categoryFilter.value
        if (keyword.value.trim()) params.q = keyword.value.trim()

        const data = await useApiFetch<{ list: TemplateRow[]; total: number }>(
            '/api/v1/assistant/document/templates',
            { query: params }
        )
        if (data) {
            templateCount.value = data.total
            const filtered = statusFilter.value === 'all'
                ? data.list
                : data.list.filter(t => t.status === Number(statusFilter.value))
            // 手动分页
            const start = (pagination.value.page - 1) * pagination.value.pageSize
            templates.value = filtered.slice(start, start + pagination.value.pageSize)
            pagination.value.total = filtered.length
        }
    } finally {
        loading.value = false
    }
}

const handleSearch = () => {
    pagination.value.page = 1
    loadTemplates()
}

// 即时筛选：关键词防抖 300ms；分类/状态变化立即触发。回到第一页。
const debouncedKeyword = refDebounced(keyword, 300)
watch([debouncedKeyword, categoryFilter, statusFilter], handleSearch)

const changePage = (page: number) => {
    pagination.value.page = page
    loadTemplates()
}

const handleToggleStatus = async (tpl: TemplateRow) => {
    const newStatus = tpl.status === 1 ? 0 : 1
    const result = await useApiFetch(`/api/v1/assistant/document/templates/${tpl.id}`, {
        method: 'PATCH',
        body: { status: newStatus },
    })
    if (result !== null) {
        toast.success(newStatus === 1 ? '已启用' : '已禁用')
        loadTemplates()
    }
}

const deleteDialogOpen = ref(false)
const deleting = ref(false)
const selectedTemplate = ref<TemplateRow | null>(null)

const handleDelete = (tpl: TemplateRow) => {
    selectedTemplate.value = tpl
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedTemplate.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(
            `/api/v1/assistant/document/templates/${selectedTemplate.value.id}`,
            { method: 'DELETE' }
        )
        if (result !== null) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadTemplates()
        }
    } finally {
        deleting.value = false
    }
}

const uploadDialogOpen = ref(false)
const uploading = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

const uploadForm = reactive({
    file: null as File | null,
    name: '',
    category: '' as DocumentCategoryKey | '',
    description: '',
})

const resetUploadForm = () => {
    uploadForm.file = null
    uploadForm.name = ''
    uploadForm.category = ''
    uploadForm.description = ''
}

const openUploadDialog = () => {
    resetUploadForm()
    uploadDialogOpen.value = true
}

const triggerFileInput = () => fileInputRef.value?.click()

const handleFileSelect = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) applyFile(file)
}

const handleFileDrop = (e: DragEvent) => {
    const file = e.dataTransfer?.files?.[0]
    if (file) applyFile(file)
}

const applyFile = (file: File) => {
    if (!file.name.endsWith('.docx')) {
        toast.error('仅支持 .docx 格式文件')
        return
    }
    if (file.size > 20 * 1024 * 1024) {
        toast.error('文件大小不能超过 20MB')
        return
    }
    uploadForm.file = file
    if (!uploadForm.name) {
        uploadForm.name = file.name.replace(/\.docx$/i, '')
    }
}

const confirmUpload = async () => {
    if (!uploadForm.file || !uploadForm.name.trim() || !uploadForm.category) return

    uploading.value = true
    try {
        const formData = new FormData()
        formData.append('file', uploadForm.file)
        formData.append('name', uploadForm.name.trim())
        formData.append('category', uploadForm.category)
        if (uploadForm.description.trim()) {
            formData.append('description', uploadForm.description.trim())
        }

        const result = await useApiFetch<{ templateId: number }>(
            '/api/v1/assistant/document/templates',
            { method: 'POST', body: formData }
        )
        if (result !== null) {
            toast.success('上传成功')
            uploadDialogOpen.value = false
            loadTemplates()
        }
    } finally {
        uploading.value = false
    }
}

const editDialogOpen = ref(false)
const saving = ref(false)

const editForm = reactive({
    id: 0,
    name: '',
    category: '' as DocumentCategoryKey | '',
    description: '',
    statusStr: '1',
})

const openEditDialog = (tpl: TemplateRow) => {
    editForm.id = tpl.id
    editForm.name = tpl.name
    editForm.category = tpl.category as DocumentCategoryKey
    editForm.description = tpl.description ?? ''
    editForm.statusStr = String(tpl.status)
    editDialogOpen.value = true
}

const confirmEdit = async () => {
    if (!editForm.name.trim()) return
    saving.value = true
    try {
        const body: Record<string, any> = {
            name: editForm.name.trim(),
            category: editForm.category,
            description: editForm.description.trim() || undefined,
            status: Number(editForm.statusStr),
        }
        const result = await useApiFetch(
            `/api/v1/assistant/document/templates/${editForm.id}`,
            { method: 'PATCH', body }
        )
        if (result !== null) {
            toast.success('保存成功')
            editDialogOpen.value = false
            loadTemplates()
        }
    } finally {
        saving.value = false
    }
}

onMounted(loadTemplates)
</script>
