# 修复 embedding_status 不更新问题

## 问题描述

非 CASE_CONTENT 类型的材料（DOCUMENT、IMAGE、AUDIO）在向量化结束后，`case_materials` 表的 `embedding_status` 字段依然为 `pending`。

## 问题根源

1. **时序问题**：
   - 用户上传文件 → 文件识别 → 向量化完成
   - 用户创建案件 → 创建材料记录
   - **向量化完成时间早于材料创建时间**

2. **更新逻辑失效**：
   - 向量化服务（ocr、mineru、asr）在完成后尝试更新 `case_materials` 表
   - 但此时材料记录还不存在，更新失败
   - 后续创建材料时，`embedding_status` 默认为 `pending`，不会再更新

## 解决方案

在材料创建时，检查对应的 OSS 文件是否已经完成识别和向量化：

1. **检查识别记录**：
   - 文档：查询 `doc_recognition_records` 表
   - 图片：查询 `image_recognition_records` 表
   - 音频：查询 `asr_records` 表

2. **判断向量化状态**：
   - 如果识别状态为成功（status=2）且有 `vector_ids`
   - 则将 `embedding_status` 设置为 `completed`
   - 否则保持默认的 `pending` 状态

## 修改的文件

### 1. `server/services/case/caseMaterial.service.ts`

在 `batchAddCaseMaterialsService` 函数中添加向量化状态检查逻辑：

```typescript
// 检查文件是否已完成识别和向量化
let embeddingStatus: 'pending' | 'processing' | 'completed' | 'failed' = 'pending'

try {
    const client = tx || prisma
    
    if (material.type === CaseMaterialType.DOCUMENT) {
        const docRecord = await client.docRecognitionRecords.findFirst({
            where: { ossFileId: material.ossFileId, status: 2, deletedAt: null },
            select: { vectorIds: true },
        })
        if (docRecord && docRecord.vectorIds && Array.isArray(docRecord.vectorIds) && docRecord.vectorIds.length > 0) {
            embeddingStatus = 'completed'
        }
    }
    // ... 类似的逻辑用于 IMAGE 和 AUDIO
} catch (checkError: any) {
    logger.warn(`检查文件 ${material.ossFileId} 向量化状态失败`, {
        error: checkError.message,
    })
}

materialDataList.push({
    // ...
    embeddingStatus, // 根据识别记录设置向量化状态
})
```

### 2. `server/services/case/caseMaterial.dao.ts`

在 `batchAddCaseMaterialsDAO` 函数中支持 `embeddingStatus` 参数：

```typescript
export const batchAddCaseMaterialsDAO = async (
    caseId: number,
    materials: Array<{
        // ...
        embeddingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
    }>,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    // ...
    const createData = materials.map(material => ({
        // ...
        embeddingStatus: material.embeddingStatus ?? 'pending',
    }))
    // ...
}
```

## 测试验证

可以通过以下步骤验证修复：

1. 上传文件并等待识别和向量化完成
2. 创建案件并添加这些文件作为材料
3. 查询 `case_materials` 表，验证 `embedding_status` 是否为 `completed`

```sql
SELECT id, name, type, oss_file_id, embedding_status 
FROM case_materials 
WHERE type != 1 
ORDER BY id DESC;
```

## 影响范围

- 仅影响材料创建流程
- 不影响现有的向量化服务
- 向后兼容，不会破坏现有功能

## 注意事项

1. 如果文件在材料创建后才完成向量化，`embedding_status` 仍然会是 `pending`
   - 这种情况下，向量化服务中的更新逻辑会生效
   - 但根据当前的时序分析，这种情况很少发生

2. 建议在向量化服务中保留现有的更新逻辑，作为双重保障

## 后续优化建议

1. 添加定时任务，定期检查并修复 `embedding_status` 不一致的记录
2. 在材料详情 API 中，实时查询识别记录状态，而不仅依赖 `embedding_status` 字段
3. 考虑使用数据库触发器或事件监听器来自动更新状态
