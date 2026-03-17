# 案件材料文件识别逻辑整合方案

## 背景

为了兼容文件加密，项目中存在复杂的文件识别逻辑：
- 客户端识别：promptInput.vue 中有多个识别入口（docx、image、audio）
- 服务端识别：caseMaterial.ts 中的 `getMaterialType` 工具函数

这导致：
1. 双重识别逻辑，维护困难
2. 加密文件处理复杂
3. 逻辑分散，难以理解

## 目标

统一所有案件分析材料的文件识别逻辑到服务端，具体要求：
- 范围：仅案件分析模块（/dashboard/analysis）
- 时机：选中材料时触发识别
- 处理：全部服务端处理
- 保留：音频识别消耗积分的逻辑（使用现有的预扣/结算/回滚机制）
- 复用：现有的识别服务（OCR、MinerU、ASR）和识别记录表

## 方案概述

采用 **服务端自动识别** 方案：
- 客户端只负责选择文件和上传 OSS
- 选中材料时触发服务端识别
- 服务端根据文件扩展名自动识别类型
- 根据类型调用对应的处理服务（OCR/MinerU/ASR）
- 识别记录存储在现有的专门表中

## 架构设计

### 核心流程

```
客户端                                    服务端
  │                                        │
  ├─ 选择文件                              │
  ├─ 上传到 OSS ─────────────────────> │ 保存文件到 OSS
  │                                        │
  ├─ 选中材料添加到分析框 ───────────>   │
  │                                        ├─ 遍历选中的材料文件
  │                                        │   ├─ 获取 OSS 文件信息
  │                                        │   ├─ 识别文件类型（fileDetect 服务）
  │                                        │   │
  │                                        │   └─ 根据类型调用对应处理服务：
  │                                        │       │
  │                                        │       ├─ 图片：
  │                                        │       │   ├─ 调用 OCR 服务
  │                                        │       │   └─ 识别成功 → 创建 image_recognition_records 记录
  │                                        │       │
  │                                        │       ├─ 文档（md/txt）：
  │                                        │       │   ├─ 读取文件内容
  │                                        │       │   └─ 创建 doc_recognition_records 记录
  │                                        │       │
  │                                        │       ├─ 文档（docx）：
  │                                        │       │   ├─ 调用 mammoth 识别
  │                                        │       │   └─ 创建 doc_recognition_records 记录
  │                                        │       │
  │                                        │       ├─ 文档（doc/pdf）：
  │                                        │       │   ├─ 提交 MinerU 任务
  │                                        │       │   ├─ 创建 mineru_tasks 记录
  │                                        │       │   └─ 异步处理，轮询/回调获取结果
  │                                        │       │
  │                                        │       └─ 音频：
  │                                        │           ├─ 提交 ASR 任务
  │                                        │           ├─ 创建 asr_tasks 记录
  │                                        │           ├─ 预扣积分
  │                                        │           └─ 异步处理，轮询/回调获取结果
  │                                        │
  │                                        <────────────────── 返回识别状态
```

**关键点**：
- **选中材料时触发识别**，不是提交分析时
- 识别记录存储在专门的表中（image_recognition_records、doc_recognition_records、asr_records、mineru_tasks）
- 材料记录和识别记录是分开的
- 复用现有的识别服务和识别记录表

### 识别记录表（现有）

| 类型 | 表名 | 说明 |
|------|------|------|
| 图片 | image_recognition_records | OCR 识别结果 |
| 文档 | doc_recognition_records | 文档解析结果 |
| 文档 | mineru_tasks | MinerU 任务记录 |
| 音频 | asr_tasks | ASR 任务记录 |
| 音频 | asr_records | ASR 识别结果 |

### 积分扣减逻辑（现有）

使用现有的 `pointConsumption.service.ts` 服务：

1. **预扣**：`preDeductPointsService` - 提交 ASR 任务前预扣积分
2. **结算**：`settlePointsService` - 识别成功后结算，根据实际时长调整
3. **回滚**：`rollbackPreDeductService` - 识别失败时回滚积分

具体实现见 `server/services/material/asr.service.ts`。

### 新增/修改文件

| 类型 | 文件路径 | 说明 |
|------|----------|------|
| 新增 | `server/services/material/fileDetect.service.ts` | 统一的文件识别服务 |
| 新增 | `server/api/v1/recognition/start.post.ts` | 统一识别入口 API |
| 修改 | 现有识别服务调用处 | 增加文件类型自动识别逻辑 |
| 修改 | `app/components/caseAnalysis/promptInput.vue` | 移除客户端识别逻辑，改为调用统一 API |
| 修改 | `app/composables/useDocxRecognition.ts` | 清理客户端识别相关代码 |
| 修改 | `app/composables/useImageRecognition.ts` | 清理客户端识别相关代码 |
| 修改 | `app/composables/useAudioRecognition.ts` | 清理客户端识别相关代码 |

