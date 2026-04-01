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

**请求体**：

```typescript
{
  materials: CaseMaterialParam[]
}
```

**处理流程**：

1. 验证用户权限（是否拥有该案件）
2. 调用 `batchAddCaseMaterialsService()` 将材料写入 `case_materials` 表
3. 文件类材料（文档/图片/音频）：调用 `processMaterialService()` 触发识别，识别完成后内部自动触发嵌入
4. 文本类材料：调用 `ensureMaterialsEmbeddedService()` 直接触发嵌入
5. 返回新增的材料列表

**响应**：

```typescript
{ code: 200, message: '操作成功', data: { materials: MaterialItem[] } }
```

## 前端改动

### 材料视图（CaseDetailMaterials.vue）

在顶部标题栏右侧添加「添加材料」按钮（Plus 图标 + 文字），点击打开 `materialSelector` 弹窗。选择完成后调用 API 提交，刷新列表并启动轮询。

### 概览视图（CaseDetailOverview.vue）

在材料列表区域的标题栏右侧添加同样的「添加材料」按钮，行为一致。

### materialSelector 复用

直接复用现有 `materialSelector` 组件，不做修改。用户通过弹窗选择/上传文件，确认后提交到新 API。

### 实时状态轮询

复用 `useFileRecognition` 中已有的轮询模式，在 `useCaseDetail` composable 中独立实现材料维度的轮询：

- 添加材料成功后，将未完成识别的材料加入轮询队列
- 每 2 秒调用 `GET /api/v1/recognition/status/:ossFileId` 获取状态
- 材料卡片实时更新状态徽章：`待识别` → `识别中` → `已完成` / `识别失败`
- 识别完成（成功或失败）后停止轮询，刷新材料详情
- 页面可见性优化：页面隐藏时暂停轮询，可见时恢复
- 概览视图和材料视图共享同一个轮询状态（通过 `useCaseDetail` 统一管理），切换 tab 时状态不丢失

## 数据流

```
用户点击「添加材料」
    ↓
打开 materialSelector 弹窗
    ↓
选择/上传文件 → 确认
    ↓
POST /api/v1/case/materials/:caseId
    ├─ batchAddCaseMaterialsService() → 写入 case_materials
    ├─ 文件类: processMaterialService() → 识别 + 嵌入
    └─ 文本类: ensureMaterialsEmbeddedService() → 嵌入
    ↓
返回新增材料列表（含 ossFileId）
    ↓
前端刷新材料列表 + 启动轮询
    ├─ 每 2s 调用 GET /api/v1/recognition/status/:ossFileId
    ├─ 材料卡片实时更新状态徽章
    └─ 全部完成后停止轮询
```

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `server/api/v1/case/materials/[caseId].post.ts` | 新建 | 添加材料 API |
| `app/components/caseDetail/CaseDetailMaterials.vue` | 修改 | 添加按钮 + materialSelector + 轮询 |
| `app/components/caseDetail/CaseDetailOverview.vue` | 修改 | 添加按钮 + materialSelector + 轮询 |
| `app/composables/useCaseDetail.ts` | 修改 | 新增 refreshMaterials + 轮询状态管理 |

### 不改动的文件

- `materialSelector.vue` — 直接复用
- `useBatchUpload.ts` — materialSelector 内部已使用
- `useFileRecognition.ts` — 复用轮询逻辑模式，在 useCaseDetail 中独立实现
