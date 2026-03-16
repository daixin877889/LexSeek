# 云盘空间批量删除功能实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在云盘空间页面实现批量删除功能，支持用户选择多个文件进行批量删除

**Architecture:**
- 在 disk-space.vue 中管理选中状态（selectedFileIds Set）
- 新增 BatchToolbar 组件显示在视口底部，提供全选、取消选择、批量删除操作
- 修改三个文件列表组件（fileListGrid、fileListTable、FileListMobile）添加复选框和选中样式
- 新增服务端批量删除 API 接口

**Tech Stack:** Vue 3 Composition API, TypeScript, Pinia Store, Tailwind CSS, Shadcn-vue 组件库

---

## Chunk 1: 新增 BatchToolbar 组件

### Task 1: 创建 BatchToolbar.vue 组件

**Files:**
- Create: `app/components/diskSpace/BatchToolbar.vue`

- [ ] **Step 1: 创建组件文件**

```vue
<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-300"
      enter-from-class="translate-y-full opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition-all duration-200"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-full opacity-0"
    >
      <div v-if="visible" class="fixed bottom-0 left-0 right-0 z-50">
        <div class="bg-card border-t border-border shadow-lg">
          <div class="container mx-auto px-4 py-3 flex items-center justify-between">
            <!-- 左侧：选择和计数 -->
            <div class="flex items-center gap-3">
              <Checkbox
                :checked="isAllSelected"
                @update:checked="$emit('selectAll')"
              />
              <span class="text-sm text-foreground">已选择 {{ selectedCount }} 个文件</span>
              <Button variant="link" size="sm" @click="$emit('clearSelection')">
                取消选择
              </Button>
            </div>

            <!-- 右侧：删除按钮 -->
            <Button
              variant="destructive"
              @click="$emit('batchDelete')"
              :disabled="deleting"
            >
              <Trash2Icon v-if="!deleting" class="h-4 w-4 mr-1" />
              <div v-else class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
              {{ deleting ? '删除中...' : '批量删除' }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts" setup>
import { Checkbox } from '@/components/ui/checkbox'
import { Trash2Icon } from 'lucide-vue-next'

interface Props {
  selectedCount: number
  totalCount: number
  isAllSelected: boolean
  visible: boolean
  deleting?: boolean
}

defineProps<Props>()

defineEmits<{
  (e: 'selectAll'): void
  (e: 'clearSelection'): void
  (e: 'batchDelete'): void
}>()
</script>
```

- [ ] **Step 2: 验证组件语法**

Run: `bun run typecheck`
Expected: 无 TypeScript 错误

---

## Chunk 2: 修改文件列表组件添加复选框

### Task 2: 修改 fileListGrid.vue

**Files:**
- Modify: `app/components/diskSpace/fileListGrid.vue`

- [ ] **Step 1: 修改 Props 和 Emits**

```typescript
// 在 script 开头添加
import { Checkbox } from '@/components/ui/checkbox'

interface Props {
  files: OssFileItem[]
  selectedFileIds: Set<number>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'click', file: OssFileItem): void
  (e: 'toggleSelect', fileId: number): void
}>()
```

- [ ] **Step 2: 修改模板 - 文件卡片**

```vue
<div v-for="file in files" :key="file.id"
  :class="[
    'group bg-card rounded-lg border p-4 hover:shadow-md transition-all cursor-pointer relative',
    props.selectedFileIds.has(file.id)
      ? 'border-primary bg-primary/5'
      : 'border-border hover:border-primary/50'
  ]"
  @click="emit('toggleSelect', file.id)"
>
  <!-- 复选框 -->
  <div class="absolute top-3 left-3 z-10" @click.stop>
    <Checkbox
      :checked="props.selectedFileIds.has(file.id)"
      @update:checked="emit('toggleSelect', file.id)"
    />
  </div>

  <!-- 原有内容保持不变，删除原有的 @click="$emit('click', file)" -->
  <div class="flex justify-center mb-3">
    <!-- 图片缩略图/文件图标... -->
  </div>
  <!-- 文件名、文件信息、来源标签... -->
</div>
```

