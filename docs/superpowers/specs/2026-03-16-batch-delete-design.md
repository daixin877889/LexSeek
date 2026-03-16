# 云盘空间批量删除功能设计文档

**创建日期**: 2026-03-16
**状态**: 待审核
**作者**: AI Assistant

---

## 1. 需求概述

在云盘空间页面中添加批量删除功能，允许用户同时选择多个文件进行删除操作，提升文件管理效率。

### 1.1 设计原则

- **UI 融合**: 新增元素需适配现有 UI 风格，不引入突兀的视觉元素
- **两端兼顾**: 同时支持桌面端和移动端，交互行为保持一致
- **主题适配**: 所有样式使用主题变量，自动适配深色/浅色模式
- **简洁优先**: 工具栏仅在需要时显示，避免界面冗余

---

## 2. 架构设计

### 2.1 组件结构

```
disk-space.vue (主页面)
├── BatchToolbar.vue (新增 - 底部悬浮工具栏)
├── DiskSpaceFileListGrid.vue (修改 - 添加复选框)
├── DiskSpaceFileListTable.vue (修改 - 添加复选框列)
├── FileListMobile.vue (修改 - 添加复选框)
└── fileDetailDialog.vue (保持不变 - 单文件删除)
```

### 2.2 状态管理

在 `disk-space.vue` 中管理选中状态：

```typescript
// 选中的文件 ID 集合
const selectedFileIds = ref<Set<number>>(new Set())

// 计算属性
const hasSelected = computed(() => selectedFileIds.value.size > 0)
const selectedCount = computed(() => selectedFileIds.value.size)
const isCurrentPageAllSelected = computed(() =>
  selectedFileIds.value.size === fileList.value.length
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
    // 取消全选
    selectedFileIds.value.clear()
  } else {
    // 全选当前页
    fileList.value.forEach(file => selectedFileIds.value.add(file.id))
  }
}

const clearSelection = () => {
  selectedFileIds.value.clear()
}

const batchDelete = async () => {
  // 显示确认对话框
  // 调用批量删除 API
  // 成功后清空选择并刷新列表
}
```

---

## 3. 组件详细设计

### 3.1 BatchToolbar.vue (新增)

**位置**: `app/components/diskSpace/BatchToolbar.vue`

**职责**: 显示在视口底部，提供批量操作入口

**Props**:
```typescript
interface Props {
  selectedCount: number
  totalCount: number
  isAllSelected: boolean
}
```

**Emits**:
```typescript
interface Emits {
  (e: 'selectAll'): void
  (e: 'clearSelection'): void
  (e: 'batchDelete'): void
}
```

**UI 结构**:
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
      <div v-if="isVisible" class="fixed bottom-0 left-0 right-0 z-50">
        <!-- 工具栏内容 -->
        <div class="bg-card border-t border-border shadow-lg">
          <div class="container mx-auto px-4 py-3 flex items-center justify-between">
            <!-- 左侧：选择和计数 -->
            <div class="flex items-center gap-3">
              <Checkbox
                :checked="isAllSelected"
                @update:checked="handleSelectAll"
              />
              <span class="text-sm">已选择 {{ selectedCount }} 个文件</span>
              <Button variant="link" size="sm" @click="$emit('clearSelection')">
                取消选择
              </Button>
            </div>

            <!-- 右侧：删除按钮 -->
            <Button variant="destructive" @click="$emit('batchDelete')">
              <Trash2Icon class="h-4 w-4 mr-1" />
              批量删除
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
```

**样式要点**:
- 使用 `bg-card`、`border-border`、`text-foreground` 等主题变量
- 阴影使用 `shadow-lg`
- 深色模式下自动适配

---

### 3.2 fileListGrid.vue (修改)

**修改内容**: 在每个文件卡片左上角添加复选框

**Props** (新增):
```typescript
interface Props {
  files: OssFileItem[]
  selectedFileIds: Set<number>
}

