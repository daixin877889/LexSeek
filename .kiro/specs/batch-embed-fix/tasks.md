# 实现计划：批量向量化修复

## 概述

修复批量向量化相关的三个问题：元数据字段名不匹配、向量化触发失败、旧嵌入记录未删除。

## 任务

- [x] 1. 修复 batch-embed.post.ts 中的字段名
  - [x] 1.1 修改 SQL 查询中的字段名从 `articleId` 改为 `articles_id`
    - 修改第 116-118 行的 SQL 查询
    - 将 `metadata->>'articleId'` 改为 `metadata->>'articles_id'`
    - _需求: 1.1_

- [x] 2. 修复 batch-save.post.ts 中的向量化触发和旧嵌入删除
  - [x] 2.1 添加删除旧嵌入记录的逻辑
    - 在批量保存前删除该法律下所有条文的嵌入记录
    - 使用 `deleteEmbeddingsByMetadata` 函数按 `legal_id` 删除
    - _需求: 3.1, 3.2, 3.3_
  - [x] 2.2 修改向量化触发方式
    - 改为直接调用 `updateLegalEmbeddings` 服务函数
    - 移除通过 API 调用的方式
    - _需求: 2.1, 2.2, 2.3_

- [x] 3. 检查点 - 确保功能正常
  - 确保所有测试通过，如有问题请询问用户

## 备注

- 任务 1 已完成：修复了元数据字段名不匹配问题
- 任务 2 需要修改 batch-save API 的实现
