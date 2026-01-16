# 需求文档

## 简介

本文档定义了识别代码规范化重构的需求。当前项目中的文档识别、图片识别、音频识别相关代码存在以下不符合 `.kiro/steering` 规范的问题：

1. **类型定义位置错误**：双端共用的枚举和接口定义在了服务文件中，而非 `shared/types/` 目录
2. **重复类型定义**：前端 composable 与后端 DAO 文件中存在相同的类型定义
3. **Service/DAO 分层违规**：Service 层包含直接的数据库操作，违反了分层架构原则

本次重构旨在统一类型定义、消除重复代码、修复分层违规，使代码符合项目规范。

## 术语表

- **Recognition_System**：识别系统，包含文档识别、图片识别、音频识别三个子模块
- **Type_Definition**：类型定义，包括枚举（enum）、接口（interface）、类型别名（type）
- **DAO_Layer**：数据访问层，负责直接与数据库交互的函数
- **Service_Layer**：服务层，负责业务逻辑处理，调用 DAO 层完成数据操作
- **Shared_Types**：共享类型，定义在 `shared/types/` 目录下，供前后端共同使用

## 需求

### 需求 1：统一识别状态类型定义

**用户故事：** 作为开发者，我希望所有识别相关的状态枚举和类型定义集中在 `shared/types/recognition.ts` 文件中，以便前后端统一使用并避免重复定义。

#### 验收标准

1. THE Recognition_System SHALL 在 `shared/types/recognition.ts` 中定义所有识别相关的状态枚举
2. THE Recognition_System SHALL 在 `shared/types/recognition.ts` 中定义 `DocRecognitionStatus` 枚举，包含 PENDING(0)、PROCESSING(1)、SUCCESS(2)、FAILED(3) 四个状态
3. THE Recognition_System SHALL 在 `shared/types/recognition.ts` 中定义 `ImageRecognitionStatus` 枚举，包含 PENDING(0)、PROCESSING(1)、COMPLETED(2)、FAILED(3) 四个状态
4. THE Recognition_System SHALL 在 `shared/types/recognition.ts` 中定义 `AsrRecordStatus` 枚举，包含 PENDING(0)、PROCESSING(1)、SUCCESS(2)、FAILED(3) 四个状态
5. THE Recognition_System SHALL 在 `shared/types/recognition.ts` 中定义 `ImageType` 枚举，包含 DOC('doc')、PHOTO('photo') 两个类型
6. THE Recognition_System SHALL 为每个状态枚举提供对应的文本映射（如 `DocRecognitionStatusText`、`AsrRecordStatusText` 等）
7. THE Recognition_System SHALL 在 `shared/types/recognition.ts` 中定义 `MineruTaskStatus` 枚举，包含 PENDING(0)、PROCESSING(1)、SUCCESS(2)、FAILED(3) 四个状态
8. THE Recognition_System SHALL 在 `shared/types/recognition.ts` 中定义 `AsrTaskStatus` 枚举，包含 PENDING(0)、PROCESSING(1)、SUCCESS(2)、FAILED(3) 四个状态

### 需求 2：服务文件类型导入重构

**用户故事：** 作为开发者，我希望服务文件从 `shared/types/recognition.ts` 导入类型定义，并通过重新导出保持向后兼容性。

#### 验收标准

1. WHEN 服务文件需要使用识别状态类型 THEN Recognition_System SHALL 从 `#shared/types/recognition` 导入
2. THE `ocr.dao.ts` SHALL 从 `#shared/types/recognition` 导入 `ImageRecognitionStatus` 和 `ImageType`，并重新导出以保持向后兼容
3. THE `asr.dao.ts` SHALL 从 `#shared/types/recognition` 导入 `AsrRecordStatus` 和 `AsrRecordStatusText`，并重新导出以保持向后兼容
4. THE `mineru.service.ts` SHALL 从 `#shared/types/recognition` 导入 `DocRecognitionStatus`，并重新导出以保持向后兼容
5. THE `mineruTask.service.ts` SHALL 从 `#shared/types/recognition` 导入 `MineruTaskStatus` 和 `MineruTaskStatusText`，并重新导出以保持向后兼容
6. THE `asrTask.service.ts` SHALL 从 `#shared/types/recognition` 导入 `AsrTaskStatus` 和 `AsrTaskStatusText`，并重新导出以保持向后兼容
7. THE `mineru.dao.ts` SHALL 从 `#shared/types/recognition` 导入 `DocRecognitionStatus`，而非从 `mineru.service.ts` 导入，以消除循环依赖风险

### 需求 3：前端 Composable 类型导入重构

**用户故事：** 作为开发者，我希望前端 composable 从共享类型文件导入类型定义，消除重复的类型定义。

#### 验收标准

1. THE `useAudioRecognition.ts` SHALL 从 `#shared/types/recognition` 导入 `AsrRecordStatus` 和 `AsrRecordStatusText`
2. THE `useAudioRecognition.ts` SHALL 删除本地重复定义的 `AsrRecordStatus` 枚举
3. THE `useAudioRecognition.ts` SHALL 删除本地重复定义的 `AsrRecordStatusText` 映射
4. WHEN 前端代码需要使用识别状态类型 THEN Recognition_System SHALL 从 `#shared/types/recognition` 导入

### 需求 4：Service/DAO 分层修复

**用户故事：** 作为开发者，我希望 Service 层不包含直接的数据库操作，所有数据库操作都通过 DAO 层完成。

#### 验收标准

1. THE `mineru.service.ts` SHALL 不包含任何 `prisma.ossFiles.findFirst` 调用
2. THE `mineru.service.ts` SHALL 不包含任何 `prisma.ossFiles.findUnique` 调用
3. WHEN `mineru.service.ts` 需要查询 OSS 文件信息 THEN Recognition_System SHALL 调用 DAO 层函数
4. THE Recognition_System SHALL 在适当的 DAO 文件中创建 `findOssFileByIdDao` 函数
5. THE Recognition_System SHALL 在适当的 DAO 文件中创建 `findOssFileByPathDao` 函数（如需要）
6. WHEN Service 层需要数据库操作 THEN Recognition_System SHALL 通过 DAO 层函数完成

### 需求 5：代码质量保证

**用户故事：** 作为开发者，我希望重构后的代码通过类型检查和现有测试，确保重构不引入回归问题。

#### 验收标准

1. WHEN 重构完成后 THEN Recognition_System SHALL 通过 TypeScript 类型检查（无编译错误）
2. WHEN 重构完成后 THEN Recognition_System SHALL 保持所有现有功能正常工作
3. THE Recognition_System SHALL 确保所有导入路径正确，无循环依赖
4. THE Recognition_System SHALL 确保重新导出的类型与原有类型完全一致，保持 API 兼容性
