# 文件上传策略治理与安全收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把文件上传的类型、大小、数量、配额、到账确认、旁路入口与使用前校验收敛到统一 `UploadPolicy` 策略中心，消除散落配置和绕过路径。

**Architecture:** 新增共享上传策略注册表 + 服务端强校验服务；主直传入口通过 `policyKey` 获取策略并生成 OSS policy；callback / confirm-upload 核对真实对象大小与 MIME；multipart、base64、远程 URL、MinerU、workspace 导出等旁路全部接入策略；业务使用 `ossFileId` 前再次校验用途。

**Tech Stack:** Nuxt 4 + Nitro + TypeScript、Prisma + PostgreSQL、OSS Storage Adapter、Vitest。

**对应设计文档:** `docs/superpowers/specs/2026-05-20-upload-policy-governance-design.md`

---

## 关键约定（所有任务通用）

- 类型检查用 `npx nuxi typecheck`，不要用 `tsc`。
- 测试用 `npx vitest run <file>`；涉及 DB 的测试使用项目现有 worker DB 隔离。
- 每个任务只改本任务列出的文件，提交前用 `git status --short` 确认没有暂存无关文件。
- 当前工作区可能有其它人留下的未提交改动，禁止 `git add -A` / `git add .`。
- 不改变用户需求来规避实现难点；如果发现策略会阻断现有业务，先回到设计文档确认兼容口径。
- 管理端与用户端 API 保持物理隔离，不能把 admin 旁路塞进用户接口里用权限判断区分。
- 安全上限写在代码策略里；未来后台配置只能下调，不允许突破代码上限。

## 已确认产品决策

1. SVG 保留，但按高风险分支处理，经过 sanitizer / 下载型展示，不进入可执行 HTML 渲染路径。
2. `demo_case_material` 走系统存储，不占管理员个人云盘。
3. 私人文书模板占用户云盘配额。
4. `agent_workspace_export` 生成的文件允许转案件材料，但必须显式调用 `case_material` 策略二次登记，不复用导出策略。

---

## File Structure

**新建：**

- `shared/types/uploadPolicy.ts` — 上传策略 key、输入方式、用途、策略结构类型。
- `shared/utils/uploadPolicy.ts` — 共享静态策略注册表，只放可双端复用的纯数据和只读查询。
- `server/services/upload-policy/uploadPolicy.service.ts` — 服务端强校验函数。
- `tests/shared/utils/uploadPolicy.test.ts` — 策略注册表与旧 accept 兼容测试。
- `tests/server/upload-policy/uploadPolicy.service.test.ts` — 服务端校验测试。

**主要修改：**

- `shared/utils/file.ts`
- `server/api/v1/storage/presigned-url/config.get.ts`
- `server/api/v1/storage/presigned-url/.get.ts`
- `server/api/v1/storage/presigned-url/.post.ts`
- `server/api/v1/storage/callback/.post.ts`
- `server/services/files/ossFileVerify.service.ts`
- `server/services/files/ossFiles.dao.ts`
- `app/store/file.ts`
- `app/composables/useBatchUpload.ts`
- 相关上传组件与识别 / 模板 / MinerU / workspace 入口

---

## Task 1: 新增 UploadPolicy 类型、策略注册表和旧配置兼容层

**Files:**

- Create: `shared/types/uploadPolicy.ts`
- Create: `shared/utils/uploadPolicy.ts`
- Create: `tests/shared/utils/uploadPolicy.test.ts`
- Modify: `shared/utils/file.ts`
- Modify: `shared/types/file.ts`（仅在需要补类型导出时）

- [ ] **Step 1: 写策略注册表失败测试**

创建 `tests/shared/utils/uploadPolicy.test.ts`，覆盖：

- 每个 `UploadPolicyKey` 都能通过 `getUploadPolicy` 取到策略。
- 每条策略都有 `displayName`、`storageSource`、`allowedTypes`、`maxFilesPerRequest`、`inputModes`、`quotaMode`、`allowedUsages`。
- `case_material` / `assistant_attachment` 与现有主配置一致：PDF 50MB，doc/docx/md 20MB，txt 1MB，图片 10MB，mp3/m4a 200MB，wav 500MB。
- `contract_review_original` 只允许 docx 20MB。
- `document_template_private` / `document_template_global` 只允许 docx 20MB。
- `demo_case_material.quotaMode` 为 `system_storage`。
- `remote_image_proxy` 保留 SVG 但标记高风险。
- `getFileSourceAccept(FileSource.CASE_ANALYSIS)` 与旧结构兼容。

