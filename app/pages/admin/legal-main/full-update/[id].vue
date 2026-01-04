<template>
    <div class="legal-full-update h-screen flex flex-col">
        <!-- 顶部工具栏 - 响应式布局 -->
        <div class="border-b bg-background">
            <!-- 桌面端：单行布局 -->
            <div v-if="!isMobile" class="px-3 py-3 flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <Button variant="ghost" size="icon" class="h-7 w-7" @click="handleCancel">
                        <ArrowLeft class="h-3.5 w-3.5" />
                    </Button>
                    <div class="flex items-center gap-2">
                        <h1 class="text-sm font-semibold">全量更新法律内容</h1>
                        <span class="text-xs text-muted-foreground">编辑完成后将自动拆分为条文并向量化</span>
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    <!-- 未保存更改提示 - 内联显示 -->
                    <div v-if="editorState.hasUnsavedChanges" class="flex items-center gap-1 text-xs text-amber-600">
                        <AlertCircle class="h-3 w-3" />
                        <span>有未保存的更改</span>
                    </div>

                    <!-- 保存按钮 -->
                    <Button size="sm" class="h-7" :disabled="editorState.saving || !editorState.hasUnsavedChanges"
                        @click="handleSave">
                        <Loader2 v-if="editorState.saving" class="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        <Save v-else class="h-3.5 w-3.5 mr-1.5" />
                        {{ editorState.saving ? '保存中...' : '保存' }}
                    </Button>
                </div>
            </div>

            <!-- 移动端：多行布局 -->
            <div v-else class="px-3 py-2 space-y-2">
                <!-- 第一行：返回按钮 + 标题 -->
                <div class="flex items-center gap-2">
                    <Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" @click="handleCancel">
                        <ArrowLeft class="h-4 w-4" />
                    </Button>
                    <h1 class="text-sm font-semibold truncate">全量更新法律内容</h1>
                </div>

                <!-- 第二行：操作按钮 -->
                <div class="flex items-center justify-between gap-2 pl-10">
                    <!-- 未保存提示 -->
                    <div v-if="editorState.hasUnsavedChanges" class="flex items-center gap-1 text-xs text-amber-600">
                        <AlertCircle class="h-3.5 w-3.5" />
                        <span>未保存</span>
                    </div>
                    <div v-else class="flex-1"></div>

                    <!-- 按钮组 -->
                    <div class="flex items-center gap-2">
                        <!-- 模式切换按钮 -->
                        <Button variant="outline" size="sm" class="h-8" @click="toggleMobileMode">
                            <FileEdit v-if="mobileMode === 'preview'" class="h-3.5 w-3.5 mr-1.5" />
                            <Eye v-else class="h-3.5 w-3.5 mr-1.5" />
                            {{ mobileMode === 'edit' ? '预览' : '编辑' }}
                        </Button>

                        <!-- 保存按钮 -->
                        <Button size="sm" class="h-8" :disabled="editorState.saving || !editorState.hasUnsavedChanges"
                            @click="handleSave">
                            <Loader2 v-if="editorState.saving" class="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            <Save v-else class="h-3.5 w-3.5 mr-1.5" />
                            {{ editorState.saving ? '保存中...' : '保存' }}
                        </Button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 主内容区域 -->
        <div class="flex-1 overflow-hidden">
            <!-- 桌面端：左右分栏布局 -->
            <ResizablePanelGroup v-if="!isMobile" direction="horizontal" class="h-full">
                <!-- 左侧：编辑器 -->
                <ResizablePanel :default-size="50" :min-size="30">
                    <div class="h-full flex flex-col">
                        <div class="border-b px-3 py-2.5 bg-muted/30">
                            <h3 class="text-sm font-medium">内容编辑</h3>
                        </div>
                        <div class="flex-1 overflow-auto p-3">
                            <RichTextEditor :model-value="editorState.content" output-format="markdown"
                                placeholder="请输入法律法规内容..." :show-toolbar="true"
                                @update:model-value="handleContentChange" />
                        </div>
                    </div>
                </ResizablePanel>

                <!-- 拖拽分隔条 -->
                <ResizableHandle />

                <!-- 右侧：预览 -->
                <ResizablePanel :default-size="50" :min-size="30">
                    <LegalArticlePreview :articles="editorState.parsedArticles" :error="editorState.parseError" />
                </ResizablePanel>
            </ResizablePanelGroup>

            <!-- 移动端：单页面切换 -->
            <div v-else class="h-full">
                <!-- 编辑模式 -->
                <div v-show="mobileMode === 'edit'" class="h-full flex flex-col">
                    <div class="border-b px-3 py-1.5 bg-muted/30">
                        <h3 class="text-sm font-medium">内容编辑</h3>
                    </div>
                    <div class="flex-1 overflow-auto p-3">
                        <RichTextEditor :model-value="editorState.content" output-format="markdown"
                            placeholder="请输入法律法规内容..." :show-toolbar="true" @update:model-value="handleContentChange" />
                    </div>
                </div>

                <!-- 预览模式 -->
                <div v-show="mobileMode === 'preview'" class="h-full">
                    <LegalArticlePreview :articles="editorState.parsedArticles" :error="editorState.parseError" />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ArrowLeft, Save, Loader2, AlertCircle, Eye, FileEdit } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import {
    ResizablePanelGroup,
    ResizablePanel,
    ResizableHandle,
} from '~/components/ui/resizable'
import RichTextEditor from '~/components/general/RichTextEditor.vue'
import LegalArticlePreview from '~/components/legal/LegalArticlePreview.vue'
import type { ParsedArticle } from '#shared/types/legal-parser'
import { useDebounceFn } from '@vueuse/core'
import { toast } from 'vue-sonner'

