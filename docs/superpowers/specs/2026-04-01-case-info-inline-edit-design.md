# 案件基本信息行内编辑 设计文档

## 目标

在案件详情页的 CaseInfoCard 组件中支持行内编辑标题、原告、被告，保存时同步更新 DB 固定字段、JSONB extractedInfo 和 PostgresStore 长期记忆三层存储。

## 架构

采用行内编辑模式：点击编辑按钮后字段变为可编辑控件，保存/取消后恢复只读。API 端点复用 `saveCaseInfoService` 实现三层原子写入。

## 可编辑字段

| 字段 | 只读展示 | 编辑控件 |
|------|---------|---------|
| 标题 | 文本 | `<Input>` |
| 原告 | 蓝色 Badge 列表 | Badge + ×删除 + 添加按钮 |
| 被告 | 橙色 Badge 列表 | Badge + ×删除 + 添加按钮 |
| 类型 | 文本 | 不可编辑 |
| 概述 | 文本 | 不可编辑 |
| 额外字段 | 文本 | 不可编辑 |

## 后端

### API 端点

**PUT `/api/v1/case/[caseId]`**

请求体：
```typescript
{
  title?: string          // 非空字符串，min(1)
  plaintiff?: string[]    // 去重、去空字符串
  defendant?: string[]    // 去重、去空字符串
}
```

参数校验（zod）：
- `caseId`：路由参数，正整数
- body：至少一个字段有值
- `title`：若提供则 `z.string().min(1).max(500)`
- `plaintiff` / `defendant`：若提供则 `z.array(z.string().trim().min(1))`，自动去重

错误码：
- 400：参数校验失败
- 404：案件不存在
- 403：无权限（案件不属于当前用户）

处理流程：
1. 验证路由参数 `caseId` 和请求体
2. 通过 `findCaseByIdDao(caseId)` 读取案件，校验归属
3. 从案件的 `extractedInfo` 读取当前 `ExtractedCaseInfo`
4. **合并策略**：以 `extractedInfo` 为基准，用请求字段覆盖对应值；若 `extractedInfo` 为 null（历史数据），则从案件固定字段构造 fallback：
   ```typescript
   const base: ExtractedCaseInfo = (caseRecord.extractedInfo as ExtractedCaseInfo) ?? {
     title: caseRecord.title,
     plaintiff: parsePartyNames(caseRecord.plaintiff),
     defendant: parsePartyNames(caseRecord.defendant),
     caseType: caseRecord.caseType?.name ?? '',
     summary: caseRecord.summary ?? '',
     extraFields: [],
   }
   const merged = { ...base, ...validatedFields }
   ```
5. 获取案件类型列表
6. 调用 `saveCaseInfoService(caseId, merged, caseTypes)` 原子更新三层存储
7. 返回 `resSuccess(event, '更新成功')`

### 依赖的现有代码

- `saveCaseInfoService`（`server/services/case/caseExtraction.service.ts`）— 三层写入
- `findCaseByIdDao`（`server/services/case/case.dao.ts`）— 读取案件
- `ExtractedCaseInfo`（`shared/types/case.ts`）— 类型定义

## 前端

### CaseInfoCard 改造

**新增 props：**
- `editable: boolean`（默认 false）— 是否允许编辑

**内部状态：**
- `isEditing: boolean` — 当前是否处于编辑模式
- `editForm: { title: string, plaintiff: string[], defendant: string[] }` — 编辑表单数据（进入编辑时从 caseInfo 深拷贝）
- `isSaving: boolean` — 保存中状态

**交互流程：**
1. `editable=true` 时，标题栏右侧显示 PencilIcon 按钮
2. 点击进入编辑模式：只读文本替换为表单控件
3. 原告/被告编辑：
   - 每个 Badge 右侧显示 × 按钮可删除
   - 末尾显示 `+ 添加` 按钮，点击后出现 Input，回车或失焦确认添加
   - 校验：忽略空字符串和重复项
4. 底部显示「保存」「取消」按钮
5. 保存：
   - 前端校验标题非空
   - 调用 `PUT /api/v1/case/[caseId]`
   - 成功：emit `updated` 事件，退出编辑模式
   - 失败：toast 提示错误，保持编辑状态不丢失输入
6. 取消：恢复原始值，退出编辑模式

**新增 emit：**
- `updated` — 保存成功后触发，父组件调用 `refreshCase()` 刷新数据

### 父组件适配

**CaseDetailOverview：**
- 向 CaseInfoCard 传入 `editable=true`
- 监听 `@updated`，向上 emit 给 `[id].vue` 调用 `refreshCase()`

**初始分析页 `[sessionId].vue`：**
- 保持 `editable=false`（默认值），无需改动

## 错误处理

- 标题不能为空（前端校验 + 后端 zod 校验）
- 原告/被告列表允许为空数组
- API 调用失败时 toast 提示错误，保持编辑状态不丢失用户输入
- 案件不存在返回 404，无权限返回 403

## 限制

- 不支持并发编辑检测（无乐观锁），同一案件多人同时编辑以最后保存为准

## 文件清单

| 文件 | 操作 |
|------|------|
| `server/api/v1/case/[caseId].put.ts` | 新建 |
| `app/components/initAnalysis/CaseInfoCard.vue` | 修改：添加编辑模式 |
| `app/components/caseDetail/CaseDetailOverview.vue` | 修改：传入 editable，监听 updated |
| `app/pages/dashboard/cases/[id].vue` | 微调：处理 updated 事件刷新数据 |
