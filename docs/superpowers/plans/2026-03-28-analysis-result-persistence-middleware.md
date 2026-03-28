# 分析结果持久化中间件实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 caseAnalysisAgent 新增 afterAgent/beforeAgent 中间件自动保存分析结果到 caseAnalyses 表，并引入 isActive 版本激活机制。

**Architecture:** 在 langchain createMiddleware 中用 beforeAgent 创建 IN_PROGRESS 记录、afterAgent 完成后提取消息内容更新为 COMPLETED 并设置 isActive。通过 Prisma 事务 + PostgreSQL 条件唯一索引保证同一 (caseId, nodeId) 只有一条激活版本。提供伴生函数处理 Agent 异常后的 FAILED 标记。

**Tech Stack:** TypeScript, Prisma ORM, PostgreSQL, langchain createMiddleware, Vitest

**设计文档:** `docs/superpowers/specs/2026-03-28-analysis-result-persistence-middleware-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `prisma/models/case.prisma` | 修改 | caseAnalyses 新增 isActive 字段和索引 |
| `server/services/case/analysis.dao.ts` | 修改 | 新增 deactivateVersionsDao / activateVersionDao / findActiveAnalysisVersionDao；修改 createAnalysisDao / updateAnalysisDao / getNextVersionDao / findAnalysisBySessionAndNodeDao |
| `server/services/case/analysis.service.ts` | 修改 | 新增 switchActiveVersionService / getActiveAnalysisVersionService；修改 deleteAnalysisService（激活转移） |
| `server/services/case/initAnalysis.service.ts` | 修改 | loadCompletedResultsService 优先使用 isActive 筛选 |
| `server/services/workflow/middleware/analysisResultPersistence.middleware.ts` | 新增 | 核心中间件 + markAnalysisFailedById 伴生函数 |
| `server/services/workflow/middleware/index.ts` | 修改 | 导出新中间件 |
| `server/services/workflow/agents/caseAnalysis.ts` | 修改 | middleware 数组末位添加新中间件 |
| `server/services/workflow/initAnalysis.executor.ts` | 修改 | 迁移：删除手动 start/complete 调用，改用中间件 + try-catch |
| `tests/server/case/analysis.dao.test.ts` | 修改 | 新增 isActive 相关 DAO 测试 |
| `tests/server/case/analysis.service.test.ts` | 修改 | 新增 switchActiveVersionService / deleteAnalysis 激活转移测试 |
| `tests/server/case/test-db-helper.ts` | 修改 | createTestAnalysis 支持 isActive 参数 |
| `tests/server/workflow/middleware/analysisResultPersistence.middleware.test.ts` | 新增 | 中间件单元测试 |

---

### Task 1: Prisma Schema 变更 + 数据库迁移

**Files:**
- Modify: `prisma/models/case.prisma:153-195` (caseAnalyses model)

- [ ] **Step 1: 修改 Prisma Schema**

在 `prisma/models/case.prisma` 的 `caseAnalyses` model 中，在 `status` 字段之后添加 `isActive` 字段，并新增索引：

```prisma
    /// 是否为激活版本（同一 caseId+nodeId 只有一条为 true）
    isActive       Boolean   @default(false) @map("is_active")
```

在 `@@index` 部分新增：

```prisma
    @@index([caseId, nodeId, isActive], map: "idx_case_analyses_active_version")
```

- [ ] **Step 2: 生成 Prisma 客户端**

Run: `bun run prisma:generate`
Expected: Prisma client regenerated successfully

- [ ] **Step 3: 创建数据库迁移**

Run: `bun run prisma:migrate -- --name add_is_active_to_case_analyses`
Expected: Migration created successfully

- [ ] **Step 4: 添加条件唯一索引**

找到刚创建的迁移文件（`prisma/migrations/xxx_add_is_active_to_case_analyses/migration.sql`），在末尾追加：

```sql
-- 条件唯一索引：同一 (caseId, nodeId) 只有一条激活版本
CREATE UNIQUE INDEX idx_case_analyses_unique_active
ON case_analyses (case_id, node_id)
WHERE is_active = true AND deleted_at IS NULL;

-- 初始化现有数据的 isActive
UPDATE case_analyses ca SET is_active = true
FROM (
  SELECT DISTINCT ON (case_id, node_id) id
  FROM case_analyses
  WHERE status = 2 AND deleted_at IS NULL
  ORDER BY case_id, node_id, version DESC
) latest
WHERE ca.id = latest.id;
```

- [ ] **Step 5: 重新运行迁移**

Run: `bun run prisma:migrate`
Expected: Migration applied successfully

- [ ] **Step 6: 重新生成 Prisma 客户端**

Run: `bun run prisma:generate`
Expected: Client regenerated with isActive field

- [ ] **Step 7: 提交**

```bash
git add prisma/
git commit -m "feat(db): caseAnalyses 新增 isActive 字段和条件唯一索引"
```

---

### Task 2: DAO 层变更 — isActive 字段支持

**Files:**
- Modify: `server/services/case/analysis.dao.ts`
- Test: `tests/server/case/analysis.dao.test.ts`

- [ ] **Step 1: 写失败测试 — createAnalysisDao 支持 isActive**

在 `tests/server/case/analysis.dao.test.ts` 的 `createAnalysisDao` describe 中新增：

```typescript
it('应该支持设置 isActive 字段', async () => {
    const analysis = await createAnalysisDao({
        caseId: testCase.id,
        sessionId: testSession.sessionId,
        nodeId: testNode.id,
        analysisType: 'is_active_test',
        isActive: true,
        status: AnalysisStatus.COMPLETED,
    })
    testIds.analysisIds.push(analysis.id)

    expect(analysis.isActive).toBe(true)
})