/**
 * 页面元数据
 */
definePageMeta({
    layout: false,
})

/**
 * 路由参数
 */
const route = useRoute()
const router = useRouter()
const legalId = route.params.id as string

/**
 * Composables
 */
const { parse } = useLegalParser()
const { saveDraftToCache, loadDraftFromCache, clearDraftCache } = useLegalEditorCache()

/**
 * 编辑器状态
 */
interface EditorState {
    content: string
    parsedArticles: ParsedArticle[]
    parseError: string | null
    saving: boolean
    hasUnsavedChanges: boolean
}

const editorState = reactive<EditorState>({
    content: '',
    parsedArticles: [],
    parseError: null,
    saving: false,
    hasUnsavedChanges: false,
})

/**
 * 响应式布局状态
 */
const windowWidth = ref(0)
const isMobile = computed(() => windowWidth.value < 768)
const mobileMode = ref<'edit' | 'preview'>('edit')

/**
 * 切换移动端模式
 */
function toggleMobileMode() {
    mobileMode.value = mobileMode.value === 'edit' ? 'preview' : 'edit'
}

/**
 * 监听窗口大小变化
 */
onMounted(() => {
    windowWidth.value = window.innerWidth
    window.addEventListener('resize', () => {
        windowWidth.value = window.innerWidth
    })
})

/**
 * 加载法律内容
 */
async function loadLegalContent() {
    try {
        // 1. 优先从缓存加载草稿
        const cachedContent = loadDraftFromCache(legalId)
        if (cachedContent) {
            editorState.content = cachedContent
            editorState.hasUnsavedChanges = true
            toast.success('已加载草稿', {
                description: '从本地缓存恢复了未保存的内容',
            })

            // 解析缓存的内容
            await parseContentDebounced()
            return
        }

        // 2. 从数据库加载
        const data = await useApiFetch<{ content: string }>(`/api/v1/admin/legal-main/${legalId}`)
        if (data) {
            editorState.content = data.content || ''
            editorState.hasUnsavedChanges = false

            // 解析数据库内容
            if (editorState.content) {
                await parseContentDebounced()
            }
        }
    } catch (error) {
        console.error('加载法律内容失败', { legalId, error })
        toast.error('加载失败', {
            description: '无法加载法律内容，请刷新页面重试',
        })
    }
}

/**
 * 解析内容（防抖）
 */
const parseContentDebounced = useDebounceFn(async () => {
    if (!editorState.content || !editorState.content.trim()) {
        editorState.parsedArticles = []
        editorState.parseError = null
        return
    }

    const articles = await parse(editorState.content)
    if (articles) {
        editorState.parsedArticles = articles
        editorState.parseError = null
    } else {
        editorState.parsedArticles = []
        editorState.parseError = '解析失败，请检查内容格式'
    }
}, 500)

/**
 * 处理内容变化
 */
function handleContentChange(newContent: string) {
    // 更新内容
    editorState.content = newContent

    // 标记为有未保存的更改
    editorState.hasUnsavedChanges = true

    // 自动保存草稿到缓存
    saveDraftToCache(legalId, newContent)

    // 触发实时解析
    parseContentDebounced()
}

/**
 * 处理保存
 */
async function handleSave() {
    if (!editorState.content || !editorState.content.trim()) {
        toast.error('内容不能为空', {
            description: '请输入法律内容后再保存',
        })
        return
    }

    if (editorState.parsedArticles.length === 0) {
        toast.error('解析结果为空', {
            description: '请检查内容格式是否正确',
        })
        return
    }

    editorState.saving = true

    try {
        const result = await useApiFetch<{ articleCount: number }>('/api/v1/admin/legal-articles/batch-save', {
            method: 'POST',
            body: {
                legalId,
                content: editorState.content,
            },
        })

        if (result) {
            // 保存成功，清除缓存
            clearDraftCache(legalId)
            editorState.hasUnsavedChanges = false

            toast.success('保存成功', {
                description: `已保存 ${result.articleCount} 个条文，正在进行向量化...`,
            })

            // 跳转回列表页
            setTimeout(() => {
                router.push('/admin/legal-main')
            }, 1500)
        }
    } catch (error) {
        console.error('保存失败', { legalId, error })
        toast.error('保存失败', {
            description: '请检查网络连接后重试',
        })
    } finally {
        editorState.saving = false
    }
}

/**
 * 处理取消
 */
function handleCancel() {
    router.push(`/admin/legal-main/edit/${legalId}`)
}

/**
 * 键盘快捷键：Ctrl+S / Cmd+S 保存
 */
onMounted(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            handleSave()
        }
    }

    window.addEventListener('keydown', handleKeyDown)

    onUnmounted(() => {
        window.removeEventListener('keydown', handleKeyDown)
    })
})

/**
 * 页面加载时加载内容
 */
onMounted(() => {
    loadLegalContent()
})
</script>

<style scoped>
/* 确保页面占满整个视口 */
.legal-full-update {
    height: 100vh;
    overflow: hidden;
}
</style>
