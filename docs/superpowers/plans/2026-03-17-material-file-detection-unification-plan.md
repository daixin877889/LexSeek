# 案件材料文件识别逻辑整合实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一案件分析模块的文件识别逻辑到服务端，选中材料时自动识别类型并处理

**Architecture:** 采用服务端自动识别方案 - 客户端选中材料时调用统一 API，服务端根据文件扩展名识别类型，调用现有识别服务处理

**Tech Stack:** Nuxt 4, TypeScript, Prisma, Vitest

---

## 文件结构

```
server/
├── services/
│   └── material/
│       └── fileDetect.service.ts     # 新增：文件识别服务
└── api/
    └── v1/
        └── recognition/
            └── start.post.ts         # 新增：统一识别入口 API

app/
├── components/
│   └── caseAnalysis/
│       └── promptInput.vue          # 修改：移除客户端识别逻辑
```

---

## Task 1: 创建文件识别服务 fileDetect.service.ts

**Files:**
- Create: `server/services/material/fileDetect.service.ts`
- Test: `tests/server/material/fileDetect.service.test.ts`

- [ ] **Step 1: 创建测试文件**

创建 `tests/server/material/fileDetect.service.test.ts`，编写测试用例:
- 测试 jpg/png 识别为 IMAGE
- 测试 mp3/wav 识别为 AUDIO
- 测试 pdf/docx/md/txt 识别为 DOCUMENT
- 测试大小写忽略

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run tests/server/material/fileDetect.service.test.ts
# 预期: FAIL - detectFileTypeService is not defined
```

- [ ] **Step 3: 创建服务实现**

```typescript
// server/services/material/fileDetect.service.ts
import { CaseMaterialType } from '#shared/types/case'

function getExtensionFromFileName(fileName: string): string {
  const parts = fileName.split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

export function detectFileTypeService(fileName: string): CaseMaterialType {
  const ext = getExtensionFromFileName(fileName).toLowerCase()

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext)) {
    return CaseMaterialType.IMAGE
  }
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) {
    return CaseMaterialType.AUDIO
  }
  return CaseMaterialType.DOCUMENT
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run tests/server/material/fileDetect.service.test.ts
# 预期: PASS
```

- [ ] **Step 5: 提交**

```bash
git add server/services/material/fileDetect.service.ts tests/server/material/fileDetect.service.test.ts
git commit -m "test: 添加文件识别服务及单元测试"
```

---

## Task 2: 创建统一识别入口 API

**Files:**
- Create: `server/api/v1/recognition/start.post.ts`
- Test: `tests/server/material/recognition-api.test.ts`

- [ ] **Step 1: 创建测试文件**

创建测试文件，测试:
- 未登录返回 401
- 空数组返回 400

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run tests/server/material/recognition-api.test.ts
# 预期: FAIL
```

- [ ] **Step 3: 创建 API**

**注意**: 文档类型(md/txt/docx/doc/pdf)的区分处理在 `convertPdfService` 内部完成，该服务会根据文件类型选择合适的处理方式。只需传入 ossFileId，服务内部会根据文件扩展名调用不同的处理逻辑。

```typescript
// server/api/v1/recognition/start.post.ts
import { z } from 'zod'
import { detectFileTypeService } from '~~/server/services/material/fileDetect.service'
import { createImageConversionService } from '~~/server/services/material/ocr.service'
import { convertPdfService } from '~~/server/services/material/mineru.service'
import { transcribeAudioService } from '~~/server/services/material/asr.service'
import { CaseMaterialType } from '#shared/types/case'

const schema = z.object({
  ossFileIds: z.array(z.number()).min(1)
})

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const body = await readBody(event)
  const result = schema.safeParse(body)
  if (!result.success) return resError(event, 400, '参数错误')

  const { ossFileIds } = result.data
  const results = []

  for (const ossFileId of ossFileIds) {
    const ossFile = await prisma.ossFiles.findFirst({
      where: { id: ossFileId, userId: user.id, deletedAt: null }
    })
    if (!ossFile) {
      results.push({ ossFileId, status: 'failed', error: '文件不存在' })
      continue
    }

    const fileType = detectFileTypeService(ossFile.fileName)
    let processResult: { success: boolean; error?: string }

    switch (fileType) {
      case CaseMaterialType.IMAGE:
        processResult = await createImageConversionService(ossFileId, user.id)
        break
      case CaseMaterialType.AUDIO:
        processResult = await transcribeAudioService(ossFileId, user.id)
        break
      default:
        processResult = await convertPdfService(ossFileId, user.id)
    }

    results.push({
      ossFileId,
      status: processResult.success ? 'processing' : 'failed',
      error: processResult.error
    })
  }

  return resSuccess(event, '识别任务已提交', { results })
})
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run tests/server/material/recognition-api.test.ts
# 预期: PASS
```