- [ ] **Step 3: 验证组件语法**

Run: `bun run typecheck`
Expected: 无 TypeScript 错误

---

### Task 3: 修改 fileListTable.vue

**Files:**
- Modify: `app/components/diskSpace/fileListTable.vue`

- [ ] **Step 1: 修改 Props 和 Emits**

```typescript
import { Checkbox } from '@/components/ui/checkbox'

interface Props {
  files: OssFileItem[]
  selectedFileIds: Set<number>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'click', file: OssFileItem): void
  (e: 'toggleSelect', fileId: number): void
}>()
```

- [ ] **Step 2: 修改表头**

```vue
<!-- 表头 -->
<div class="grid grid-cols-13 gap-4 px-4 py-3 bg-muted border-b border-border text-sm font-medium text-muted-foreground">
  <div class="col-span-1 text-center">选择</div>
  <div class="col-span-6">文件名</div>
  <div class="col-span-2">大小</div>
  <div class="col-span-2">来源</div>
  <div class="col-span-2">上传时间</div>
</div>
```

- [ ] **Step 3: 修改列表项**

```vue
<!-- 文件列表 -->
<div class="divide-y divide-border">
  <div v-for="file in files" :key="file.id"
    :class="[
      'grid grid-cols-13 gap-4 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer items-center',
      props.selectedFileIds.has(file.id) ? 'bg-primary/5' : ''
    ]"
    @click="emit('toggleSelect', file.id)"
  >
    <!-- 复选框 -->
    <div class="col-span-1 flex justify-center" @click.stop>
      <Checkbox
        :checked="props.selectedFileIds.has(file.id)"
        @update:checked="emit('toggleSelect', file.id)"
      />
    </div>

    <!-- 文件名（调整 col-span） -->
    <div class="col-span-6 flex items-center gap-3 min-w-0">
      <!-- 原有内容... -->
    </div>

    <!-- 大小、来源、上传时间（调整 col-span） -->
    <div class="col-span-2 text-sm text-muted-foreground">
      {{ formatByteSize(file.fileSize, 2) }}
    </div>
    <div class="col-span-2">
      <span class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
        {{ file.sourceName }}
      </span>
    </div>
    <div class="col-span-2 text-sm text-muted-foreground">
      {{ formatDate(file.createdAt) }}
    </div>
  </div>
</div>
```

- [ ] **Step 4: 添加 formatByteSize 函数**

```typescript
import { formatByteSize } from '#shared/utils/unitConverision'

// 删除原有的 formatByteSize 函数（如果有的话）
```

- [ ] **Step 5: 验证组件语法**

Run: `bun run typecheck`
Expected: 无 TypeScript 错误

---

### Task 4: 修改 FileListMobile.vue

**Files:**
- Modify: `app/components/diskSpace/FileListMobile.vue`

- [ ] **Step 1: 修改 Props 和 Emits**

```typescript
import { Checkbox } from '@/components/ui/checkbox'

interface Props {
  files: OssFileItem[]
  selectedFileIds: Set<number>
  loading?: boolean
  refreshing?: boolean
  hasMore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  refreshing: false,
  hasMore: true,
})

const emit = defineEmits<{
  (e: 'click', file: OssFileItem): void
  (e: 'loadMore'): void
  (e: 'refresh'): void
  (e: 'toggleSelect', fileId: number): void
}>()
```

- [ ] **Step 2: 修改文件卡片模板**

