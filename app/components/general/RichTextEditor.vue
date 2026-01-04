<template>
    <div class="rich-text-editor">
        <!-- 编辑器容器 -->
        <ClientOnly>
            <div v-if="editor" class="border rounded-lg overflow-hidden">
                <!-- 使用 shadcn-vue tiptap 组件 -->
                <TiptapProvider :editor="editor">
                    <!-- 工具栏容器 -->
                    <div v-if="showToolbar" class="border-b bg-muted/30">
                        <div class="flex items-center justify-between p-2">
                            <!-- 工具栏 -->
                            <TiptapToolbar class="flex-1 border-0 p-0">
                                <!-- 源码模式切换按钮（放在代码块按钮后） -->
                                <template v-if="outputFormat === 'markdown'" #after-code-block>
                                    <Tooltip>
                                        <TooltipTrigger as-child>
                                            <Button size="icon" variant="ghost" :class="{ 'bg-accent': isSourceMode }"
                                                @click="toggleSourceMode">
                                                <FileCode class="h-5 w-5" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>{{ isSourceMode ? '所见即所得模式' : '源码模式' }}</TooltipContent>
                                    </Tooltip>
                                </template>
                            </TiptapToolbar>
                        </div>
                    </div>

                    <!-- 所见即所得模式 -->
                    <TiptapContent v-show="!isSourceMode" class="min-h-[200px] markdown-body" :class="contentClass" />

                    <!-- 源码模式 -->
                    <div v-show="isSourceMode" class="min-h-[200px] p-4">
                        <Textarea v-model="sourceContent" :placeholder="placeholder"
                            class="min-h-[200px] font-mono text-sm resize-none border-0 focus-visible:ring-0 p-0"
                            @input="handleSourceInput" />
                    </div>
                </TiptapProvider>
            </div>
            <template #fallback>
                <div class="border rounded-lg p-4 min-h-[200px] flex items-center justify-center">
                    <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            </template>
        </ClientOnly>
    </div>
</template>

