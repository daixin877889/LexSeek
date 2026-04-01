# 案件详情页添加材料功能设计

## 概述

在案件详情页（`/dashboard/cases/[caseId]`）的概览视图和材料视图中增加「添加材料」功能，允许用户向已有案件追加材料，并确保完成识别和嵌入。

## 需求

- 概览视图和材料视图均提供「添加材料」入口
- 复用现有 `materialSelector` 弹窗组件
- 材料添加后关联到当前案件（写入 `case_materials` 表）
- 自动触发识别和嵌入，材料列表实时展示识别状态直到完成
- 不自动触发重新分析，由用户手动决定

## 后端 API

### `POST /api/v1/case/materials/:caseId`

**文件路径**：`server/api/v1/case/materials/[caseId].post.ts`

**请求体**：

```typescript
{
  materials: CaseMaterialParam[]  // 仅支持文件类材料（type=2/3/4），不支持文本（type=1）
}
```

**处理流程**：

1. 验证用户权限（是否拥有该案件）
2. 调用 `batchAddCaseMaterialsService()` 将材料写入 `case_materials` 表
3. 写入后重新查询本次新增的材料记录，获取 `materialId` 列表
4. 对文件类材料（文档/图片/音频），异步调用 `processMaterialService(materialId, userId)` 触发识别，识别完成后内部自动触发嵌入（fire-and-forget，不阻塞响应）
5. 返回新增的材料列表

**获取新增材料的方式**：`batchAddCaseMaterialsService` 返回 `void`，因此在调用前后分别查询材料列表，取差集得到新增的 materialId，或在事务内通过 `ossFileId` 列表查询刚创建的记录。

**响应**：

```typescript
{ code: 200, message: '操作成功', data: { materials: MaterialItem[] } }
```

## 前端改动

### 材料视图（CaseDetailMaterials.vue）

在顶部标题栏右侧添加「添加材料」按钮（Plus 图标 + 文字），点击打开 `materialSelector` 弹窗。选择完成后调用 API 提交，刷新列表并启动轮询。

### 概览视图（CaseDetailOverview.vue）

修改现有「添加材料」按钮的行为：从跳转到材料视图改为打开 `materialSelector` 弹窗。

### materialSelector 复用

直接复用现有 `materialSelector` 组件，不做修改：

- `materialSelector` 通过 `filesSelected` 事件输出 `OssFileItem[]`
- 前端需要将 `OssFileItem` 转换为 `CaseMaterialParam`：使用已有的 `getMaterialType(fileType)` 工具函数完成 MIME → `CaseMaterialType` 映射
- 通过 `disabledFileIds` prop 传入当前案件已有材料的 `ossFileId` 列表，防止重复选择

### 重复材料防护

- **前端**：通过 `materialSelector` 的 `disabledFileIds` prop 禁用已添加的文件
- **后端**：API 层对 `ossFileId` 做去重校验，忽略已存在于当前案件中的文件

### 实时状态轮询

在 `useCaseDetail` composable 中新增轮询逻辑（仅针对文件类材料，文本类不需要识别）：

- 添加材料成功后，将有 `ossFileId` 的文件类材料加入轮询队列
- 每 2 秒调用 `GET /api/v1/recognition/status/:ossFileId` 获取状态
- 材料卡片实时更新状态徽章：`待识别` → `识别中` → `已完成` / `识别失败`
- 识别完成（成功或失败）后停止轮询，刷新材料详情
- 页面可见性优化：页面隐藏时暂停轮询，可见时恢复
- 轮询状态在页面级（`[id].vue`）管理，通过 provide/inject 共享给概览视图和材料视图，切换 tab 时状态不丢失
- 组件卸载时（页面离开）统一清理所有定时器

## 数据流

```
用户点击「添加材料」
    ↓
打开 materialSelector 弹窗（disabledFileIds = 当前案件已有材料的 ossFileId）
    ↓
选择/上传文件 → 确认
    ↓
OssFileItem[] → getMaterialType() → CaseMaterialParam[]
    ↓
POST /api/v1/case/materials/:caseId
    ├─ batchAddCaseMaterialsService() → 写入 case_materials
    ├─ 查询新增的 materialId 列表
    └─ 异步 processMaterialService() → 识别 + 嵌入（fire-and-forget）
    ↓
返回新增材料列表（含 ossFileId、materialId）
    ↓
前端刷新材料列表 + 对文件类材料启动轮询
    ├─ 每 2s 调用 GET /api/v1/recognition/status/:ossFileId
    ├─ 材料卡片实时更新状态徽章
    └─ 全部完成后停止轮询
```

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `server/api/v1/case/materials/[caseId].post.ts` | 新建 | 添加材料 API |
| `app/components/caseDetail/CaseDetailMaterials.vue` | 修改 | 添加按钮 + materialSelector + 轮询 |
| `app/components/caseDetail/CaseDetailOverview.vue` | 修改 | 修改「添加材料」按钮行为为打开弹窗 |
| `app/composables/useCaseDetail.ts` | 修改 | 新增 refreshMaterials + 轮询状态管理 |
| `app/pages/dashboard/cases/[id].vue` | 修改 | provide 轮询状态给子视图 |

### 不改动的文件

- `materialSelector.vue` — 直接复用
- `useBatchUpload.ts` — materialSelector 内部已使用
- `useFileRecognition.ts` — 复用轮询逻辑模式，在 useCaseDetail 中独立实现