const emit = defineEmits<{
  (e: 'toggleSelect', fileId: number): void
}>()
```

**模板修改**:
```vue
<div v-for="file in files" :key="file.id"
  :class="[
    'bg-card rounded-lg border p-4 hover:shadow-md transition-all cursor-pointer relative',
    selectedFileIds.has(file.id) ? 'border-primary bg-primary/5' : 'border-border'
  ]"
  @click="$emit('toggleSelect', file.id)"
>
  <!-- 复选框 -->
  <div class="absolute top-3 left-3 z-10" @click.stop>
    <Checkbox
      :checked="selectedFileIds.has(file.id)"
      @update:checked="$emit('toggleSelect', file.id)"
    />
  </div>

  <!-- 原有内容... -->
</div>
```

---

### 3.3 fileListTable.vue (修改)

**修改内容**: 在表格开头添加复选框列

**Props** (新增):
```typescript
interface Props {
  files: OssFileItem[]
  selectedFileIds: Set<number>
}

const emit = defineEmits<{
  (e: 'toggleSelect', fileId: number): void
}>()
```

**模板修改**:
```vue
<!-- 表头 -->
<div class="grid grid-cols-13 gap-4 px-4 py-3 bg-muted border-b">
  <div class="col-span-1 text-center">选择</div>
  <div class="col-span-6">文件名</div>
  <div class="col-span-2">大小</div>
  <div class="col-span-2">来源</div>
  <div class="col-span-2">上传时间</div>
</div>

<!-- 列表内容 -->
<div v-for="file in files" :key="file.id"
  :class="[
    'grid grid-cols-13 gap-4 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer',
    selectedFileIds.has(file.id) ? 'bg-primary/5' : ''
  ]"
  @click="$emit('toggleSelect', file.id)"
>
  <div class="col-span-1 flex justify-center" @click.stop>
    <Checkbox
      :checked="selectedFileIds.has(file.id)"
      @update:checked="$emit('toggleSelect', file.id)"
    />
  </div>
  <!-- 其他列内容，col-span 相应调整 -->
</div>
```

**注意**: 原 `grid-cols-12` 改为 `grid-cols-13`，各列跨度相应调整

---

### 3.4 FileListMobile.vue (修改)

**修改内容**: 在移动端卡片左侧添加复选框

**Props** (新增):
```typescript
interface Props {
  files: OssFileItem[]
  selectedFileIds: Set<number>
  // ... 其他现有 props
}

const emit = defineEmits<{
  (e: 'toggleSelect', fileId: number): void
}>()
```

**模板修改**:
```vue
<div v-for="file in files" :key="file.id"
  :class="[
    'bg-card rounded-lg border p-3 active:bg-muted/50 transition-colors',
    selectedFileIds.has(file.id) ? 'border-primary bg-primary/5' : 'border-border'
  ]"
>
  <div class="flex items-start gap-3">
    <!-- 复选框 -->
    <div class="shrink-0 pt-1" @click.stop>
      <Checkbox
        :checked="selectedFileIds.has(file.id)"
        @update:checked="$emit('toggleSelect', file.id)"
      />
    </div>

    <!-- 原有文件信息内容... -->
  </div>
</div>
```

---

## 4. 交互流程

### 4.1 选择文件

```
用户点击复选框或文件卡片/行
    ↓
触发 toggleSelect(fileId)
    ↓
更新 selectedFileIds Set
    ↓
条件满足时显示 BatchToolbar
    ↓
视觉反馈：卡片高亮 + 复选框选中
```

### 4.2 全选当前页

```
用户点击"全选"复选框
    ↓
判断当前是否已全选
    ↓
是 → 清空选择
否 → 将当前页所有文件 ID 加入 Set
    ↓
BatchToolbar 更新显示
```

### 4.3 批量删除

```
用户点击"批量删除"按钮
    ↓
显示 AlertDialog 确认
    ↓
  ┌─────────────────┐
  │ 确认删除 X 个文件？ │
  │ 此操作不可恢复    │
  │  [取消] [删除]   │
  └─────────────────┘
    ↓
用户确认
    ↓
调用批量删除 API (POST /api/v1/files/oss/batch-delete)
    ↓
成功 → 提示成功 + 清空选择 + 刷新列表
失败 → 提示错误
```

---

## 5. API 接口

### 5.1 批量删除接口

**请求**:
```http
POST /api/v1/files/oss/batch-delete
Content-Type: application/json