```vue
<!-- 文件卡片列表 -->
<div class="space-y-3 px-1">
  <div v-for="file in files" :key="file.id"
    :class="[
      'bg-card rounded-lg border p-3 active:bg-muted/50 transition-colors',
      props.selectedFileIds.has(file.id)
        ? 'border-primary bg-primary/5'
        : 'border-border'
    ]"
  >
    <div class="flex items-start gap-3">
      <!-- 复选框 -->
      <div class="shrink-0 pt-1" @click.stop>
        <Checkbox
          :checked="props.selectedFileIds.has(file.id)"
          @update:checked="emit('toggleSelect', file.id)"
        />
      </div>

      <!-- 文件图标/缩略图 -->
      <div class="shrink-0" @click="emit('toggleSelect', file.id)">
        <!-- 原有内容... -->
      </div>

      <!-- 文件信息 -->
      <div class="flex-1 min-w-0" @click="emit('toggleSelect', file.id)">
        <!-- 原有内容... -->
      </div>

      <!-- 右侧箭头 -->
      <ChevronRightIcon
        class="h-5 w-5 text-muted-foreground shrink-0 self-center"
        @click.stop="emit('toggleSelect', file.id)"
      />
    </div>
  </div>
</div>
```

- [ ] **Step 3: 验证组件语法**

Run: `bun run typecheck`
Expected: 无 TypeScript 错误

---

## Chunk 3: 修改主页面集成批量删除

### Task 5: 修改 disk-space.vue 添加状态管理

**Files:**
- Modify: `app/pages/dashboard/disk-space.vue`

- [ ] **Step 1: 添加导入**

```typescript
// 在现有 import 后添加
import { Checkbox } from '@/components/ui/checkbox'
import { Trash2Icon } from 'lucide-vue-next'
import { formatByteSize } from '#shared/utils/unitConverision'
```

- [ ] **Step 2: 添加选中状态管理**

```typescript
// 在响应式数据区域添加
const selectedFileIds = ref<Set<number>>(new Set())

// 计算属性
const hasSelected = computed(() => selectedFileIds.value.size > 0)
const selectedCount = computed(() => selectedFileIds.value.size)
const isCurrentPageAllSelected = computed(() =>
  selectedFileIds.value.size === fileList.value.length && fileList.value.length > 0
)

// 操作方法
const toggleSelect = (fileId: number) => {
  if (selectedFileIds.value.has(fileId)) {
    selectedFileIds.value.delete(fileId)
  } else {
    selectedFileIds.value.add(fileId)
  }
}

const selectAllOnCurrentPage = () => {
  if (isCurrentPageAllSelected.value) {
    selectedFileIds.value.clear()
  } else {
    fileList.value.forEach(file => selectedFileIds.value.add(file.id))
  }
}

const clearSelection = () => {
  selectedFileIds.value.clear()
}
```

- [ ] **Step 3: 添加批量删除方法**

```typescript
const batchDeleting = ref(false)

const batchDelete = async () => {
  if (selectedFileIds.value.size === 0) return

  const fileNames = fileList.value
    .filter(f => selectedFileIds.value.has(f.id))
    .map(f => f.fileName)

  alertDialogStore.showDialog({
    title: '确认删除',
    message: `确定要删除选中的 ${selectedFileIds.value.size} 个文件吗？此操作不可恢复。`,
    confirmText: '删除',
    cancelText: '取消',
    type: 'error',
    showCancel: true,
    onConfirm: () => { executeBatchDelete() },
    onCancel: () => {},
  })
}

const executeBatchDelete = async () => {
  batchDeleting.value = true

  try {
    const result = await useApiFetch('/api/v1/files/oss/batch-delete', {
      method: 'POST',
      body: {
        fileIds: Array.from(selectedFileIds.value),
      },
    })

    if (result) {
      toast.success(`成功删除 ${selectedFileIds.value.size} 个文件`)
      clearSelection()
      handleRefresh()
      refreshStorageQuota()
    }
  } catch (err) {
    console.error('批量删除失败:', err)
    toast.error('批量删除失败，请重试')
  } finally {
    batchDeleting.value = false
  }
}
```

- [ ] **Step 4: 监听分页变化清空选择**