Run: `npx vitest run tests/shared/utils/uploadPolicy.test.ts`

Expected: 失败，提示新模块不存在。

- [ ] **Step 2: 新增共享类型**

在 `shared/types/uploadPolicy.ts` 定义：

- `UploadPolicyKey`
- `UploadInputMode`
- `UploadUsage`
- `UploadQuotaMode`
- `UploadRiskLevel`
- `UploadAllowedType`
- `UploadPolicy`
- 前端展示 DTO 类型，如 `PublicUploadPolicy`

注意：策略里引用 `FileSource`，但不要引用任何 server-only 类型。

- [ ] **Step 3: 新增策略注册表**

在 `shared/utils/uploadPolicy.ts` 写静态策略：

- `CASE_MATERIAL`
- `ASSISTANT_ATTACHMENT`
- `CONTRACT_REVIEW_ORIGINAL`
- `DEMO_CASE_MATERIAL`
- `DOCUMENT_TEMPLATE_PRIVATE`
- `DOCUMENT_TEMPLATE_GLOBAL`
- `RECOGNITION_IMAGE_BASE64`
- `RECOGNITION_AUDIO_TEMP`
- `DOCUMENT_RECOGNITION_MINERU`
- `REMOTE_IMAGE_PROXY`
- `DOC_EMBEDDED_IMAGE`
- `AGENT_WORKSPACE_EXPORT`
- `DOCUMENT_EXPORT`

并导出：

- `UPLOAD_POLICIES`
- `getUploadPolicy(key)`
- `listUploadPolicies()`
- `getPublicUploadPolicy(key)`
- `mapFileSourceToDefaultPolicy(source)`（兼容旧 `source` 调用）
- `getAcceptListFromPolicy(policy)`

- [ ] **Step 4: 改造旧 `getFileSourceAccept`**

`shared/utils/file.ts` 中保留 `ASR_ACCEPT` / `DOC_ACCEPT` / `IMAGE_ACCEPT` 兼容导出，但 `getFileSourceAccept` 改为从策略注册表派生旧结构。

兼容映射建议：

| `FileSource` | 默认策略 |
|---|---|
| `FILE` | `case_material` |
| `ASR` | `recognition_audio_temp` 或保留 ASR 聚合策略 |
| `DOC` | `document_recognition_mineru` |
| `IMAGE` | `recognition_image_base64` / 图片聚合策略 |
| `CASE_ANALYSIS` | `case_material` |
| `DEMO_CASE` | `demo_case_material` |
| `DOCUMENT_TEMPLATE` | `document_template_private` |
| `DOCUMENT_EXPORT` | `document_export` |
| `DOC_EMBEDDED_IMAGE` | `doc_embedded_image` |

如果某个 source 对应多个策略，以“旧行为最接近的公开上传策略”为默认值，并在注释里说明新代码应使用 `policyKey`。

- [ ] **Step 5: 验证**

Run:

```bash
npx vitest run tests/shared/utils/uploadPolicy.test.ts
npx nuxi typecheck
```

Expected: 全部通过。

---

## Task 2: 新增服务端上传策略校验服务

**Files:**

- Create: `server/services/upload-policy/uploadPolicy.service.ts`
- Create: `tests/server/upload-policy/uploadPolicy.service.test.ts`

- [ ] **Step 1: 写失败测试**

测试覆盖：

- `validateUploadIntent` 同时校验扩展名和 MIME，二者必须命中同一个 `allowedTypes` 项。
- 文件无扩展名拒绝。
- 扩展名合法但 MIME 不合法拒绝。
- MIME 合法但扩展名不合法拒绝。
- 文件大小等于上限通过，超过 1 byte 拒绝。
- `validateUploadBatch` 校验单次数量和总大小。
- `validateDecodedBase64` 校验 base64 解码后字节数。
- `validateRemoteDownload` 校验 content-length 和实际字节数。
- `assertFileUsableFor` 校验 `ossFile.source`、MIME、大小、状态、用途。
- SVG 在非高风险路径中拒绝，在明确允许 SVG 的策略中通过但带风险标记。