{
  "fileIds": [1, 2, 3, ...]
}
```

**响应**:
```json
{
  "code": 200,
  "message": "删除成功",
  "data": {
    "deletedCount": 3,
    "freedSpace": 10485760
  }
}
```

**错误处理**:
- 400: 文件 ID 列表为空或部分 ID 无效
- 403: 无权限删除指定文件
- 500: 服务器错误

---

## 6. 样式规范

### 6.1 主题变量使用

所有颜色使用 Tailwind 主题变量，确保深色模式适配：

| 用途 | 浅色模式 | 深色模式 | CSS 变量 |
|------|----------|----------|----------|
| 卡片背景 | `bg-card` | `bg-card` | `hsl(var(--card))` |
| 边框 | `border-border` | `border-border` | `hsl(var(--border))` |
| 主色边框 | `border-primary` | `border-primary` | `hsl(var(--primary))` |
| 主色背景 | `bg-primary/5` | `bg-primary/10` | `hsl(var(--primary) / 0.05)` |
| 文字 | `text-foreground` | `text-foreground` | `hsl(var(--foreground))` |
| 次要文字 | `text-muted-foreground` | `text-muted-foreground` | 固定色值 |

### 6.2 选中状态样式

```vue
<!-- 网格卡片 -->
:selected-class="border-primary bg-primary/5"

<!-- 列表行 -->
:selected-class="bg-primary/5"

<!-- 移动端卡片 -->
:selected-class="border-primary bg-primary/5"
```

---

## 7. 错误处理

### 7.1 边界情况

| 场景 | 处理方式 |
|------|----------|
| 未选择文件点击删除 | 不显示删除按钮 |
| 删除过程中网络错误 | Toast 提示"删除失败，请重试" |
| 部分文件已被删除 | 提示"X 个文件删除成功，Y 个文件不存在" |
| 删除后列表为空 | 刷新后显示空状态 |

### 7.2 加载状态

- 删除按钮显示 loading 旋转图标
- 禁用其他操作防止重复提交
- 删除完成后刷新文件列表和存储用量

---

## 8. 测试要点

### 8.1 功能测试

- [ ] 单选文件正常高亮
- [ ] 多选文件正常高亮
- [ ] 全选当前页功能正常
- [ ] 取消选择清空所有选中
- [ ] 批量删除确认对话框显示正确
- [ ] 删除成功后列表刷新
- [ ] 删除失败错误提示

### 8.2 UI 测试

- [ ] 工具栏显示/隐藏动画流畅
- [ ] 深色模式下样式正确
- [ ] 移动端布局正常
- [ ] 响应式布局正常

### 8.3 边界测试

- [ ] 空列表状态
- [ ] 单文件删除
- [ ] 全选后删除
- [ ] 删除过程中刷新页面

---

## 9. 文件清单

### 新增文件

- `app/components/diskSpace/BatchToolbar.vue`

### 修改文件

- `app/pages/dashboard/disk-space.vue`
- `app/components/diskSpace/fileListGrid.vue`
- `app/components/diskSpace/fileListTable.vue`
- `app/components/diskSpace/FileListMobile.vue`

---

## 10. 后续优化建议

1. **批量下载**: 在工具栏添加批量下载按钮（压缩打包）
2. **Shift 连选**: 支持 Shift+ 点击实现范围选择
3. **键盘导航**: 支持方向键移动选择焦点
4. **拖拽选择**: 支持鼠标拖拽框选多个文件

---

## 11. 设计决策记录

### 11.1 为什么复选框常显？

- 移动端用户无法"悬停"，常显确保可发现性
- 桌面端用户可直观看到可选项，降低认知负担
- 现代 UI 设计中复选框常显已成为标准模式

### 11.2 为什么工具栏固定在底部？

- 符合移动端操作习惯（底部操作区）
- 桌面端不占用内容区域，页面可正常滚动
- 使用 Teleport 确保 z-index 层级正确

### 11.3 为什么不需要快捷键？

- 批量删除属于低频操作
- 点击交互已足够高效
- 减少代码复杂度和维护成本