- [ ] **Step 5: 提交**

```bash
git add server/api/v1/recognition/start.post.ts tests/server/material/recognition-api.test.ts
git commit -m "feat(api): 添加统一识别入口 API"
```

---

## Task 3: 修改客户端 promptInput.vue

**Files:**
- Modify: `app/components/caseAnalysis/promptInput.vue`

- [ ] **Step 1: 确认触发时机和位置**

查看 `promptInput.vue` 代码，确认:
- `handleFilesSelected` 函数是选中材料时的回调
- 识别调用应该在这个函数中进行

- [ ] **Step 2: 修改为调用统一 API**

```typescript
// 替换现有的 triggerDocRecognition、triggerImageRecognition、triggerAudioRecognition 调用
const fileIdsToRecognize = newFiles.map(f => f.id)

if (fileIdsToRecognize.length > 0) {
  const response = await useApiFetch('/api/v1/recognition/start', {
    method: 'POST',
    body: { ossFileIds: fileIdsToRecognize }
  })

  if (response?.results) {
    for (const result of response.results) {
      const status = result.status === 'processing' ? 'recognizing'
        : result.status === 'completed' ? 'success' : 'error'
      fileRecognitionStatus.value.set(result.ossFileId, status)
    }
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add app/components/caseAnalysis/promptInput.vue
git commit -m "refactor(ui): 改造客户端识别逻辑为调用统一 API"
```

---

## Task 4: 清理客户端 composables

**Files:**
- Modify: `app/composables/useDocxRecognition.ts`
- Modify: `app/composables/useImageRecognition.ts`
- Modify: `app/composables/useAudioRecognition.ts`
- Modify: `app/composables/useMineruRecognition.ts`

- [ ] **Step 1: 移除触发函数**

从四个 composables 中移除被统一 API 替代的触发函数:
- `useDocxRecognition.ts`: 移除 `triggerDocRecognition` 导出
- `useImageRecognition.ts`: 移除 `triggerImageRecognition` 导出
- `useAudioRecognition.ts`: 移除 `triggerAudioRecognition` 导出
- `useMineruRecognition.ts`: 移除相关导出

保留工具函数 (`isImageFile`, `isAudioFile` 等) 供其他场景使用。

- [ ] **Step 2: 提交**

```bash
git add app/composables/useDocxRecognition.ts app/composables/useImageRecognition.ts app/composables/useAudioRecognition.ts
git commit -m "refactor(ui): 清理客户端识别 composables"
```

---

## Task 5: 验证功能

- [ ] **Step 1: 运行所有测试**

```bash
npx vitest run tests/server/material/fileDetect.service.test.ts
npx vitest run tests/server/material/recognition-api.test.ts
```

- [ ] **Step 2: 手动测试**

- 上传图片/音频/文档文件
- 在分析页面选中文件
- 验证识别状态正确显示
- 验证音频积分扣减正确

- [ ] **Step 3: 提交**

```bash
git commit -m "test: 添加识别功能验证测试"
```

---

## 实施顺序

1. Task 1: 创建文件识别服务 (5 steps)
2. Task 2: 创建统一识别 API (5 steps)
3. Task 3: 修改客户端 (3 steps)
4. Task 4: 清理 composables (2 steps)
5. Task 5: 验证功能 (3 steps)