Run: `npx vitest run tests/server/upload-policy/uploadPolicy.service.test.ts`

Expected: 失败，服务模块不存在。

- [ ] **Step 2: 实现校验服务**

实现建议：

- `normalizeMimeType(mimeType)`
- `getExtension(fileName)`
- `findAllowedType(policy, fileName, mimeType)`
- `validateUploadIntent(policyKey, { fileName, fileSize, mimeType, encrypted? })`
- `validateUploadBatch(policyKey, files)`
- `validateDecodedBase64(policyKey, mimeType, decodedBytes)`
- `validateRemoteDownload(policyKey, { mimeType, contentLength?, actualBytes? })`
- `validateOssObjectAgainstRecord(policyKey, ossFile, actual)`
- `assertFileUsableFor(policyKey, ossFile, usage)`

错误返回建议用结构化对象：

```ts
type UploadPolicyValidationResult =
  | { ok: true; policy: UploadPolicy; allowedType: UploadAllowedType }
  | { ok: false; code: string; message: string }
```

API 层再把 `message` 转成用户可理解的错误。

- [ ] **Step 3: 统一格式化错误文案**

避免各入口拼不同文案。至少提供：

- 不支持的文件类型
- 文件大小超出限制
- 单次上传数量超出限制
- 单次上传总大小超出限制
- 当前场景不允许加密上传
- 文件不能用于当前业务场景

- [ ] **Step 4: 验证**

Run:

```bash
npx vitest run tests/server/upload-policy/uploadPolicy.service.test.ts
npx nuxi typecheck
```

Expected: 通过。

---

## Task 3: 主直传配置与签名前校验切换到 policyKey

**Files:**

- Modify: `server/api/v1/storage/presigned-url/config.get.ts`
- Modify: `server/api/v1/storage/presigned-url/.get.ts`
- Modify: `server/api/v1/storage/presigned-url/.post.ts`
- Test: `tests/server/storage/presigned-url*.test.ts`（按现有测试文件实际命名追加）

- [ ] **Step 1: 配置接口支持 `policyKey`**

`config.get.ts` 支持：

- `?policyKey=case_material` 返回单个公开策略的旧 accept 兼容结构 + 新 policy 元数据。
- `?source=caseAnalysis` 走兼容映射。
- 无参数返回公开策略列表。

兼容期保留旧响应字段，避免前端尚未切完时断裂。

- [ ] **Step 2: 单文件签名 `.get.ts` 改用策略校验**

入参新增可选 `policyKey`。解析逻辑：

1. 优先用 `policyKey`。
2. 没有 `policyKey` 时用 `source` 映射默认策略，并打兼容日志。
3. 调 `validateUploadIntent` 校验文件名 / MIME / size / encrypted。
4. 按策略 `quotaMode` 决定是否检查用户云盘。
5. 创建 `ossFiles.source = policy.storageSource`。
6. OSS policy 使用当前文件对应 allowed type 的 `maxBytes` 和 MIME 列表。

注意：如果策略为 `system_storage`，不能继续用普通用户目录；示范案例等系统存储路径在 Task 6 具体接入。

- [ ] **Step 3: 批量签名 `.post.ts` 改用策略校验**

入参新增可选 `policyKey`。校验：

- files 仍最少 1、最多由策略决定。
- 总大小由策略决定。
- 每个文件分别用策略校验。
- 用户云盘配额只对 `user_storage_required` 检查。
- `contentLengthRange` 每个文件用自己的 allowed type 上限。

- [ ] **Step 4: 写/更新接口测试**

覆盖：

- 旧 `source=caseAnalysis` 仍可拿签名。
- 新 `policyKey=contract_review_original` 上传 PDF 被拒绝。
- `case_material` 上传合法 PDF 通过。
- `case_material` 超 20 个文件拒绝。
- 批量总大小超限拒绝。
- 加密上传只在允许策略中通过。
- `demo_case_material` 不检查管理员个人云盘配额（系统存储路径在后续任务完成后补完整断言）。

