# 设计文档

## 概述

本设计文档描述了识别代码规范化重构的技术实现方案。重构的核心目标是：

1. 将分散在各服务文件中的识别状态类型定义统一到 `shared/types/recognition.ts`
2. 消除前端 composable 中的重复类型定义
3. 修复 Service 层中的数据库直接操作，遵循 Service/DAO 分层架构
4. 保持向后兼容性，通过重新导出确保现有代码无需大规模修改

## 架构

### 当前架构问题

```
┌─────────────────────────────────────────────────────────────────┐
│                        当前状态（问题）                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │  ocr.dao.ts     │    │  asr.dao.ts     │                    │
│  │  ├─ ImageRecog- │    │  ├─ AsrRecord-  │                    │
│  │  │  nitionStatus│    │  │  Status      │  ← 类型定义在      │
│  │  └─ ImageType   │    │  └─ AsrRecord-  │    DAO 文件中      │
│  └─────────────────┘    │     StatusText  │                    │
│                         └─────────────────┘                    │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │ mineru.service  │    │ mineruTask.     │                    │
│  │  ├─ DocRecog-   │    │  service.ts     │                    │
│  │  │  nitionStatus│    │  ├─ MineruTask- │  ← 类型定义在      │
│  │  └─ prisma.*    │    │  │  Status      │    Service 文件中  │
│  │     调用 ❌     │    │  └─ MineruTask- │                    │
│  └─────────────────┘    │     StatusText  │                    │
│          ↑              └─────────────────┘                    │
│          │                                                      │
│  ┌───────┴─────────┐                                           │
│  │  mineru.dao.ts  │    ← 从 service 导入类型（循环依赖风险）   │
│  │  import from    │                                           │
│  │  mineru.service │                                           │
│  └─────────────────┘                                           │
│                                                                 │
│  ┌─────────────────────────────────────────┐                   │
│  │  useAudioRecognition.ts (前端)          │                   │
│  │  ├─ AsrRecordStatus      ← 重复定义 ❌  │                   │
│  │  └─ AsrRecordStatusText  ← 重复定义 ❌  │                   │
│  └─────────────────────────────────────────┘                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 目标架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        目标状态（重构后）                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           shared/types/recognition.ts                    │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │  // 文档识别状态                                  │    │   │
│  │  │  DocRecognitionStatus, DocRecognitionStatusText  │    │   │
│  │  │                                                   │    │   │
│  │  │  // 图片识别状态                                  │    │   │
│  │  │  ImageRecognitionStatus, ImageRecognitionStatus- │    │   │
│  │  │  Text, ImageType                                  │    │   │
│  │  │                                                   │    │   │
│  │  │  // 音频识别状态                                  │    │   │
│  │  │  AsrRecordStatus, AsrRecordStatusText            │    │   │
│  │  │  AsrTaskStatus, AsrTaskStatusText                │    │   │
│  │  │                                                   │    │   │
│  │  │  // MinerU 任务状态                               │    │   │
│  │  │  MineruTaskStatus, MineruTaskStatusText          │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│              ┌───────────────┼───────────────┐                 │
│              ↓               ↓               ↓                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐      │
│  │  DAO 文件     │  │  Service 文件 │  │  前端文件     │      │
│  │  import from  │  │  import from  │  │  import from  │      │
│  │  #shared/     │  │  #shared/     │  │  #shared/     │      │
│  │  types/       │  │  types/       │  │  types/       │      │
│  │  recognition  │  │  recognition  │  │  recognition  │      │
│  │               │  │               │  │               │      │
│  │  // 重新导出  │  │  // 重新导出  │  │  // 直接使用  │      │
│  │  export {..}  │  │  export {..}  │  │               │      │
│  └───────────────┘  └───────────────┘  └───────────────┘      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Service/DAO 分层修复                                    │   │
│  │                                                          │   │
│  │  mineru.service.ts ──调用──→ ossFile.dao.ts             │   │
│  │  (无 prisma.* 调用)          (findOssFileByIdDao)       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 组件和接口

### 1. 共享类型文件 (`shared/types/recognition.ts`)

新建统一的识别类型定义文件，包含所有识别相关的枚举和类型映射。

```typescript
/**
 * 识别相关类型定义
 * 
 * 包含文档识别、图片识别、音频识别的状态枚举和类型定义
 */