## 详细设计

### 1. 文件识别服务

**文件**：`server/services/material/fileDetect.service.ts`

```typescript
/**
 * 文件识别服务
 *
 * 根据文件扩展名自动识别材料类型
 * 支持：图片、音频、PDF、Word、Markdown、TXT
 */

import { CaseMaterialType } from '#shared/types/case'

/**
 * 根据文件名识别材料类型
 *
 * @param fileName 文件名
 * @returns CaseMaterialType 枚举值
 *
 * 识别规则：
 * - 图片文件：jpg/jpeg/png/gif/webp/heic/heif → IMAGE
 * - 音频文件：mp3/wav/m4a/aac/ogg/flac → AUDIO
 * - 其他文件：pdf/doc/docx/md/txt → DOCUMENT
 */
export function detectFileTypeService(fileName: string): CaseMaterialType {
  const ext = getExtensionFromFileName(fileName).toLowerCase()

  // 图片类型
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext)) {
    return CaseMaterialType.IMAGE
  }

  // 音频类型
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) {
    return CaseMaterialType.AUDIO
  }

  // 其他默认为文档类型（PDF、DOC、DOCX、MD、TXT 等）
  return CaseMaterialType.DOCUMENT
}

/**
 * 获取文件扩展名
 */
function getExtensionFromFileName(fileName: string): string {
  const parts = fileName.split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}
```

### 2. 识别处理流程（现有服务复用）

根据文件类型调用现有识别服务：

| 文件类型 | 处理服务 | 识别记录表 |
|----------|----------|------------|
| 图片 | `createImageConversionService` | image_recognition_records |
| 文档(md/txt) | 直接读取内容 | doc_recognition_records |
| 文档(docx) | mammoth 识别 | doc_recognition_records |
| 文档(doc/pdf) | `convertPdfService` | mineru_tasks |
| 音频 | `transcribeAudioService` | asr_tasks / asr_records |

### 3. 新增统一识别入口 API

**文件**：`server/api/v1/recognition/start.post.ts`（新建）

**背景**：
- 现有识别 API 分散在多个文件中（image、doc、mineru、audio）
- 客户端需要分别调用不同 API，逻辑分散

**设计**：
```typescript
// POST /api/v1/recognition/start
// 请求体：{ ossFileIds: number[] }
// 响应：{ results: { ossFileId: number, status: 'processing' | 'completed' | 'failed', recordId?: number }[] }

// 处理流程：
// 1. 遍历 ossFileIds
// 2. 对每个文件调用 detectFileTypeService 识别类型
// 3. 根据类型调用对应识别服务
// 4. 返回识别状态
```

**说明**：
- 复用现有的识别服务（OCR、MinerU、ASR）
- 复用现有的识别记录表
- 音频识别自动使用现有的积分预扣/结算/回滚机制

**文件**：`app/components/caseAnalysis/promptInput.vue`

**核心变化**：
- 之前：选中文件后分别在客户端调用不同识别服务（triggerDocRecognition、triggerImageRecognition、triggerAudioRecognition）
- 现在：选中文件后调用统一的识别 API

**修改要点**：
1. 移除 `triggerDocRecognition`、`triggerImageRecognition`、`triggerAudioRecognition` 调用
2. 改为调用统一的识别 API
3. 根据返回的状态更新 UI 显示

**说明**：
- `caseMaterial.ts` 中的 `getMaterialType` 工具函数可以保留，供其他场景使用
- 新的统一识别 API 可以复用现有的识别服务，不需要新增 API
- 错误处理复用现有识别服务的错误处理机制

**UI 状态映射**：
| 识别状态 | UI 显示 |
|----------|---------|
| 待识别 | idle |
| 识别中 | recognizing |
| 识别成功 | success |
| 识别失败 | error |

### 4. 状态显示

现有的 UI 已有相关逻辑，识别状态通过轮询或 WebSocket 推送更新：
- `idle` - 待识别
- `recognizing` - 识别中
- `success` - 识别成功
- `error` - 识别失败

## 兼容性考虑

- 现有的识别记录表保持不变
- 现有的识别服务保持不变
- 客户端传入的参数可以忽略，服务端自动识别
- 历史数据不受影响

## 测试策略

1. **单元测试**：`fileDetect.service.ts` 的识别逻辑
   - 各种文件扩展名的识别准确性

2. **集成测试**：服务端识别流程
   - 不同类型文件的识别结果验证

3. **E2E 测试**：完整识别流程
   - 音频识别的积分扣减逻辑验证
   - 状态显示正确性验证

## 实施顺序

1. 创建 `fileDetect.service.ts`
2. 新增或修改统一识别 API
3. 修改客户端调用逻辑
4. 清理客户端识别代码
5. 添加测试
6. 验证功能