- [ ] **Step 5: 验证**

Run:

```bash
npx vitest run <presigned-url 测试文件>
npx nuxi typecheck
```

Expected: 通过。

---

## Task 4: 前端上传配置、store 与主上传组件接入 policyKey

**Files:**

- Modify: `app/store/file.ts`
- Modify: `app/composables/useBatchUpload.ts`
- Modify: `app/components/general/fileUploader.vue`
- Modify: `app/components/caseCreation/MaterialUploader.vue`
- Modify: `app/components/ai/AiPromptInput.vue`
- Modify: `app/components/admin/demo-cases/MaterialUploader.vue`
- Modify: `app/components/assistant/contract/ContractCreateReviewForm.vue`
- Modify: `app/components/assistant/contract/ContractUploadNewVersionDialog.vue`

- [ ] **Step 1: store 类型增加 `policyKey`**

`PresignedUrlParams` / `BatchPresignedUrlParams` 增加 `policyKey?: UploadPolicyKey`。

`getUploadConfig` 支持 `policyKey` 查询；旧 `source` 保留。

- [ ] **Step 2: useBatchUpload 消费新配置**

`validateFile` 支持新 policy DTO，同时保留旧 `FileSourceAccept` 结构兼容。

文件类型判断保留现有浏览器 MIME + 扩展名兜底逻辑，但最终校验仍以后端为准。

- [ ] **Step 3: 各入口传明确策略**

建议映射：

| 前端入口 | policyKey |
|---|---|
| 案件材料上传 | `case_material` |
| 通用问答附件 | `assistant_attachment` |
| 示范案例材料 | `demo_case_material` |
| 合同新建审查 | `contract_review_original` |
| 合同上传新版本 | `contract_review_original` |
| 通用文件 uploader 默认 | `case_material` 或由调用方显式传入 |

- [ ] **Step 4: UI 文案仍使用策略返回值**

不要在组件里手写“20MB / 50MB / 10MB”。上传提示、accept、错误文案都尽量从策略配置生成。

- [ ] **Step 5: 验证**

Run:

```bash
npx nuxi typecheck
```

Expected: 类型通过。

浏览器手工回归留到 Task 9。

---

## Task 5: callback / confirm-upload 增加实际对象校验

**Files:**

- Modify: `server/api/v1/storage/callback/.post.ts`
- Modify: `server/services/files/ossFileVerify.service.ts`
- Modify: `server/services/files/ossFiles.dao.ts`
- Test: `tests/server/storage/*callback*.test.ts`
- Test: `tests/server/storage/*confirm*.test.ts`

- [ ] **Step 1: 扩展 callback 输入**

`StorageCallbackConfirmInput` 增加：

- `declaredSize`
- `declaredMimeType`
- `source`

`callback/.post.ts` 从 body 解析：

- `size`
- `mimeType`
- `x:source`
- `x:original_mime_type`

解析失败时拒绝处理，但仍按 OSS callback 约定返回 JSON。

- [ ] **Step 2: 找到策略**

callback 里无法直接知道 `policyKey` 时：

- 优先从 callbackVar 增加 `policy_key`。
- 兼容旧记录时用 `ossFiles.source` 映射默认策略。

因此 Task 3 生成签名时也要把 `policy_key` 放入 callbackVar。

- [ ] **Step 3: 实际对象校验**

在 `confirmOssFileByStorageCallbackService` 中：

- 保留现有 fileId / filePath / userId / PENDING 校验。
- 调 `validateOssObjectAgainstRecord` 校验 size / MIME / originalMimeType。
- 常规上传：callback size 必须等于或小于登记 size，且不能超过策略上限。
- 加密上传：Content-Type 可为 `application/octet-stream`，业务 MIME 用 `originalMimeType` 校验。

- [ ] **Step 4: confirm-upload HEAD 兜底校验**

`verifyAndFixOssFileService` 的 HEAD 命中后不能直接标记 UPLOADED：

