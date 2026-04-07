# 案件信息提取增强规格说明书

> **状态:** 待实现
> **版本:** 1.1
> **日期:** 2026-04-07

## 1. 背景与问题

### 1.1 现有流程

用户在案件创建页面 `/dashboard/cases/create` 输入案情描述并选择文件后，点击"提取信息"调用 `POST /api/v1/case/extract` 接口。

现有实现中，请求体仅传入 `materials: [{ ossFileId, name }]`，后端将材料信息作为纯文本描述拼入 prompt：

```
用户上传的材料：
- 合同.pdf (ossFileId: 123)
- 聊天记录截图.jpg (ossFileId: 456)
```

**问题：** AI 实际看到的是空洞的文件名和 ID，而非文件的真实内容，导致无法有效提取案件信息。

### 1.2 例外场景

案件详情页直接上传文件时，不会自动触发识别→嵌入流程，导致提取时材料内容不可用。

### 1.3 目标

让 `extract` 接口能够读取用户上传文件的实际内容（OCR 文本、文档内容、音频转录等），而非仅依赖 `ossFileId` 文本描述。

## 2. 设计决策

### 2.1 核心方案

**先创建案件，再提取。**

```
用户点击"提取信息"
  │
  1. 前端 createCase（title="未命名案件", materials, content）
  │      └─ batchAddCaseMaterialsService 添加材料
  │      └─ 返回 caseId + sessionId
  │
  2. 前端 extractCaseInfo(text, caseId)
  │      └─ POST extract { caseId, message }
  │
  3. 后端 extract API：
         ├─ 验证 caseId 归属
         ├─ 获取案件材料
         ├─ ensureMaterialsReadyService（识别 + 嵌入，同步等待）
         ├─ getMaterialContextService（构建上下文）
         │      └─ token > 32000 → 自动摘要 + summary 模式
         │         └─ LLM 可通过 search_case_materials 工具按需检索详情
         ├─ buildMaterialContextMessage（生成上下文文本）
         └─ 调用 LLM 提取 → 返回结果
```

### 2.2 extract API 职责边界

**extract API 不承担材料添加职责**，仅读取 `caseId` 已有材料后执行提取。

理由：
- `createCase` 时已通过 `batchAddCaseMaterialsService` 添加材料
- `extract` 专注提取，无需重复管理材料
- 前端调用流程固定为 `createCase（含材料）→ extract（只读）`

### 2.3 caseTypeId 默认值

createCase API 层支持 `caseTypeId` 为空（传 null 或不传）的场景：
- 后端自动取 `case_types` 表中 `status=1`、`priority` 最小的第一条记录
- 若无任何可用记录，返回 HTTP 400 错误
- caseTypeId 在数据库层面保持必填（Int），默认值在 API 层实现

**注意**：ManualForm 等前端表单的 caseTypeId 校验逻辑**不需要改动**——前端本来就会传 caseTypeId，API 层的兜底逻辑仅作为防御性处理。

### 2.4 Token 超限处理

复用 `getMaterialContextService`（内置 `TOKEN_THRESHOLD = 32000`）：
- token ≤ 32000：使用完整材料内容（full 模式）
- token > 32000：自动生成摘要（`material_summarizer` 节点），切换 summary 模式，LLM 通过 `search_case_materials` 工具按需检索详情

## 3. 接口变更

### 3.1 extract.post.ts — 请求参数

**旧：**
```typescript
{
  message: string
  materials?: Array<{ ossFileId: number; name: string }>
}
```

**新：**
```typescript
{
  caseId: number  // 必填
  message: string  // 必填
}
```

### 3.2 extract.post.ts — 响应数据

在原有 `message` 和 `extractedInfo` 基础上，新增 `materialContext` 字段：

```typescript
{
  code: 200
  message: string
  data: {
    message: string
    extractedInfo: ExtractedCaseInfo | null
    materialContext: {
      mode: 'full' | 'summary' | 'empty'  // 材料上下文模式
      totalMaterials: number                 // 材料总数
      failedMaterials: Array<{               // 识别失败的材料
        name: string
        error: string
      }>
    }
  }
}
```

### 3.3 create.post.ts — caseTypeId 默认值

API 层在 `caseTypeId` 为空时自动填充默认值（不在 schema 层面改 optional）：

```typescript
let caseTypeId = result.data.caseTypeId
if (!caseTypeId) {
    const firstType = await getFirstEnabledCaseTypeService()
    if (!firstType) {
        return resError(event, 400, '系统未配置任何案件类型，请联系管理员')
    }
    caseTypeId = firstType.id
}
```

## 4. 前端变更

### 4.1 create.vue — handleAiSubmit

```
原：extractCaseInfo(text, files)
改：
  1. createCase(title="未命名案件", materials, content)
       └─ 返回 caseId
  2. extractCaseInfo(text, caseId)
```

### 4.2 ManualForm

**不需要改动。** caseTypeId 在表单中本来就是必填项，前端会正常传值，无需改为可选。

## 5. 数据库变更

无新增表或字段变更。

## 6. 可复用现有服务

| 服务 | 职责 |
|------|------|
| `getMaterialsByCaseIdService` | 获取案件所有材料 |
| `ensureMaterialsReadyService` | 确保材料识别+嵌入就绪 |
| `getMaterialContextService` | 构建材料上下文（含 token 阈值处理） |
| `buildMaterialContextMessage` | 生成材料上下文文本 |
| `getEnabledCaseTypesService` | 获取可用案件类型列表 |
| `validateCaseAccessService` | 验证用户对案件的访问权限 |

## 7. 已知限制

- **提取失败兜底**：如果 `createCase` 成功但 `extract` 失败，案件已创建。用户可从案件详情页重新发起分析。
- **材料识别失败**：部分材料识别失败不影响其他材料提取，返回结果中通过 `materialContext.failedMaterials` 告知前端。

## 8. 测试策略

1. **单元测试**：`getFirstEnabledCaseTypeService` 边界条件（有无启用记录）
2. **手动测试**：完整流程验证（上传文件→提取→确认页→创建案件）