```typescript
// 在现有 watch 后添加
watch(
  () => currentPage.value,
  () => {
    clearSelection()
  }
)

// 监听筛选/排序变化清空选择
watch(
  () => [searchForm.fileType, searchForm.source, sortBy.value],
  () => {
    clearSelection()
  }
)
```

- [ ] **Step 5: 验证组件语法**

Run: `bun run typecheck`
Expected: 无 TypeScript 错误

---

### Task 6: 在 disk-space.vue 中使用 BatchToolbar 和修改列表组件

**Files:**
- Modify: `app/pages/dashboard/disk-space.vue`

- [ ] **Step 1: 注册组件**

```vue
<!-- 在 template 中添加 BatchToolbar -->
<BatchToolbar
  :selected-count="selectedCount"
  :total-count="fileList.length"
  :is-all-selected="isCurrentPageAllSelected"
  :visible="hasSelected"
  :deleting="batchDeleting"
  @select-all="selectAllOnCurrentPage"
  @clear-selection="clearSelection"
  @batch-delete="batchDelete"
/>
```

- [ ] **Step 2: 修改文件列表组件调用**

```vue
<!-- PC 端网格视图 -->
<DiskSpaceFileListGrid
  v-if="viewMode === 'grid'"
  :files="fileList"
  :selected-file-ids="selectedFileIds"
  @click="openFileDetail"
  @toggle-select="toggleSelect"
/>

<!-- PC 端列表视图 -->
<DiskSpaceFileListTable
  v-else
  :files="fileList"
  :selected-file-ids="selectedFileIds"
  @click="openFileDetail"
  @toggle-select="toggleSelect"
/>

<!-- 移动端视图 -->
<DiskSpaceFileListMobile
  :files="mobileFileList"
  :selected-file-ids="selectedFileIds"
  :loading="mobileLoading"
  :refreshing="mobileRefreshing"
  :has-more="mobileHasMore"
  @click="openFileDetail"
  @toggle-select="toggleSelect"
  @load-more="loadMoreMobile"
  @refresh="refreshMobile"
/>
```

- [ ] **Step 3: 验证组件语法**

Run: `bun run typecheck`
Expected: 无 TypeScript 错误

---

## Chunk 4: 服务端批量删除 API

### Task 7: 创建批量删除 API 接口

**Files:**
- Create: `server/api/v1/files/oss/batch-delete.post.ts`

- [ ] **Step 1: 创建 API 文件**

```typescript
/**
 * 批量删除 OSS 文件
 *
 * 软删除用户的文件记录
 */

import { z } from 'zod'
import { deleteFileDao, findOssFileByIdDao } from '@/server/services/files/ossFiles.dao'

export default defineEventHandler(async (event) => {
  try {
    const user = event.context.auth.user

    // 验证请求体
    const body = await readBody(event)
    const schema = z.object({
      fileIds: z.array(z.number()).min(1, '至少需要指定一个文件 ID'),
    })
    const { fileIds } = schema.parse(body)

    // 批量查找文件
    const files = await Promise.all(fileIds.map(id => findOssFileByIdDao(id)))

    // 验证所有文件都存在且属于当前用户
    for (const file of files) {
      if (!file) {
        return resError(event, 404, '文件不存在')
      }
      if (file.userId !== user.id) {
        return resError(event, 403, '无权删除此文件')
      }
    }

    // 批量删除
    await Promise.all(fileIds.map(id => deleteFileDao(id)))

    return resSuccess(event, '批量删除成功', {
      deletedCount: fileIds.length,
    })
  } catch (error) {
    return resError(event, 400, parseErrorMessage(error, '批量删除失败'))
  }
})
```

- [ ] **Step 2: 验证 TypeScript**

Run: `bun run typecheck`
Expected: 无 TypeScript 错误

---

## Chunk 5: 测试与验证

### Task 8: 功能测试

**Files:**
- Test: 浏览器手动测试

- [ ] **Step 1: 启动开发服务器**