- 校验 `headResult.size`。
- 如果 adapter 能返回 content type，则一起校验。
- adapter 拿不到 content type 时至少校验 size，并记录 `actualMimeType=null`。

- [ ] **Step 5: DAO 日志结构化**

`markOssFileUploadedByVerifyDao` / `markOssFileUploadedByCallbackDao` 不必新增 DB 字段，但日志里记录：

- `policyKey`
- `declaredSize`
- `actualSize`
- `declaredMimeType`
- `actualMimeType`
- `validationStage`

- [ ] **Step 6: 测试**

覆盖：

- callback size 超策略拒绝。
- callback MIME 与原始登记不一致拒绝。
- 加密上传使用 `originalMimeType` 通过。
- callback 缺 `fileId` / path mismatch / user mismatch 仍拒绝。
- confirm-upload HEAD size 不一致拒绝标记 UPLOADED。
- 旧记录无 `policy_key` 时可通过 `source` 映射。

Run:

```bash
npx vitest run <callback/confirm 测试文件>
npx nuxi typecheck
```

Expected: 通过。

---

## Task 6: 文书模板、合同审查、案件材料使用前校验

**Files:**

- Modify: `server/agents/document/documentTemplate.service.ts`
- Modify: `server/api/v1/assistant/document/templates.post.ts`
- Modify: `server/api/v1/admin/document-templates/index.post.ts`
- Modify: `server/api/v1/material/upload.post.ts`
- Modify: contract review upload/creation service files（按现有实际调用点）
- Test: 文书模板、材料登记、合同上传相关测试

- [ ] **Step 1: 文书模板接入策略**

`createDocumentTemplateService` 去掉本地 `MAX_FILE_SIZE` 常量，改为：

- `scope=user` 使用 `document_template_private`。
- `scope=global` 使用 `document_template_global`。
- 校验 docx / 20MB。
- 私人模板检查用户云盘配额。
- 全局模板走系统存储。

保留占位符扫描和 docxtemplater compile 逻辑。

- [ ] **Step 2: 模板上传 handler 传递 scope 语义**

用户端 `/assistant/document/templates.post.ts` 明确使用私人模板策略。

管理端 `/admin/document-templates/index.post.ts` 明确使用全局模板策略。

不要把两个接口合并。

- [ ] **Step 3: 合同审查只允许 docx 策略**

合同审查首版和新版本上传都使用 `contract_review_original`。

服务端在真正创建合同审查任务前调用 `assertFileUsableFor`，防止用户绕过前端把其它材料 ID 塞进来。

- [ ] **Step 4: 案件材料登记使用前校验**

`material/upload.post.ts` 绑定 `ossFileId` 时：

- 校验文件属于当前用户。
- 校验已上传。
- 校验符合 `case_material` 用途。

如果是由 `agent_workspace_export` 转案件材料，必须走显式二次登记路径，并在登记时按 `case_material` 校验。

- [ ] **Step 5: 测试**

覆盖：

- 私人模板 docx 20MB 内通过。
- 私人模板超限拒绝。
- 私人模板云盘不足拒绝。
- 全局模板不占管理员个人云盘。
- 合同审查上传 PDF 拒绝。
- 案件材料绑定不符合策略的 ossFile 拒绝。

Run:

```bash
npx vitest run <document template/material/contract 测试文件>
npx nuxi typecheck
```

Expected: 通过。

---

## Task 7: 图片 base64、远程图片代理、文档内嵌图片收口

**Files:**

- Modify: `server/api/v1/recognition/image.post.ts`
- Modify: `server/api/v1/proxy/image.post.ts`
- Modify: `server/services/material/imageProcessor.ts`
- Modify: `server/services/material/ocr.service.ts`（如需要移除本地 supported types）
- Test: 图片识别、proxy image、imageProcessor 相关测试

- [ ] **Step 1: 图片 base64 识别**

`/api/v1/recognition/image` 在调用识别服务前：

- 校验 base64 可解码。
- 解码后字节数不超过 `recognition_image_base64` 策略。
- MIME 命中图片策略。
- 关联 `ossFileId` 属于当前用户、UPLOADED、可用于图片识别。

- [ ] **Step 2: 远程图片代理流式限流**

