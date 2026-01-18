# 实现计划：识别代码规范化重构

## 概述

本实现计划将识别相关代码重构为符合项目规范的结构，包括统一类型定义、消除重复代码、修复 Service/DAO 分层违规。

## 任务

- [x] 1. 创建共享类型定义文件
  - [x] 1.1 创建 `shared/types/recognition.ts` 文件
    - 定义 `DocRecognitionStatus` 枚举和 `DocRecognitionStatusText` 映射
    - 定义 `ImageRecognitionStatus` 枚举和 `ImageRecognitionStatusText` 映射
    - 定义 `ImageType` 枚举
    - 定义 `AsrRecordStatus` 枚举和 `AsrRecordStatusText` 映射
    - 定义 `AsrTaskStatus` 枚举和 `AsrTaskStatusText` 映射
    - 定义 `MineruTaskStatus` 枚举和 `MineruTaskStatusText` 映射
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 1.2 编写类型定义的属性测试
    - **Property 1: 枚举值正确性**
    - **验证: 需求 1.2, 1.3, 1.4, 1.7, 1.8**

  - [x] 1.3 编写文本映射完整性的属性测试
    - **Property 2: 文本映射完整性**
    - **验证: 需求 1.6, 5.4**

- [x] 2. 检查点 - 确保类型定义正确
  - 运行类型检查和测试，确保新创建的类型文件无错误
  - 如有问题请询问用户

- [x] 3. 创建 OSS 文件 DAO 函数
  - [x] 3.1 创建 `server/services/storage/ossFile.dao.ts` 文件
    - 实现 `findOssFileByIdDao` 函数
    - 实现 `findOssFileByIdIncludeDeletedDao` 函数（如需要）
    - _需求: 4.4, 4.5_

- [x] 4. 重构服务端 DAO 文件
  - [x] 4.1 重构 `ocr.dao.ts`
    - 从 `#shared/types/recognition` 导入 `ImageRecognitionStatus`、`ImageType`
    - 删除本地枚举定义
    - 重新导出类型以保持向后兼容
    - _需求: 2.2_

  - [x] 4.2 重构 `asr.dao.ts`
    - 从 `#shared/types/recognition` 导入 `AsrRecordStatus`、`AsrRecordStatusText`
    - 删除本地枚举定义
    - 重新导出类型以保持向后兼容
    - _需求: 2.3_

  - [x] 4.3 重构 `mineru.dao.ts`
    - 从 `#shared/types/recognition` 导入 `DocRecognitionStatus`
    - 删除从 `mineru.service.ts` 的导入
    - _需求: 2.7_

- [x] 5. 重构服务端 Service 文件
  - [x] 5.1 重构 `mineru.service.ts`
    - 从 `#shared/types/recognition` 导入 `DocRecognitionStatus`
    - 删除本地枚举定义
    - 重新导出类型以保持向后兼容
    - 将 `prisma.ossFiles.findFirst` 调用替换为 DAO 函数调用
    - 将 `prisma.ossFiles.findUnique` 调用替换为 DAO 函数调用
    - _需求: 2.4, 4.1, 4.2, 4.3_

  - [x] 5.2 重构 `mineruTask.service.ts`
    - 从 `#shared/types/recognition` 导入 `MineruTaskStatus`、`MineruTaskStatusText`
    - 删除本地枚举定义
    - 重新导出类型以保持向后兼容
    - _需求: 2.5_

  - [x] 5.3 重构 `asrTask.service.ts`
    - 从 `#shared/types/recognition` 导入 `AsrTaskStatus`、`AsrTaskStatusText`
    - 删除本地枚举定义
    - 重新导出类型以保持向后兼容
    - _需求: 2.6_

- [x] 6. 检查点 - 确保服务端重构正确
  - 运行类型检查，确保所有服务端文件无编译错误
  - 如有问题请询问用户

- [x] 7. 重构前端 Composable 文件
  - [x] 7.1 重构 `useAudioRecognition.ts`
    - 从 `#shared/types/recognition` 导入 `AsrRecordStatus`、`AsrRecordStatusText`
    - 删除本地重复的 `AsrRecordStatus` 枚举定义
    - 删除本地重复的 `AsrRecordStatusText` 映射定义
    - 更新 composable 返回值中的类型导出
    - _需求: 3.1, 3.2, 3.3_

- [x] 8. 最终检查点 - 确保所有测试通过
  - 运行 `bun run typecheck` 确保无类型错误
  - 运行现有测试套件确保无回归
  - 如有问题请询问用户
  - _需求: 5.1, 5.2, 5.3_

## 备注

- 每个任务都引用了具体的需求以便追溯
- 检查点任务用于确保增量验证
- 属性测试验证通用的正确性属性