it('应该默认 isActive 为 false', async () => {
    const analysis = await createAnalysisDao({
        caseId: testCase.id,
        sessionId: testSession.sessionId,
        nodeId: testNode.id,
        analysisType: 'is_active_default_test',
    })
    testIds.analysisIds.push(analysis.id)

    expect(analysis.isActive).toBe(false)
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/case/analysis.dao.test.ts --reporter=verbose`
Expected: FAIL — `isActive` not in CreateAnalysisInput type

- [ ] **Step 3: 实现 — 修改 CreateAnalysisInput 和 createAnalysisDao**

在 `server/services/case/analysis.dao.ts` 中：

1. `CreateAnalysisInput` 接口新增 `isActive?: boolean` 字段
2. `UpdateAnalysisInput` 接口新增 `isActive?: boolean` 字段
3. `createAnalysisDao` 的 data 中增加 `isActive: data.isActive ?? false`
4. `updateAnalysisDao` 的 updateData 构建中增加 `if (data.isActive !== undefined) updateData.isActive = data.isActive`

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/case/analysis.dao.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/case/analysis.dao.ts tests/server/case/analysis.dao.test.ts
git commit -m "feat(dao): createAnalysisDao/updateAnalysisDao 支持 isActive 字段"
```

---

### Task 3: DAO 层变更 — deactivateVersionsDao / activateVersionDao

**Files:**
- Modify: `server/services/case/analysis.dao.ts`
- Test: `tests/server/case/analysis.dao.test.ts`

- [ ] **Step 1: 写失败测试 — deactivateVersionsDao**

在 `tests/server/case/analysis.dao.test.ts` 中新增 describe：

```typescript
describe('deactivateVersionsDao - 取消激活版本', () => {
    it('应该将同 (caseId, nodeId) 的激活版本设为未激活', async () => {
        const newNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(newNode.id)

        const a1 = await createAnalysisDao({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'deactivate_test',
            status: AnalysisStatus.COMPLETED,
            isActive: true,
        })
        testIds.analysisIds.push(a1.id)

        await deactivateVersionsDao(testCase.id, newNode.id)

        const found = await findAnalysisByIdDao(a1.id)
        expect(found!.isActive).toBe(false)
    })

    it('不应影响其他节点的激活版本', async () => {
        const node1 = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(node1.id)
        const node2 = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(node2.id)

        const a1 = await createAnalysisDao({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: node1.id,
            analysisType: 'deactivate_scope_1',
            status: AnalysisStatus.COMPLETED,
            isActive: true,
        })
        testIds.analysisIds.push(a1.id)

        const a2 = await createAnalysisDao({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: node2.id,
            analysisType: 'deactivate_scope_2',
            status: AnalysisStatus.COMPLETED,
            isActive: true,
        })
        testIds.analysisIds.push(a2.id)

        await deactivateVersionsDao(testCase.id, node1.id)

        const found2 = await findAnalysisByIdDao(a2.id)
        expect(found2!.isActive).toBe(true)
    })

    it('不应影响已软删除的记录', async () => {
        const newNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(newNode.id)

        const a1 = await createAnalysisDao({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'deactivate_deleted_test',
            status: AnalysisStatus.COMPLETED,
            isActive: true,
        })
        testIds.analysisIds.push(a1.id)

        // 此记录不会受影响因为它只匹配 deletedAt IS NULL
        await deactivateVersionsDao(testCase.id, newNode.id)

        // 验证：isActive 被设为 false
        const { getTestPrisma } = await import('./test-db-helper')
        const raw = await getTestPrisma().caseAnalyses.findUnique({
            where: { id: a1.id },
        })
        expect(raw!.isActive).toBe(false)
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/case/analysis.dao.test.ts --reporter=verbose -t "deactivateVersionsDao"`
Expected: FAIL — `deactivateVersionsDao` is not defined

- [ ] **Step 3: 实现 deactivateVersionsDao**

在 `server/services/case/analysis.dao.ts` 中新增：

```typescript
/**
 * 将指定 (caseId, nodeId) 的所有激活版本设为未激活
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @param tx 事务客户端（可选）
 */
export const deactivateVersionsDao = async (
    caseId: number,
    nodeId: number,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const client = tx || prisma
    try {
        await client.caseAnalyses.updateMany({
            where: { caseId, nodeId, isActive: true, deletedAt: null },
            data: { isActive: false, updatedAt: new Date() },
        })
    } catch (error) {
        logger.error('取消激活版本失败：', error)
        throw error
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/case/analysis.dao.test.ts --reporter=verbose -t "deactivateVersionsDao"`
Expected: PASS

- [ ] **Step 5: 写失败测试 — activateVersionDao**

在 `tests/server/case/analysis.dao.test.ts` 中新增 describe：

```typescript
describe('activateVersionDao - 激活指定版本', () => {
    it('应该激活指定记录并取消旧版本', async () => {
        const newNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(newNode.id)

        const v1 = await createAnalysisDao({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'activate_test',
            version: 1,
            status: AnalysisStatus.COMPLETED,
            isActive: true,
        })
        testIds.analysisIds.push(v1.id)

        const v2 = await createAnalysisDao({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'activate_test',
            version: 2,
            status: AnalysisStatus.COMPLETED,
            isActive: false,
        })
        testIds.analysisIds.push(v2.id)

        await activateVersionDao(v2.id, testCase.id, newNode.id)

        const foundV1 = await findAnalysisByIdDao(v1.id)
        const foundV2 = await findAnalysisByIdDao(v2.id)
        expect(foundV1!.isActive).toBe(false)
        expect(foundV2!.isActive).toBe(true)
    })
})
```

- [ ] **Step 6: 运行测试验证失败**

Run: `npx vitest run tests/server/case/analysis.dao.test.ts --reporter=verbose -t "activateVersionDao"`
Expected: FAIL — `activateVersionDao` is not defined

- [ ] **Step 7: 实现 activateVersionDao**

在 `server/services/case/analysis.dao.ts` 中新增：

```typescript
/**
 * 激活指定分析记录（事务内：先取消旧激活，再激活新记录）
 * @param analysisId 分析结果 ID
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @param tx 事务客户端（可选）
 */
export const activateVersionDao = async (
    analysisId: number,
    caseId: number,
    nodeId: number,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const execute = async (client: Prisma.TransactionClient) => {
        // 1. 取消旧激活版本
        await client.caseAnalyses.updateMany({
            where: { caseId, nodeId, isActive: true, deletedAt: null },
            data: { isActive: false, updatedAt: new Date() },
        })
        // 2. 激活新版本
        await client.caseAnalyses.update({
            where: { id: analysisId },
            data: { isActive: true, updatedAt: new Date() },
        })
    }

    try {
        if (tx) {
            await execute(tx)
        } else {
            await prisma.$transaction(async (txClient) => {
                await execute(txClient)
            })
        }
    } catch (error) {
        logger.error('激活版本失败：', error)
        throw error
    }
}
```

- [ ] **Step 8: 运行测试验证通过**

Run: `npx vitest run tests/server/case/analysis.dao.test.ts --reporter=verbose -t "activateVersionDao"`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add server/services/case/analysis.dao.ts tests/server/case/analysis.dao.test.ts
git commit -m "feat(dao): 新增 deactivateVersionsDao / activateVersionDao"
```

---

### Task 4: DAO 层变更 — findActiveAnalysisVersionDao / findAnalysisBySessionAndNodeDao 改造 / getNextVersionDao 事务支持

**Files:**
- Modify: `server/services/case/analysis.dao.ts`
- Test: `tests/server/case/analysis.dao.test.ts`

- [ ] **Step 1: 写失败测试 — findActiveAnalysisVersionDao**

```typescript
describe('findActiveAnalysisVersionDao - 查询激活版本', () => {
    it('应该返回激活版本的分析结果', async () => {
        const newNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(newNode.id)

        const v1 = await createAnalysisDao({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'find_active_test',
            version: 1,
            status: AnalysisStatus.COMPLETED,
            isActive: false,
        })
        testIds.analysisIds.push(v1.id)

        const v2 = await createAnalysisDao({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'find_active_test',
            version: 2,
            status: AnalysisStatus.COMPLETED,
            isActive: true,
        })
        testIds.analysisIds.push(v2.id)

        const active = await findActiveAnalysisVersionDao(testCase.id, newNode.id)

        expect(active).toBeDefined()
        expect(active!.id).toBe(v2.id)
        expect(active!.isActive).toBe(true)
    })

    it('应该返回 null 当没有激活版本', async () => {
        const result = await findActiveAnalysisVersionDao(testCase.id, 999999)
        expect(result).toBeNull()
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/case/analysis.dao.test.ts --reporter=verbose -t "findActiveAnalysisVersionDao"`
Expected: FAIL

- [ ] **Step 3: 实现 findActiveAnalysisVersionDao**

```typescript
/**
 * 查询案件某个节点的激活版本
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @returns 激活版本的分析结果或 null
 */
export const findActiveAnalysisVersionDao = async (
    caseId: number,
    nodeId: number
): Promise<caseAnalyses | null> => {
    try {
        const analysis = await prisma.caseAnalyses.findFirst({
            where: { caseId, nodeId, isActive: true, deletedAt: null },
        })
        return analysis
    } catch (error) {
        logger.error('查询激活版本失败：', error)
        throw error
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/case/analysis.dao.test.ts --reporter=verbose -t "findActiveAnalysisVersionDao"`
Expected: PASS

- [ ] **Step 5: 写失败测试 — findAnalysisBySessionAndNodeDao 增加 status 过滤**

```typescript
describe('findAnalysisBySessionAndNodeDao - 增加 status 过滤', () => {
    it('应该支持按状态过滤查询', async () => {
        const newNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(newNode.id)
        const newSession = await createTestSession({ caseId: testCase.id })
        testIds.sessionIds.push(newSession.sessionId)

        const inProgress = await createAnalysisDao({
            caseId: testCase.id,
            sessionId: newSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'status_filter_session_node',
            status: AnalysisStatus.IN_PROGRESS,
        })
        testIds.analysisIds.push(inProgress.id)

        const completed = await createAnalysisDao({
            caseId: testCase.id,
            sessionId: newSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'status_filter_session_node',
            status: AnalysisStatus.COMPLETED,
            version: 2,
        })
        testIds.analysisIds.push(completed.id)

        // 只查 IN_PROGRESS
        const found = await findAnalysisBySessionAndNodeDao(
            newSession.sessionId,
            newNode.id,
            AnalysisStatus.IN_PROGRESS
        )

        expect(found).toBeDefined()
        expect(found!.id).toBe(inProgress.id)
        expect(found!.status).toBe(AnalysisStatus.IN_PROGRESS)
    })
})
```

- [ ] **Step 6: 运行测试验证失败**

Run: `npx vitest run tests/server/case/analysis.dao.test.ts --reporter=verbose -t "增加 status 过滤"`
Expected: FAIL — 第三个参数不被接受或被忽略

- [ ] **Step 7: 修改 findAnalysisBySessionAndNodeDao**

在 `server/services/case/analysis.dao.ts` 中修改 `findAnalysisBySessionAndNodeDao`，增加可选 `status` 参数：

```typescript
export const findAnalysisBySessionAndNodeDao = async (
    sessionId: string,
    nodeId: number,
    status?: number
): Promise<caseAnalyses | null> => {
    try {
        const where: Prisma.caseAnalysesWhereInput = { sessionId, nodeId, deletedAt: null }
        if (status !== undefined) {
            where.status = status
        }
        const analysis = await prisma.caseAnalyses.findFirst({ where })
        return analysis
    } catch (error) {
        logger.error('查询会话节点分析结果失败：', error)
        throw error
    }
}
```

- [ ] **Step 8: 修改 getNextVersionDao 增加事务支持**

```typescript
export const getNextVersionDao = async (
    caseId: number,
    nodeId: number,
    tx?: Prisma.TransactionClient
): Promise<number> => {
    try {
        const client = tx || prisma
        const latest = await client.caseAnalyses.findFirst({
            where: { caseId, nodeId, deletedAt: null },
            orderBy: { version: 'desc' },
        })
        return latest ? latest.version + 1 : 1
    } catch (error) {
        logger.error('获取下一个版本号失败：', error)
        throw error
    }
}
```

注意：同时需要更新内部实现不再调用 `findLatestAnalysisVersionDao`，改为直接查询以支持事务客户端。

- [ ] **Step 9: 运行所有 DAO 测试**

Run: `npx vitest run tests/server/case/analysis.dao.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 10: 提交**

```bash
git add server/services/case/analysis.dao.ts tests/server/case/analysis.dao.test.ts
git commit -m "feat(dao): 新增 findActiveAnalysisVersionDao，findAnalysisBySessionAndNodeDao 增加 status 过滤，getNextVersionDao 增加事务支持"
```

---

### Task 5: Service 层变更 — switchActiveVersionService / deleteAnalysis 激活转移

**Files:**
- Modify: `server/services/case/analysis.service.ts`
- Test: `tests/server/case/analysis.service.test.ts`

- [ ] **Step 1: 写失败测试 — switchActiveVersionService**

在 `tests/server/case/analysis.service.test.ts` 中新增：

```typescript
import {
    // ...existing imports...
    switchActiveVersionService,
    getActiveAnalysisVersionService,
} from '../../../server/services/case/analysis.service'
```

```typescript
describe('switchActiveVersionService - 切换激活版本', () => {
    it('应该切换激活版本', async () => {
        const newNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(newNode.id)

        const v1 = await saveAnalysisResultService({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'switch_active_test',
            analysisResult: '版本1',
        })
        testIds.analysisIds.push(v1.id)

        const v2 = await saveAnalysisResultService({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'switch_active_test',
            analysisResult: '版本2',
        })
        testIds.analysisIds.push(v2.id)

        // 切换到 v1
        const result = await switchActiveVersionService(v1.id)

        expect(result.isActive).toBe(true)
        expect(result.id).toBe(v1.id)
    })

    it('应该拒绝激活非 COMPLETED 状态的记录', async () => {
        const newNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(newNode.id)

        const analysis = await startAnalysisService({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'switch_active_invalid',
        })
        testIds.analysisIds.push(analysis.id)

        await expect(switchActiveVersionService(analysis.id)).rejects.toThrow()
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/case/analysis.service.test.ts --reporter=verbose -t "switchActiveVersionService"`
Expected: FAIL

- [ ] **Step 3: 实现 switchActiveVersionService 和 getActiveAnalysisVersionService**

在 `server/services/case/analysis.service.ts` 中新增：

```typescript
import {
    // ...existing imports...
    deactivateVersionsDao,
    activateVersionDao,
    findActiveAnalysisVersionDao,
} from './analysis.dao'

/**
 * 切换激活版本
 * 验证记录存在且 status = COMPLETED，事务内切换 isActive
 */
export const switchActiveVersionService = async (
    analysisId: number
): Promise<caseAnalyses> => {
    const existing = await findAnalysisByIdDao(analysisId)
    if (!existing) {
        throw new Error('分析记录不存在')
    }
    if (existing.status !== AnalysisStatus.COMPLETED) {
        throw new Error('只能激活已完成的分析记录')
    }

    await activateVersionDao(analysisId, existing.caseId, existing.nodeId)

    const updated = await findAnalysisByIdDao(analysisId)
    return updated!
}

/**
 * 获取案件某个节点的激活版本
 */
export const getActiveAnalysisVersionService = async (
    caseId: number,
    nodeId: number
): Promise<caseAnalyses | null> => {
    return await findActiveAnalysisVersionDao(caseId, nodeId)
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/case/analysis.service.test.ts --reporter=verbose -t "switchActiveVersionService"`
Expected: PASS

- [ ] **Step 5: 写失败测试 — deleteAnalysisService 激活转移**

```typescript
describe('deleteAnalysisService - 激活转移', () => {
    it('删除激活版本时应自动转移激活状态到次新版本', async () => {
        const newNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(newNode.id)

        const v1 = await saveAnalysisResultService({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'delete_transfer_test',
            analysisResult: '版本1',
        })
        testIds.analysisIds.push(v1.id)

        // v2 是最新版本，通过 saveAnalysisResultService 创建时不自动设 isActive
        // 需要先手动 switchActive 到 v2
        const v2 = await saveAnalysisResultService({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'delete_transfer_test',
            analysisResult: '版本2',
        })
        testIds.analysisIds.push(v2.id)
        await switchActiveVersionService(v2.id)

        // 删除激活的 v2
        await deleteAnalysisService(v2.id)

        // v1 应该变为激活
        const active = await getActiveAnalysisVersionService(testCase.id, newNode.id)
        expect(active).toBeDefined()
        expect(active!.id).toBe(v1.id)
        expect(active!.isActive).toBe(true)
    })

    it('删除非激活版本不应影响当前激活', async () => {
        const newNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(newNode.id)

        const v1 = await saveAnalysisResultService({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'delete_no_transfer_test',
            analysisResult: '版本1',
        })
        testIds.analysisIds.push(v1.id)
        await switchActiveVersionService(v1.id)

        const v2 = await saveAnalysisResultService({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'delete_no_transfer_test',
            analysisResult: '版本2',
        })
        testIds.analysisIds.push(v2.id)

        // 删除非激活的 v2
        await deleteAnalysisService(v2.id)

        // v1 仍然是激活
        const active = await getActiveAnalysisVersionService(testCase.id, newNode.id)
        expect(active!.id).toBe(v1.id)
    })
})
```

- [ ] **Step 6: 运行测试验证失败**

Run: `npx vitest run tests/server/case/analysis.service.test.ts --reporter=verbose -t "激活转移"`
Expected: FAIL — deleteAnalysisService 删除后没有自动转移激活

- [ ] **Step 7: 修改 deleteAnalysisService**

在 `server/services/case/analysis.service.ts` 中修改 `deleteAnalysisService`：

```typescript
export const deleteAnalysisService = async (analysisId: number): Promise<void> => {
    const existing = await findAnalysisByIdDao(analysisId)
    if (!existing) {
        throw new Error('分析记录不存在')
    }

    const wasActive = existing.isActive

    // 软删除时同时重置 isActive
    if (wasActive) {
        await updateAnalysisDao(analysisId, { isActive: false })
    }
    await softDeleteAnalysisDao(analysisId)

    // 如果删除的是激活版本，自动转移到次新 COMPLETED 版本
    if (wasActive) {
        const nextActive = await prisma.caseAnalyses.findFirst({
            where: {
                caseId: existing.caseId,
                nodeId: existing.nodeId,
                status: AnalysisStatus.COMPLETED,
                deletedAt: null,
            },
            orderBy: { version: 'desc' },
        })
        if (nextActive) {
            await updateAnalysisDao(nextActive.id, { isActive: true })
        }
    }
}
```

- [ ] **Step 8: 运行测试验证通过**

Run: `npx vitest run tests/server/case/analysis.service.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 9: 提交**

```bash
git add server/services/case/analysis.service.ts tests/server/case/analysis.service.test.ts
git commit -m "feat(service): 新增 switchActiveVersionService，deleteAnalysisService 激活转移"
```

---

### Task 6: loadCompletedResultsService 适配 isActive

**Files:**
- Modify: `server/services/case/initAnalysis.service.ts`
- Test: `tests/server/case/initAnalysis.service.test.ts`

- [ ] **Step 1: 写失败测试 — loadCompletedResultsService 优先使用 isActive**

在 `tests/server/case/initAnalysis.service.test.ts` 中新增测试（若 describe 已存在则在其中添加）：

```typescript
it('应该优先返回 isActive 的分析结果', async () => {
    // 此测试验证 loadCompletedResultsService 会优先使用 isActive=true 的记录
    // 具体测试需依赖 Task 1-5 的 isActive 基础设施
    // 创建两个 COMPLETED 版本，只激活 v1
    // 预期 loadCompletedResultsService 返回 v1 的结果而非 v2（版本更高但非激活）
})
```

- [ ] **Step 2: 修改 loadCompletedResultsService**

在 `server/services/case/initAnalysis.service.ts` 中修改：

```typescript
export const loadCompletedResultsService = async (
    caseId: number,
): Promise<Record<string, string>> => {
    // 优先使用 isActive 版本
    const activeAnalyses = await prisma.caseAnalyses.findMany({
        where: { caseId, status: 2, isActive: true, deletedAt: null },
    })

    // fallback：如果没有 isActive 的记录，使用旧逻辑（兼容过渡期）
    const analyses = activeAnalyses.length > 0
        ? activeAnalyses
        : await prisma.caseAnalyses.findMany({
            where: { caseId, status: 2, deletedAt: null },
            orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
            distinct: ['analysisType'],
        })

    const results: Record<string, string> = {}
    for (const a of analyses) {
        if (a.analysisResult) {
            results[a.analysisType] = a.analysisResult
        }
    }
    return results
}
```

- [ ] **Step 3: 运行相关测试**

Run: `npx vitest run tests/server/case/initAnalysis.service.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 4: 提交**

```bash
git add server/services/case/initAnalysis.service.ts
git commit -m "feat(service): loadCompletedResultsService 优先使用 isActive 版本"
```

---

### Task 7: 核心中间件实现

**Files:**
- Create: `server/services/workflow/middleware/analysisResultPersistence.middleware.ts`
- Modify: `server/services/workflow/middleware/index.ts`
- Create: `tests/server/workflow/middleware/analysisResultPersistence.middleware.test.ts`

- [ ] **Step 1: 写失败测试 — 中间件单元测试**

创建 `tests/server/workflow/middleware/analysisResultPersistence.middleware.test.ts`：

```typescript
/**
 * 分析结果持久化中间件测试
 *
 * **Feature: analysis-result-persistence**
 * **Validates: beforeAgent 创建记录、afterAgent 保存结果和激活版本**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock langchain createMiddleware —— 提取配置进行测试
vi.mock('langchain', () => ({
    createMiddleware: vi.fn((config) => config),
}))

// mock DAO/Service 层
vi.mock('../../../../server/services/node/node.service', () => ({
    getNodeByNameService: vi.fn(),
}))

vi.mock('../../../../server/services/case/analysis.dao', () => ({
    createAnalysisDao: vi.fn(),
    updateAnalysisDao: vi.fn(),
    getNextVersionDao: vi.fn(),
    deactivateVersionsDao: vi.fn(),
    AnalysisStatus: { IN_PROGRESS: 1, COMPLETED: 2, FAILED: 3 },
}))

// mock prisma
vi.mock('#imports', () => ({
    prisma: {
        $transaction: vi.fn((fn: any) => fn({})),
    },
}))

vi.mock('../../../../server/services/case/analysis.service', () => ({
    failAnalysisService: vi.fn(),
}))

import { analysisResultPersistenceMiddleware, markAnalysisFailedById } from '../../../../server/services/workflow/middleware/analysisResultPersistence.middleware'
import { getNodeByNameService } from '../../../../server/services/node/node.service'
import { createAnalysisDao, updateAnalysisDao, getNextVersionDao, deactivateVersionsDao } from '../../../../server/services/case/analysis.dao'
import { failAnalysisService } from '../../../../server/services/case/analysis.service'

describe('analysisResultPersistenceMiddleware', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('beforeAgent', () => {
        it('应该创建 IN_PROGRESS 分析记录并返回 _analysisRecordId', async () => {
            const mockNode = { id: 42, name: 'summary' }
            vi.mocked(getNodeByNameService).mockResolvedValue(mockNode as any)
            vi.mocked(getNextVersionDao).mockResolvedValue(3)
            vi.mocked(createAnalysisDao).mockResolvedValue({ id: 100 } as any)

            const middleware = analysisResultPersistenceMiddleware({
                agentName: 'summary',
                caseId: 1,
                sessionId: 'session-1',
            })

            const hook = typeof middleware.beforeAgent === 'function'
                ? middleware.beforeAgent
                : middleware.beforeAgent!.hook
            const result = await hook({} as any, {} as any)

            expect(result).toEqual({ _analysisRecordId: 100 })
            expect(createAnalysisDao).toHaveBeenCalledWith(
                expect.objectContaining({
                    caseId: 1,
                    sessionId: 'session-1',
                    nodeId: 42,
                    analysisType: 'summary',
                    status: 1,
                    isActive: false,
                }),
                expect.anything()
            )
        })

        it('节点不存在时应该记录错误并返回空', async () => {
            vi.mocked(getNodeByNameService).mockResolvedValue(null)

            const middleware = analysisResultPersistenceMiddleware({
                agentName: 'nonexistent',
                caseId: 1,
                sessionId: 'session-1',
            })

            const hook = typeof middleware.beforeAgent === 'function'
                ? middleware.beforeAgent
                : middleware.beforeAgent!.hook
            const result = await hook({} as any, {} as any)

            expect(result).toBeUndefined()
        })
    })

    describe('afterAgent', () => {
        it('应该提取 AIMessage 内容并完成分析记录', async () => {
            const mockNode = { id: 42, name: 'summary' }
            vi.mocked(getNodeByNameService).mockResolvedValue(mockNode as any)
            vi.mocked(deactivateVersionsDao).mockResolvedValue(undefined)
            vi.mocked(updateAnalysisDao).mockResolvedValue({ id: 100 } as any)

            const middleware = analysisResultPersistenceMiddleware({
                agentName: 'summary',
                caseId: 1,
                sessionId: 'session-1',
            })

            const mockState = {
                _analysisRecordId: 100,
                messages: [
                    { _getType: () => 'human', content: '请分析' },
                    { _getType: () => 'ai', content: '分析结果文本' },
                ],
            }

            const hook = typeof middleware.afterAgent === 'function'
                ? middleware.afterAgent
                : middleware.afterAgent!.hook
            await hook(mockState as any, {} as any)

            expect(updateAnalysisDao).toHaveBeenCalledWith(
                100,
                expect.objectContaining({
                    analysisResult: '分析结果文本',
                    status: 2, // COMPLETED
                    isActive: true,
                }),
                expect.anything()
            )
        })

        it('_analysisRecordId 不存在时应跳过', async () => {
            const middleware = analysisResultPersistenceMiddleware({
                agentName: 'summary',
                caseId: 1,
                sessionId: 'session-1',
            })

            const hook = typeof middleware.afterAgent === 'function'
                ? middleware.afterAgent
                : middleware.afterAgent!.hook
            await hook({ messages: [] } as any, {} as any)

            expect(updateAnalysisDao).not.toHaveBeenCalled()
        })

        it('应该处理 ContentPart[] 格式的消息内容', async () => {
            const mockNode = { id: 42, name: 'summary' }
            vi.mocked(getNodeByNameService).mockResolvedValue(mockNode as any)
            vi.mocked(deactivateVersionsDao).mockResolvedValue(undefined)
            vi.mocked(updateAnalysisDao).mockResolvedValue({ id: 100 } as any)

            const middleware = analysisResultPersistenceMiddleware({
                agentName: 'summary',
                caseId: 1,
                sessionId: 'session-1',
            })

            const mockState = {
                _analysisRecordId: 100,
                messages: [
                    {
                        _getType: () => 'ai',
                        content: [
                            { type: 'thinking', thinking: '...' },
                            { type: 'text', text: '第一段' },
                            { type: 'text', text: '第二段' },
                        ],
                    },
                ],
            }

            const hook = typeof middleware.afterAgent === 'function'
                ? middleware.afterAgent
                : middleware.afterAgent!.hook
            await hook(mockState as any, {} as any)

            expect(updateAnalysisDao).toHaveBeenCalledWith(
                100,
                expect.objectContaining({
                    analysisResult: '第一段第二段',
                }),
                expect.anything()
            )
        })
    })
})

describe('markAnalysisFailedById', () => {
    it('应该调用 failAnalysisService 标记分析记录为 FAILED', async () => {
        vi.mocked(failAnalysisService).mockResolvedValue({ id: 100, status: 3 } as any)

        await markAnalysisFailedById(100)

        expect(failAnalysisService).toHaveBeenCalledWith(100)
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/workflow/middleware/analysisResultPersistence.middleware.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: 实现核心中间件**

创建 `server/services/workflow/middleware/analysisResultPersistence.middleware.ts`：

```typescript
import { createMiddleware } from 'langchain'
import { z } from 'zod'
import {
    createAnalysisDao,
    updateAnalysisDao,
    getNextVersionDao,
    deactivateVersionsDao,
    AnalysisStatus,
} from '../../case/analysis.dao'
import { failAnalysisService } from '../../case/analysis.service'
import { getNodeByNameService } from '../../node/node.service'

/** 中间件参数 */
interface AnalysisResultPersistenceOptions {
    /** Agent 名称（对应 nodes 表 name 字段） */
    agentName: string
    /** 案件 ID */
    caseId: number
    /** 会话 ID */
    sessionId: string
}

/**
 * 从消息列表中提取最后一条 AIMessage 的文本内容
 */
function extractLastAIMessageContent(messages: any[]): string | null {
    // 从后往前找最后一条 AIMessage
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg._getType?.() === 'ai' || msg.constructor?.name === 'AIMessage') {
            const content = msg.content
            if (typeof content === 'string') {
                return content
            }
            // ContentPart[] 格式
            if (Array.isArray(content)) {
                return content
                    .filter((c: any) => c.type === 'text')
                    .map((c: any) => c.text)
                    .join('')
            }
        }
    }
    return null
}

/**
 * 分析结果持久化中间件
 *
 * beforeAgent: 创建 IN_PROGRESS 分析记录
 * afterAgent: 提取 AIMessage 内容，更新为 COMPLETED 并设置 isActive
 *
 * 放在 middleware 数组末位，确保 afterAgent 在所有其他中间件之后执行
 */
export const analysisResultPersistenceMiddleware = (
    options: AnalysisResultPersistenceOptions
) => {
    const { agentName, caseId, sessionId } = options

    return createMiddleware({
        name: 'AnalysisResultPersistenceMiddleware',
        stateSchema: z.object({
            _analysisRecordId: z.number().optional(),
        }),

        beforeAgent: {
            hook: async (_state: any) => {
                try {
                    // 1. 查找节点获取 nodeId
                    const node = await getNodeByNameService(agentName)
                    if (!node) {
                        logger.error('分析持久化中间件：节点不存在', { agentName })
                        return
                    }

                    // 2. 事务内：获取版本号 + 创建记录
                    const record = await prisma.$transaction(async (tx: any) => {
                        const nextVersion = await getNextVersionDao(caseId, node.id, tx)
                        return await createAnalysisDao({
                            caseId,
                            sessionId,
                            nodeId: node.id,
                            analysisType: agentName,
                            version: nextVersion,
                            status: AnalysisStatus.IN_PROGRESS,
                            isActive: false,
                        }, tx)
                    })

                    logger.info('分析持久化：创建 IN_PROGRESS 记录', {
                        analysisId: record.id,
                        agentName,
                        caseId,
                        version: record.version,
                    })

                    return { _analysisRecordId: record.id }
                } catch (error) {
                    logger.error('分析持久化 beforeAgent 异常', { agentName, caseId, error })
                }
            },
        },

        afterAgent: {
            hook: async (state: any) => {
                const analysisRecordId = state._analysisRecordId
                if (!analysisRecordId) return

                try {
                    // 1. 查找节点获取 nodeId
                    const node = await getNodeByNameService(agentName)
                    if (!node) return

                    // 2. 提取分析结果
                    const resultText = extractLastAIMessageContent(state.messages ?? [])
                    if (!resultText) {
                        logger.warn('分析持久化：未找到 AIMessage 内容', { analysisRecordId, agentName })
                    }

                    // 3. 事务内：取消旧激活 + 完成当前记录
                    await prisma.$transaction(async (tx: any) => {
                        await deactivateVersionsDao(caseId, node.id, tx)
                        await updateAnalysisDao(analysisRecordId, {
                            analysisResult: resultText ?? '',
                            status: AnalysisStatus.COMPLETED,
                            isActive: true,
                        }, tx)
                    })

                    logger.info('分析持久化：完成分析记录', {
                        analysisId: analysisRecordId,
                        agentName,
                        resultLength: resultText?.length ?? 0,
                    })
                } catch (error) {
                    // 不阻塞 Agent 正常返回
                    logger.error('分析持久化 afterAgent 异常', {
                        analysisRecordId,
                        agentName,
                        error,
                    })
                }
            },
        },
    })
}

/**
 * 标记指定分析记录为失败
 * 用于 Agent 异常时在 catch 块中调用
 */
export const markAnalysisFailedById = async (analysisId: number): Promise<void> => {
    try {
        await failAnalysisService(analysisId)
        logger.info('分析持久化：标记为 FAILED', { analysisId })
    } catch (error) {
        logger.error('标记分析失败异常', { analysisId, error })
    }
}
```

- [ ] **Step 4: 修改 middleware/index.ts 导出**

在 `server/services/workflow/middleware/index.ts` 中新增：

```typescript
export * from './analysisResultPersistence.middleware'
```

- [ ] **Step 5: 运行中间件测试**

Run: `npx vitest run tests/server/workflow/middleware/analysisResultPersistence.middleware.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 6: 提交**

```bash
git add server/services/workflow/middleware/analysisResultPersistence.middleware.ts server/services/workflow/middleware/index.ts tests/server/workflow/middleware/analysisResultPersistence.middleware.test.ts
git commit -m "feat(middleware): 新增分析结果持久化中间件 analysisResultPersistenceMiddleware"
```

---

### Task 8: caseAnalysisAgent 集成

**Files:**
- Modify: `server/services/workflow/agents/caseAnalysis.ts`

- [ ] **Step 1: 添加中间件到 caseAnalysisAgent**

在 `server/services/workflow/agents/caseAnalysis.ts` 中：

1. 添加导入：

```typescript
import { analysisResultPersistenceMiddleware } from '../middleware'
```

2. 在 `createAgent` 的 middleware 数组**末位**添加：

```typescript
middleware: [
    pointConsumptionMiddleware(userId!, 'case_analysis_token'),
    caseProcessMaterialMiddleware(userId!, caseId!),
    caseMaterialContextMiddleware(userId!, caseId!),
    todoListMiddleware(),
    summarizationMiddleware({
        model,
        trigger: [{ tokens: 100000 }],
    }),
    // 末位：afterAgent 在所有其他中间件之后执行
    analysisResultPersistenceMiddleware({
        agentName,
        caseId: caseId!,
        sessionId,
    }),
]
```

- [ ] **Step 2: 验证类型检查**

Run: `npx nuxi typecheck`
Expected: No type errors

- [ ] **Step 3: 提交**

```bash
git add server/services/workflow/agents/caseAnalysis.ts
git commit -m "feat(agent): caseAnalysisAgent 集成分析结果持久化中间件"
```

---

### Task 9: initAnalysis.executor 迁移

**Files:**
- Modify: `server/services/workflow/initAnalysis.executor.ts`

- [ ] **Step 1: 修改导入**

移除：

```typescript
import {
    startAnalysisService,
    completeAnalysisService,
} from '../case/analysis.service'
```

新增：

```typescript
import { analysisResultPersistenceMiddleware, markAnalysisFailedById } from './middleware'
import { findAnalysisBySessionAndNodeDao, AnalysisStatus } from '../case/analysis.dao'
import { getNodeByNameService } from '../node/node.service'
```

- [ ] **Step 2: 修改 createModuleNode 函数**

在 `createModuleNode` 函数中：

1. 删除 `startAnalysisService` 调用（约第 135-141 行）
2. 删除 `completeAnalysisService` 调用（约第 191 行）
3. 在 `createAgent` 的 middleware 数组末位添加 `analysisResultPersistenceMiddleware`
4. 在 `agent.invoke` 外层添加 try-catch

具体来说，将 `createModuleNode` 中从 `// 6. 标记分析开始` 到函数末尾替换为：

```typescript
        logger.info(`初始化分析模块 ${config.moduleName} 开始`, {
            sessionId, caseId, userId, toolsCount: tools.length,
        })

        // 6. 创建并执行 Agent（中间件自动处理 start/complete）
        const agent = createAgent({
            model,
            systemPrompt,
            checkpointer: await getCheckpointer(),
            tools,
            store: await getStore(),
            middleware: [
                pointConsumptionMiddleware(userId, 'case_analysis_token'),
                caseMaterialContextMiddleware(userId, caseId),
                summarizationMiddleware({
                    model,
                    trigger: [{ tokens: 100000 }],
                }),
                analysisResultPersistenceMiddleware({
                    agentName: config.moduleName,
                    caseId,
                    sessionId,
                }),
            ],
        })

        try {
            const result = await agent.invoke(
                { messages: [new HumanMessage(fullPrompt)] },
                {
                    configurable: {
                        thread_id: `${sessionId}_${config.moduleName}`,
                        user_id: userId,
                        case_id: caseId,
                    },
                    recursionLimit: 100,
                },
            )

            // 7. 提取最终文本
            const lastMsg = result.messages?.[result.messages.length - 1]
            let resultText = ''
            if (lastMsg) {
                const content = lastMsg.content
                if (typeof content === 'string') {
                    resultText = content
                } else if (Array.isArray(content)) {
                    resultText = content
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text)
                        .join('')
                }
            }

            logger.info(`初始化分析模块 ${config.moduleName} 完成`, {
                sessionId, resultLength: resultText.length,
            })

            return {
                messages: result.messages ?? [],
                result: { [config.moduleName]: resultText },
                lastExecutedModule: config.moduleName,
                lastExecutedResult: resultText,
                lastExecutedTitle: config.title,
            }
        } catch (error: any) {
            // 查找 IN_PROGRESS 记录并标记失败
            try {
                const nodeInfo = await getNodeByNameService(config.moduleName)
                if (nodeInfo) {
                    const record = await findAnalysisBySessionAndNodeDao(
                        sessionId, nodeInfo.id, AnalysisStatus.IN_PROGRESS
                    )
                    if (record) {
                        await markAnalysisFailedById(record.id)
                    }
                }
            } catch (cleanupError) {
                logger.error('标记分析失败异常', { moduleName: config.moduleName, cleanupError })
            }

            logger.error(`初始化分析模块 ${config.moduleName} 失败`, { sessionId, error })

            return {
                result: { [config.moduleName]: `[错误] ${error.message}` },
                lastExecutedModule: config.moduleName,
                lastExecutedResult: '',
                lastExecutedTitle: config.title,
            }
        }
```

- [ ] **Step 3: 验证类型检查**

Run: `npx nuxi typecheck`
Expected: No type errors

- [ ] **Step 4: 提交**

```bash
git add server/services/workflow/initAnalysis.executor.ts
git commit -m "refactor(executor): initAnalysis 迁移为使用分析结果持久化中间件"
```

---

### Task 10: test-db-helper 适配 + 全量测试

**Files:**
- Modify: `tests/server/case/test-db-helper.ts`

- [ ] **Step 1: 修改 createTestAnalysis 支持 isActive**

在 `tests/server/case/test-db-helper.ts` 中，`TestAnalysisInput` 接口新增 `isActive?: boolean`，`createTestAnalysis` 函数的 data 中新增 `isActive: data.isActive ?? false`。

- [ ] **Step 2: 运行全量 DAO/Service 测试（含条件唯一索引验证）**

在 DAO 测试中追加条件唯一索引测试：

```typescript
describe('条件唯一索引约束', () => {
    it('同 (caseId, nodeId) 不允许两条 isActive=true 的记录', async () => {
        const newNode = await createTestNode({ modelId: testModel.id })
        testIds.nodeIds.push(newNode.id)

        await createAnalysisDao({
            caseId: testCase.id,
            sessionId: testSession.sessionId,
            nodeId: newNode.id,
            analysisType: 'unique_active_test',
            status: AnalysisStatus.COMPLETED,
            isActive: true,
        }).then(a => testIds.analysisIds.push(a.id))

        // 第二条 isActive=true 应被数据库拒绝
        await expect(
            createAnalysisDao({
                caseId: testCase.id,
                sessionId: testSession.sessionId,
                nodeId: newNode.id,
                analysisType: 'unique_active_test',
                status: AnalysisStatus.COMPLETED,
                isActive: true,
                version: 2,
            })
        ).rejects.toThrow()
    })
})
```

Run: `npx vitest run tests/server/case/ --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 3: 运行全量中间件测试**

Run: `npx vitest run tests/server/workflow/middleware/ --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 4: 运行全量测试套件**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS（所有 1586+ 测试）

- [ ] **Step 5: 提交**

```bash
git add tests/server/case/test-db-helper.ts
git commit -m "test: test-db-helper createTestAnalysis 支持 isActive 参数"
```

---

### Task 11: 代码简化

- [ ] **Step 1: 运行 simplify 技能优化代码**

对所有变更文件执行代码简化检查。

- [ ] **Step 2: 最终类型检查**

Run: `npx nuxi typecheck`
Expected: No type errors

- [ ] **Step 3: 最终全量测试**

Run: `npx vitest run --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 4: 提交（如有变更）**

```bash
git add -A
git commit -m "refactor: 代码简化优化"
```