`/api/v1/proxy/image`：

- SSRF guard 保持。
- 先检查 `Content-Length`。
- 无 `Content-Length` 时不要直接 `arrayBuffer()` 全量读入；改为流式读取并累计，超过上限立即中断。
- MIME 用 `remote_image_proxy` 策略校验。
- SVG 保留，但必须走高风险分支：sanitizer / 下载型展示，不进入可执行 HTML 渲染路径。

- [ ] **Step 3: 文档内嵌图片**

`imageProcessor.ts`：

- base64 图片解码前后都做大小限制。
- URL 图片下载使用 SSRF guard + 流式限流。
- 单张 10MB。
- 单文档最多 50 张，总计 100MB。
- 上传成功后 `ossFiles.status` 应为 UPLOADED，不留下 PENDING。
- SVG 按高风险分支处理。

- [ ] **Step 4: 测试**

覆盖：

- base64 图片超 10MB 拒绝。
- MIME 不在策略内拒绝。
- 远程图片 Content-Length 超限拒绝。
- 无 Content-Length 的流式超限拒绝。
- SVG 保留但走高风险处理路径。
- 内嵌图片数量 / 总量超限拒绝或跳过并记录。

Run:

```bash
npx vitest run <image/proxy/imageProcessor 测试文件>
npx nuxi typecheck
```

Expected: 通过。

---

## Task 8: 音频临时上传、MinerU 中转、Agent workspace 导出收口

**Files:**

- Modify: `server/api/v1/recognition/audio/temp-upload.post.ts`
- Modify: `server/api/v1/recognition/audio/index.post.ts`
- Modify: `server/api/v1/recognition/mineru/upload.post.ts`
- Modify: `server/api/v1/recognition/mineru/upload-url.post.ts`
- Modify: `server/api/v1/recognition/mineru/submit.post.ts`
- Modify: `server/services/agent-platform/tools/uploadWorkspaceFile.tool.ts`
- Test: ASR、MinerU、workspace upload 相关测试

- [ ] **Step 1: 音频临时上传硬上限**

`temp-upload.post.ts`：

- `actualMimeType = ossFile.originalMimeType || mimeType` 保持。
- 用 `recognition_audio_temp` 校验 MIME 和 `fileSize`。
- `contentLengthRange` 可保留 10% 容忍，但不得超过策略上限。
- 原始 ossFile 必须已上传且可用于音频识别。

- [ ] **Step 2: 音频识别入口使用前校验**

`audio/index.post.ts`：

- 不再只看 `SUPPORTED_AUDIO_TYPES` 本地常量。
- 调 `assertFileUsableFor` 校验 `ossFileId`。
- `SUPPORTED_AUDIO_TYPES` 如仍需导出给旧代码，改为从策略派生。

- [ ] **Step 3: MinerU 上传代理绑定任务**

`mineru/upload.post.ts`：

- 第一阶段如果不改接口形态，也必须校验 `uploadUrl` 域名白名单。
- 更推荐绑定 `ossFileId` / `taskId` / `batchId`，服务端从 MinerU 任务记录取上传 URL，不接受任意外部 URL。
- base64 解码后大小符合 `document_recognition_mineru`。
- 原始文件属于当前用户、UPLOADED、可用于文档识别。

`upload-url.post.ts` / `submit.post.ts` 在创建 MinerU 任务前也要做使用前校验。

- [ ] **Step 4: Agent workspace 导出**

`uploadWorkspaceFile.tool.ts`：

- 50MB 上限从 `agent_workspace_export` 策略读取。
- MIME map 从策略派生或受策略覆盖。
- 用户云盘不足时临时 24h 兜底保留。
- 返回 file-card 时标记这是导出文件。
- 允许转案件材料，但必须走 `case_material` 二次登记，不在工具里自动把导出文件作为案件材料。

- [ ] **Step 5: 测试**

覆盖：

- 解密后音频超过策略上限拒绝。
- 音频 MIME 由 originalMimeType 决定。
- MinerU 上传代理拒绝非白名单 URL。
- MinerU 上传代理拒绝非当前用户任务。
- workspace 超 50MB 拒绝。
- workspace 导出不自动成为案件材料。