<script setup lang="ts">
import { useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { Markdown } from 'tiptap-markdown'
import { Loader2, FileCode } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
// 引入 github-markdown-css 样式（浅色和深色模式）
import 'github-markdown-css/github-markdown.css'

/** 输出格式类型 */
type OutputFormat = 'html' | 'markdown'

/** Props 定义 */
const props = withDefaults(defineProps<{
    /** 编辑器内容（v-model） */
    modelValue?: string
    /** 占位符文本 */
    placeholder?: string
    /** 是否显示工具栏 */
    showToolbar?: boolean
    /** 内容区域自定义样式类 */
    contentClass?: string
    /** 是否可编辑 */
    editable?: boolean
    /** 最大字符数限制 */
    maxLength?: number
    /** 输出格式：html 或 markdown */
    outputFormat?: OutputFormat
}>(), {
    modelValue: '',
    placeholder: '请输入内容...',
    showToolbar: true,
    contentClass: '',
    editable: true,
    maxLength: undefined,
    outputFormat: 'html',
})

/** Emits 定义 */
const emit = defineEmits<{
    'update:modelValue': [value: string]
    'blur': []
    'focus': []
}>()

/** 源码模式状态 */
const isSourceMode = ref(false)
const sourceContent = ref('')

/** 字数统计 */
const wordCount = computed(() => {
    if (!editor.value || !editor.value.isEditable) {
        return { characters: 0, words: 0 }
    }
    const text = editor.value.state.doc.textContent || ''
    return {
        characters: text.length,
        words: text.split(/\s+/).filter(word => word.length > 0).length,
    }
})

/** 获取编辑器内容（根据输出格式） */
function getEditorContent(editorInstance: any): string {
    if (!editorInstance) return ''
    if (props.outputFormat === 'markdown') {
        // tiptap-markdown 扩展将 getMarkdown 方法存储在 storage.markdown 中
        return editorInstance.storage?.markdown?.getMarkdown?.() || ''
    }
    return editorInstance.getHTML()
}

/** 创建编辑器实例 */
const editor = useEditor({
    content: props.modelValue,
    editable: props.editable,
    extensions: [
        StarterKit,
        Placeholder.configure({
            placeholder: props.placeholder,
        }),
        CharacterCount.configure({
            limit: props.maxLength,
        }),
        // Markdown 扩展：支持 Markdown 输入和输出
        // 注意：tiptap-markdown 内部已包含 link 扩展，无需单独引入
        Markdown.configure({
            html: true, // 允许 HTML 标签
            tightLists: true, // 紧凑列表
            tightListClass: 'tight', // 紧凑列表类名
            bulletListMarker: '-', // 无序列表标记
            linkify: true, // 自动识别链接
            breaks: false, // 不将换行转为 <br>
            transformPastedText: true, // 转换粘贴的文本
            transformCopiedText: true, // 转换复制的文本
        }),
    ],
    onUpdate: ({ editor }) => {
        if (!isSourceMode.value) {
            emit('update:modelValue', getEditorContent(editor))
        }
    },
    onBlur: () => {
        emit('blur')
    },
    onFocus: () => {
        emit('focus')
    },
})

/** 切换源码模式 */
function toggleSourceMode() {
    if (!editor.value) return

    if (isSourceMode.value) {
        // 从源码模式切换到所见即所得模式
        // 将源码内容同步到编辑器
        editor.value.commands.setContent(sourceContent.value, { emitUpdate: false })
        emit('update:modelValue', getEditorContent(editor.value))
        isSourceMode.value = false
    } else {
        // 从所见即所得模式切换到源码模式
        // 将编辑器内容同步到源码
        sourceContent.value = getEditorContent(editor.value)
        isSourceMode.value = true
    }
}

/** 处理源码输入 */
function handleSourceInput() {
    emit('update:modelValue', sourceContent.value)
}

/** 监听 modelValue 变化，同步到编辑器 */
watch(() => props.modelValue, (newValue) => {
    if (editor.value) {
        if (isSourceMode.value) {
            // 源码模式：直接更新源码内容
            if (sourceContent.value !== newValue) {
                sourceContent.value = newValue || ''
            }
        } else {
            // 所见即所得模式：更新编辑器内容
            const currentContent = getEditorContent(editor.value)
            if (currentContent !== newValue) {
                editor.value.commands.setContent(newValue || '', { emitUpdate: false })
            }
        }
    }
})

/** 监听 editable 变化 */
watch(() => props.editable, (newValue) => {
    if (editor.value) {
        editor.value.setEditable(newValue)
    }
})

/** 组件卸载时销毁编辑器 */
onBeforeUnmount(() => {
    editor.value?.destroy()
})

/** 暴露编辑器实例供外部使用 */
defineExpose({
    editor,
    /** 获取纯文本内容 */
    getText: () => editor.value?.getText() || '',
    /** 获取 HTML 内容 */
    getHTML: () => editor.value?.getHTML() || '',
    /** 获取 Markdown 内容 */
    getMarkdown: () => (editor.value?.storage as any)?.markdown?.getMarkdown?.() || '',
    /** 获取当前格式的内容 */
    getContent: () => editor.value ? getEditorContent(editor.value) : '',
    /** 设置内容 */
    setContent: (content: string) => editor.value?.commands.setContent(content),
    /** 清空内容 */
    clear: () => editor.value?.commands.clearContent(),
    /** 聚焦编辑器 */
    focus: () => editor.value?.commands.focus(),
    /** 切换源码模式 */
    toggleSourceMode,
    /** 获取源码模式状态 */
    isSourceMode: () => isSourceMode.value,
})
</script>

<style>
/* 编辑器内容区域基础样式 */
.rich-text-editor .ProseMirror {
    padding: 1rem;
    outline: none;
    min-height: 200px;
}

/* 占位符样式 */
.rich-text-editor .ProseMirror p.is-editor-empty:first-child::before {
    color: var(--muted-foreground);
    pointer-events: none;
    float: left;
    height: 0;
    content: attr(data-placeholder);
}

/* 覆盖 github-markdown-css 的背景色，使用透明背景 */
.rich-text-editor .markdown-body {
    background-color: transparent;
    /* 使用 CSS 变量适配深色模式的文字颜色 */
    color: var(--foreground);
}

/* 深色模式下的代码块样式适配 */
.dark .rich-text-editor .markdown-body pre {
    background-color: var(--muted);
}

.dark .rich-text-editor .markdown-body code {
    background-color: var(--muted);
}

/* 确保编辑器内的链接可点击 */
.rich-text-editor .ProseMirror a {
    cursor: pointer;
}
</style>