// ==================== 文档识别 ====================

/** 文档识别状态枚举 */
export enum DocRecognitionStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 成功 */
    SUCCESS = 2,
    /** 失败 */
    FAILED = 3,
}

/** 文档识别状态文本映射 */
export const DocRecognitionStatusText: Record<DocRecognitionStatus, string> = {
    [DocRecognitionStatus.PENDING]: '待处理',
    [DocRecognitionStatus.PROCESSING]: '处理中',
    [DocRecognitionStatus.SUCCESS]: '成功',
    [DocRecognitionStatus.FAILED]: '失败',
}

// ==================== 图片识别 ====================

/** 图片识别状态枚举 */
export enum ImageRecognitionStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 已完成 */
    COMPLETED = 2,
    /** 失败 */
    FAILED = 3,
}

/** 图片识别状态文本映射 */
export const ImageRecognitionStatusText: Record<ImageRecognitionStatus, string> = {
    [ImageRecognitionStatus.PENDING]: '待处理',
    [ImageRecognitionStatus.PROCESSING]: '处理中',
    [ImageRecognitionStatus.COMPLETED]: '已完成',
    [ImageRecognitionStatus.FAILED]: '失败',
}

/** 图片类型枚举 */
export enum ImageType {
    /** 文档 */
    DOC = 'doc',
    /** 照片 */
    PHOTO = 'photo',
}

// ==================== 音频识别 ====================

/** ASR 识别记录状态枚举 */
export enum AsrRecordStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 成功 */
    SUCCESS = 2,
    /** 失败 */
    FAILED = 3,
}

/** ASR 识别记录状态文本映射 */
export const AsrRecordStatusText: Record<AsrRecordStatus, string> = {
    [AsrRecordStatus.PENDING]: '待处理',
    [AsrRecordStatus.PROCESSING]: '处理中',
    [AsrRecordStatus.SUCCESS]: '成功',
    [AsrRecordStatus.FAILED]: '失败',
}

/** ASR 任务状态枚举 */
export enum AsrTaskStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 成功 */
    SUCCESS = 2,
    /** 失败 */
    FAILED = 3,
}

/** ASR 任务状态文本映射 */
export const AsrTaskStatusText: Record<AsrTaskStatus, string> = {
    [AsrTaskStatus.PENDING]: '待处理',
    [AsrTaskStatus.PROCESSING]: '处理中',
    [AsrTaskStatus.SUCCESS]: '成功',
    [AsrTaskStatus.FAILED]: '失败',
}

// ==================== MinerU 任务 ====================

/** MinerU 任务状态枚举 */
export enum MineruTaskStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 成功 */
    SUCCESS = 2,
    /** 失败 */
    FAILED = 3,
}

/** MinerU 任务状态文本映射 */
export const MineruTaskStatusText: Record<MineruTaskStatus, string> = {
    [MineruTaskStatus.PENDING]: '待处理',
    [MineruTaskStatus.PROCESSING]: '处理中',
    [MineruTaskStatus.SUCCESS]: '成功',
    [MineruTaskStatus.FAILED]: '失败',
}
```

### 2. OSS 文件 DAO 函数

在 `server/services/storage/` 目录下创建或扩展 DAO 文件，提供 OSS 文件查询函数。

```typescript
// server/services/storage/ossFile.dao.ts

import type { ossFiles, Prisma } from '~~/generated/prisma/client'

/**
 * 通过 ID 查询 OSS 文件
 */