Run: `bun dev`
Expected: 服务启动成功，访问 http://localhost:3000

- [ ] **Step 2: 测试单选功能**
- 访问 /dashboard/disk-space
- 点击任意文件复选框
- Expected: 文件高亮显示，底部工具栏弹出

- [ ] **Step 3: 测试多选功能**
- 点击多个文件复选框
- Expected: 多个文件高亮，工具栏显示已选数量

- [ ] **Step 4: 测试全选功能**
- 点击工具栏全选复选框
- Expected: 当前页所有文件被选中
- 再次点击
- Expected: 取消所有选中

- [ ] **Step 5: 测试取消选择**
- 选中多个文件后点击"取消选择"
- Expected: 所有文件取消选中，工具栏隐藏

- [ ] **Step 6: 测试批量删除**
- 选中多个文件后点击"批量删除"
- Expected: 显示确认对话框
- 确认删除
- Expected: 显示删除成功提示，列表刷新

- [ ] **Step 7: 测试分页行为**
- 选中文件后切换页码
- Expected: 清空选中状态

- [ ] **Step 8: 测试筛选/排序行为**
- 选中文件后更改筛选或排序
- Expected: 清空选中状态

- [ ] **Step 9: 测试移动端**
- 使用浏览器开发者工具切换到移动视图
- Expected: 复选框正常显示，工具栏位置正确

- [ ] **Step 10: 测试深色模式**
- 切换到深色主题
- Expected: 工具栏和选中样式颜色正确

---

### Task 9: 代码审查

- [ ] **Step 1: 运行 lint 检查**

Run: `bun run lint`
Expected: 无 lint 错误

- [ ] **Step 2: 运行类型检查**

Run: `bun run typecheck`
Expected: 无 TypeScript 错误

- [ ] **Step 3: 检查提交内容**

Run: `git status`
Expected: 显示所有修改的文件

---

## 文件清单

### 新增文件
- `app/components/diskSpace/BatchToolbar.vue`
- `server/api/v1/files/oss/batch-delete.post.ts`

### 修改文件
- `app/components/diskSpace/fileListGrid.vue`
- `app/components/diskSpace/fileListTable.vue`
- `app/components/diskSpace/FileListMobile.vue`
- `app/pages/dashboard/disk-space.vue`

---

## 提交规范

按照以下格式提交：

```bash
# Chunk 1: BatchToolbar 组件
git commit -m "feat(disk-space): 新增批量删除工具栏组件

- 创建 BatchToolbar 组件
- 支持全选、取消选择、批量删除操作
- 底部固定定位，带动画过渡效果"

# Chunk 2: 文件列表组件
git commit -m "feat(disk-space): 文件列表组件添加复选框

- fileListGrid: 网格视图添加左上角复选框
- fileListTable: 列表视图添加选择列
- FileListMobile: 移动端添加复选框
- 统一选中状态样式（border-primary bg-primary/5）"

# Chunk 3: 主页面集成
git commit -m "feat(disk-space): 集成批量删除功能

- disk-space.vue: 添加选中状态管理
- 实现全选、取消选择、批量删除逻辑
- 监听分页/筛选/排序变化清空选择"

# Chunk 4: 服务端 API
git commit -m "feat(disk-space): 新增批量删除 API 接口

- batch-delete.post.ts: 批量删除文件
- 支持一次删除多个文件
- 验证文件所有权"
```

---

## 注意事项

1. **主题适配**: 所有样式使用 Tailwind 主题变量（bg-card、border-border、text-foreground 等）
2. **深色模式**: 使用 `dark:` 前缀确保深色模式正确显示
3. **性能优化**: 使用 Set 存储选中 ID，O(1) 查找性能
4. **用户体验**: 工具栏仅在选择时显示，避免界面冗余
5. **错误处理**: 删除操作需要验证文件所有权
6. **响应式**: 确保移动端和桌面端都能正常使用
