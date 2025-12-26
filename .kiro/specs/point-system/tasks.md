# 实现计划：积分系统

## 概述

本实现计划将积分系统设计转化为可执行的编码任务。任务按照依赖关系排序，确保每个任务都建立在前一个任务的基础上。

## 任务列表

- [x] 1. 补充类型定义文件
  - [x] 1.1 补充 shared/types/pointConsumptionItems.types.ts
    - 添加 PointConsumptionItemStatus 枚举（ENABLED = 1, DISABLED = 0）
    - 注：表类型直接使用 Prisma 生成的 pointConsumptionItems 类型
    - _Requirements: 2.2_

  - [x] 1.2 补充 shared/types/pointConsumptionRecords.types.ts
    - 添加 PointConsumptionRecordStatus 枚举（INVALID = 0, PRE_DEDUCT = 1, SETTLED = 2）
    - 注：表类型直接使用 Prisma 生成的 pointConsumptionRecords 类型
    - _Requirements: 3.2_

- [x] 2. 创建数据访问层（DAO）
  - [x] 2.1 创建 server/services/point/pointRecords.dao.ts
    - 实现 createPointRecordDao 函数（使用 Prisma.pointRecordsCreateInput）
    - 实现 findPointRecordByIdDao 函数
    - 实现 findPointRecordsByUserIdDao 函数（分页查询）
    - 实现 findValidPointRecordsByUserIdDao 函数（按 expiredAt 升序，状态为 VALID 且未过期）
    - 实现 updatePointRecordDao 函数
    - 实现 invalidatePointRecordsDao 函数
    - _Requirements: 1.4, 1.5, 7.5_

  - [x] 2.2 创建 server/services/point/pointConsumptionItems.dao.ts
    - 实现 findPointConsumptionItemByIdDao 函数
    - 实现 findEnabledPointConsumptionItemsDao 函数
    - _Requirements: 2.3_

  - [x] 2.3 创建 server/services/point/pointConsumptionRecords.dao.ts
    - 实现 createPointConsumptionRecordDao 函数
    - 实现 findPointConsumptionRecordsByUserIdDao 函数（分页查询，关联 pointConsumptionItems）
    - _Requirements: 3.3_

- [x] 3. 创建服务层
  - [x] 3.1 创建 server/services/point/pointRecords.service.ts
    - 实现 getUserPointSummary 函数（统计有效且未过期的积分）
    - 实现 getUserPointRecords 函数（分页查询）
    - 实现 createPointRecord 函数（设置 remaining = pointAmount, used = 0）
    - _Requirements: 4.1, 4.4, 1.4_

  - [x] 3.2 实现积分消耗逻辑（FIFO策略）
    - 在 pointRecords.service.ts 中实现 consumePoints 函数
    - 验证用户积分余额是否足够
    - 按 expiredAt 升序获取有效积分记录
    - 依次扣除积分直到完全抵扣
    - 使用 Prisma 事务确保原子性
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 7.1, 7.2_

  - [x] 3.3 创建 server/services/point/pointConsumptionRecords.service.ts
    - 实现 getUserConsumptionRecords 函数（分页查询）
    - _Requirements: 4.3_

- [x] 4. Checkpoint - 确保服务层测试通过
  - 确保所有服务层函数正常工作，如有问题请询问用户

- [x] 5. 创建 API 接口
  - [x] 5.1 创建 server/api/v1/points/info.get.ts
    - 使用 Zod 验证请求参数
    - 调用 getUserPointSummary 获取积分汇总
    - 返回标准响应格式 { code, message, data }
    - _Requirements: 4.1_

  - [x] 5.2 创建 server/api/v1/points/records.get.ts
    - 使用 Zod 验证分页参数（page, pageSize, sourceType）
    - 调用 getUserPointRecords 获取积分记录列表
    - 返回分页响应格式
    - _Requirements: 4.2_

  - [x] 5.3 创建 server/api/v1/points/usage.get.ts
    - 使用 Zod 验证分页参数（page, pageSize）
    - 调用 getUserConsumptionRecords 获取消耗记录列表
    - 返回分页响应格式
    - _Requirements: 4.3_

- [x] 6. Checkpoint - 确保 API 接口测试通过
  - 所有 API 接口文件通过诊断检查，无语法或类型错误

- [x] 7. 编写属性测试
  - [x] 7.1 编写 Property 1 测试：积分记录创建不变量
    - 使用 fast-check 生成随机 pointAmount
    - 验证创建后 remaining = pointAmount, used = 0
    - **Property 1: 积分记录创建不变量**
    - **Validates: Requirements 1.4**

  - [x] 7.2 编写 Property 4 测试：FIFO 消耗策略属性
    - 生成多条不同过期时间的积分记录
    - 执行消耗操作后验证消耗顺序
    - **Property 4: FIFO 消耗策略属性**
    - **Validates: Requirements 5.3, 5.4**

  - [x] 7.3 编写 Property 6 测试：积分记录数据一致性属性
    - 验证 remaining = pointAmount - used
    - 验证消耗记录总和等于 used 字段
    - **Property 6: 积分记录数据一致性属性**
    - **Validates: Requirements 7.3, 7.4**

- [x] 8. Final Checkpoint - 确保所有测试通过
  - 所有 10 个属性测试用例通过

## 备注

- 表类型（pointRecords、pointConsumptionItems、pointConsumptionRecords）直接使用 Prisma 生成的类型，已自动导入
- 枚举类型（PointRecordSourceType、PointRecordStatus 等）放在 shared/types 目录下
- 每个任务都引用了具体的需求以便追溯
- Checkpoint 任务用于确保增量验证
