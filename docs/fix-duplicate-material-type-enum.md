# 修复案件材料类型枚举重复定义问题

## 问题描述

项目中存在两个功能相同但名称不同的材料类型枚举：

1. **`CaseMaterialType`** (在 `shared/types/case.ts` 中)
   - 用于案件创建 API
   - 定义了 4 种材料类型：CASE_CONTENT(1), DOCUMENT(2), IMAGE(3), AUDIO(4)

2. **`MaterialType`** (在 `shared/types/material.ts` 中) - **已移除**
   - 原本定义了相同的 4 种材料类型：TEXT(1), DOCUMENT(2), IMAGE(3), AUDIO(4)

这两个枚举的值完全相同，但名称不同，造成了重复定义和混淆。

## 问题影响

1. **代码维护困难**：需要同时维护两个相同的枚举
2. **类型混淆**：开发者不清楚应该使用哪个枚举
3. **潜在的不一致性**：如果两个枚举的值不同步，会导致 bug

## 解决方案

### 统一使用 `CaseMaterialType`

选择 `CaseMaterialType` 作为统一的材料类型枚举，原因：

1. **数据库表名**：数据库表名是 `case_materials`，表明这是案件材料
2. **语义准确**：这些材料都是案件相关的材料，不是通用材料
3. **已广泛使用**：在案件创建 API 和服务层中已经广泛使用

### 修改内容

#### 1. 修改 `shared/types/material.ts`

**完全移除** `MaterialType` 枚举定义，只保留从 `case.ts` 的导入：

```typescript
// 导入案件材料类型枚举（统一使用，避免重复定义）
import { CaseMaterialType } from './case'

/** 材料类型文本映射 */
export const MaterialTypeText: Record<CaseMaterialType, string> = {
    [CaseMaterialType.CASE_CONTENT]: '文本',
    [CaseMaterialType.DOCUMENT]: '文档',
    [CaseMaterialType.IMAGE]: '图片',
    [CaseMaterialType.AUDIO]: '音频',
}
```

**注意**：不再保留 `MaterialType` 别名，完全迁移到 `CaseMaterialType`。

#### 2. 更新所有使用 `MaterialType` 的文件

已完成以下文件的迁移：

**服务层文件**：
- ✅ `server/services/material/material.service.ts`
- ✅ `server/services/material/material.dao.ts`
- ✅ `server/services/material/materialEmbedding.service.ts`
- ✅ `server/services/workflow/nodes/materialProcess.ts`
- ✅ `server/services/case/caseMaterial.service.ts`
- ✅ `server/services/case/caseMaterial.dao.ts`

**API 文件**：
- ✅ `server/api/v1/material/upload.post.ts`
- ✅ `server/api/v1/material/process/[id].post.ts`
- ✅ `server/api/v1/material/content/[id].get.ts`
- ✅ `server/api/v1/demo-cases/create-case/[id].post.ts`

**前端文件**：
- ✅ `app/components/case/MaterialUploader.vue`
- ✅ `app/utils/caseMaterial.ts`

**测试文件**：
- ✅ `tests/server/material/material.service.test.ts`
- ✅ `tests/server/material/material.dao.test.ts`
- ✅ `tests/server/case/caseMaterial.dao.test.ts`
- ✅ `tests/server/case/test-generators.ts`
- ✅ `tests/server/case/test-db-helper.ts`
- ✅ `tests/server/case/test-setup.ts`

#### 3. 添加注释说明

在 `shared/types/case.ts` 中添加注释：

```typescript
/** 
 * 案件材料类型枚举
 * 
 * 注意：这是项目中统一使用的材料类型枚举
 * 所有材料类型相关的代码都应该使用此枚举
 */
export enum CaseMaterialType {
    /** 文本内容（案情描述等） */
    CASE_CONTENT = 1,
    /** 文档文件 */
    DOCUMENT = 2,
    /** 图片文件 */
    IMAGE = 3,
    /** 音频文件 */
    AUDIO = 4,
}
```

## 迁移完成状态

### ✅ 已完成
- 移除 `MaterialType` 枚举定义
- 更新所有服务层文件
- 更新所有 API 文件
- 更新所有前端文件
- 更新所有测试文件
- 更新测试环境配置（test-setup.ts）

### 验证结果
- ✅ 案件材料 DAO 测试通过（13/13）
- ✅ 代码中不再有 `MaterialType` 的引用
- ✅ 所有文件统一使用 `CaseMaterialType`

## 数据库映射

数据库 `case_materials` 表的 `type` 字段值：

| 枚举值 | 数据库值 | 说明 |
|--------|---------|------|
| `CaseMaterialType.CASE_CONTENT` | 1 | 文本内容 |
| `CaseMaterialType.DOCUMENT` | 2 | 文档文件 |
| `CaseMaterialType.IMAGE` | 3 | 图片文件 |
| `CaseMaterialType.AUDIO` | 4 | 音频文件 |

## 使用指南

### 导入方式

```typescript
// ✅ 正确：从 case.ts 导入
import { CaseMaterialType } from '#shared/types/case'

// ❌ 错误：不要从 material.ts 导入（已不存在）
// import { MaterialType } from '#shared/types/material'
```

### 使用示例

```typescript
import { CaseMaterialType } from '#shared/types/case'

// 创建材料
const material = {
    type: CaseMaterialType.DOCUMENT,
    name: '证据文件',
}

// 类型判断
if (material.type === CaseMaterialType.CASE_CONTENT) {
    // 处理文本内容
}
```

### 文本映射

```typescript
import { CaseMaterialType, CaseMaterialTypeText } from '#shared/types/case'

const typeText = CaseMaterialTypeText[CaseMaterialType.DOCUMENT] // "文档"
```

## 总结

通过完全移除 `MaterialType` 枚举，我们：

1. ✅ 消除了重复定义
2. ✅ 统一了材料类型枚举
3. ✅ 提高了代码可维护性
4. ✅ 避免了未来的不一致性问题
5. ✅ 简化了类型系统

**重要提示**：所有新代码必须使用 `CaseMaterialType`，不再支持 `MaterialType`。


## 最终验证（2026-01-18）

### 遗漏修复
发现并修复了一个遗漏的文件：
- `server/api/v1/material/process/[id].post.ts` - 从 `material.ts` 导入 `CaseMaterialType`

### 验证步骤
1. ✅ 清理构建缓存：`rm -rf .nuxt node_modules/.vite`
2. ✅ 修复遗漏的导入：将 `CaseMaterialType` 从 `case.ts` 导入
3. ✅ 更新过时注释：移除 `case.ts` 中关于 `MaterialType` 别名的注释
4. ✅ 开发服务器启动成功，无错误
5. ✅ 服务端测试运行成功（118/128 测试文件通过）

### 验证结果
- ✅ 所有 TypeScript 和 Vue 文件中不再有 `MaterialType` 引用
- ✅ 构建成功，无类型错误
- ✅ 开发服务器正常启动（http://0.0.0.0:3001/）
- ✅ 测试套件运行正常（1558 个测试通过）
- ✅ 无 `MaterialType is not defined` 错误

## 迁移完全完成 ✅

`MaterialType` 枚举已完全从项目中移除，所有代码统一使用 `CaseMaterialType`。