Run:

```bash
npx vitest run <audio/mineru/workspace 测试文件>
npx nuxi typecheck
```

Expected: 通过。

---

## Task 9: 清理散落配置、补文档、做完整回归

**Files:**

- Modify: `docs/tech-docs/infra/storage-oss.md`
- Modify: `docs/tech-docs/frontend/composables.md`（如涉及前端上传配置说明）
- Modify: 相关测试或脚本

- [ ] **Step 1: 搜索散落配置**

Run:

```bash
rg -n "MAX_FILE_SIZE|SUPPORTED_.*TYPES|contentLengthRange|20 \\* 1024|50 \\* 1024|10 \\* 1024|200 \\* 1024|500 \\* 1024" shared server app tests -S
```

Expected:

- 真正的上传限制只在策略中心或策略测试中出现。
- 业务入口只调用策略，不再维护独立常量。
- 若有非上传领域常量，保留并加注释避免误判。

- [ ] **Step 2: 增加防回散测试**

可以新增一个轻量测试或脚本，扫描常见散落常量：

- 允许列表：`shared/utils/uploadPolicy.ts`、策略测试、第三方协议不可避免处。
- 其它文件出现新增上传上限常量时测试失败。

如果项目已有类似架构扫描测试，挂到现有测试文件里；不要引入沉重的新工具。

- [ ] **Step 3: 更新技术文档**

更新 `docs/tech-docs/infra/storage-oss.md`：

- 前端直传由 `policyKey` 决定策略。
- `FileSource` 只代表存储分类，不再代表完整上传规则。
- callback / confirm-upload 会核对实际对象。
- 旁路入口必须接入 `UploadPolicy`。

如前端 composable 文档提到旧 `source` 配置，也同步更新。

- [ ] **Step 4: 定向测试**

按前面任务触达面跑定向测试：

```bash
npx vitest run tests/shared/utils/uploadPolicy.test.ts
npx vitest run tests/server/upload-policy/uploadPolicy.service.test.ts
npx vitest run <storage callback/presigned-url 测试文件>
npx vitest run <document template/material/contract 测试文件>
npx vitest run <image/audio/mineru/workspace 测试文件>
```

Expected: 全部通过。

- [ ] **Step 5: 类型检查**

Run:

```bash
npx nuxi typecheck
```

Expected: 通过。

- [ ] **Step 6: 手工回归**

至少验证以下用户可感知流程：

- 案件创建上传 PDF / docx / 图片 / 音频。
- 通用问答上传附件并能进入后续材料处理。
- 合同审查上传 docx 成功，PDF 被拒绝。
- 用户私人文书模板 docx 上传成功，超限被拒绝。
- 管理端示范案例材料上传成功，不占管理员个人云盘。
- 远程图片代理仍能处理普通图片。
- workspace 导出文件仍能生成下载卡片，转案件材料时走二次登记。

- [ ] **Step 7: 最终检查**

Run:

```bash
git diff --check
git status --short
```

Expected:

- 无 whitespace error。
- 只包含本计划相关文件。

---

## 推荐提交切分

1. `feat(upload): 新增上传策略注册表与校验服务`
2. `feat(upload): 直传签名链路接入 policyKey`
3. `feat(upload): 前端上传入口改用策略配置`
4. `fix(storage): callback 与 confirm-upload 校验实际对象`
5. `feat(upload): 模板合同材料入口接入上传策略`
6. `fix(upload): 识别与远程图片旁路接入上传策略`
7. `fix(upload): MinerU 与 workspace 导出接入上传策略`
8. `docs(upload): 更新上传策略治理文档与防回散检查`

每次提交只 stage 对应任务文件，不要把并行任务的测试改动一起带入。

## 回滚策略

- `policyKey` 接入期间保留 `source` 兼容映射，主链路出现问题时可临时让旧调用方继续传 `source`。
- 策略注册表本身不改数据库，不需要数据回滚。
- callback 实际对象校验若线上误伤，可通过短期 feature flag 只记录不拒绝；但默认实现应是拒绝。
- 旁路入口逐个接入，发现某入口兼容风险时只回滚该入口改动，不影响主策略中心。