export const findOssFileByIdDao = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<ossFiles | null> => {
    try {
        const file = await (tx || prisma).ossFiles.findFirst({
            where: { id, deletedAt: null },
        })
        return file
    } catch (error) {
        logger.error('通过 ID 查询 OSS 文件失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询 OSS 文件（包含已删除）
 */
export const findOssFileByIdIncludeDeletedDao = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<ossFiles | null> => {
    try {
        const file = await (tx || prisma).ossFiles.findUnique({
            where: { id },
        })
        return file
    } catch (error) {
        logger.error('通过 ID 查询 OSS 文件失败：', error)
        throw error
    }
}
```

### 3. 服务文件重构模式

各服务文件的重构遵循统一模式：

```typescript
// 重构前（以 mineru.service.ts 为例）
export enum DocRecognitionStatus {
    PENDING = 0,
    // ...
}

// 重构后
import {
    DocRecognitionStatus,
    DocRecognitionStatusText,
} from '#shared/types/recognition'

// 重新导出以保持向后兼容
export { DocRecognitionStatus, DocRecognitionStatusText }
```

## 数据模型

本次重构不涉及数据库模型变更，仅涉及类型定义的位置调整。

### 类型定义映射关系

| 原位置 | 类型名称 | 新位置 |
|--------|----------|--------|
| `ocr.dao.ts` | `ImageRecognitionStatus` | `shared/types/recognition.ts` |
| `ocr.dao.ts` | `ImageType` | `shared/types/recognition.ts` |
| `asr.dao.ts` | `AsrRecordStatus` | `shared/types/recognition.ts` |
| `asr.dao.ts` | `AsrRecordStatusText` | `shared/types/recognition.ts` |
| `mineru.service.ts` | `DocRecognitionStatus` | `shared/types/recognition.ts` |
| `mineruTask.service.ts` | `MineruTaskStatus` | `shared/types/recognition.ts` |
| `mineruTask.service.ts` | `MineruTaskStatusText` | `shared/types/recognition.ts` |
| `asrTask.service.ts` | `AsrTaskStatus` | `shared/types/recognition.ts` |
| `asrTask.service.ts` | `AsrTaskStatusText` | `shared/types/recognition.ts` |
| `useAudioRecognition.ts` | `AsrRecordStatus` | 删除（从共享类型导入） |
| `useAudioRecognition.ts` | `AsrRecordStatusText` | 删除（从共享类型导入） |

## 正确性属性

*正确性属性是指在系统所有有效执行中都应保持为真的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

基于验收标准测试预分析，以下是本次重构需要验证的正确性属性：

### Property 1: 枚举值正确性

*对于任意* 识别状态枚举（DocRecognitionStatus、ImageRecognitionStatus、AsrRecordStatus、AsrTaskStatus、MineruTaskStatus），其枚举值应与预期的数值映射一致：PENDING=0、PROCESSING=1、SUCCESS/COMPLETED=2、FAILED=3。

**验证: 需求 1.2, 1.3, 1.4, 1.7, 1.8**

### Property 2: 文本映射完整性

*对于任意* 识别状态枚举，其对应的文本映射对象应包含该枚举的所有成员，且每个成员都有非空的中文文本描述。

**验证: 需求 1.6, 5.4**

### Property 3: ImageType 枚举值正确性

*对于* ImageType 枚举，其值应为字符串类型：DOC='doc'、PHOTO='photo'。

**验证: 需求 1.5**

## 错误处理

本次重构主要涉及类型定义的位置调整，错误处理策略如下：

1. **导入错误**：如果导入路径错误，TypeScript 编译器会报错，需在开发阶段修复
2. **类型不匹配**：如果重构后的类型与原有类型不一致，会导致编译错误，需确保类型定义完全一致
3. **循环依赖**：通过将类型定义移至共享目录，消除 DAO 从 Service 导入类型的循环依赖风险

## 测试策略

### 单元测试

由于本次重构主要是代码组织层面的调整，单元测试重点验证：

1. **类型导出验证**：验证 `shared/types/recognition.ts` 正确导出所有类型
2. **枚举值验证**：验证各枚举的值与预期一致
3. **文本映射验证**：验证各状态文本映射的完整性

### 属性测试

使用 Vitest 的属性测试功能验证：

1. **枚举值正确性属性**：验证所有识别状态枚举的数值映射
2. **文本映射完整性属性**：验证每个枚举都有完整的文本映射

### 集成测试

1. **TypeScript 编译检查**：运行 `bun run typecheck` 确保无类型错误
2. **现有测试通过**：运行现有测试套件确保无回归

### 测试配置

- 属性测试最少运行 100 次迭代
- 每个属性测试需标注对应的设计文档属性编号
- 标签格式：**Feature: recognition-code-refactor, Property {number}: {property_text}**
