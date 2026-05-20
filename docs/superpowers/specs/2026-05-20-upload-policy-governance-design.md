# 文件上传策略治理与安全收口设计

> 日期：2026-05-20
> 范围：收敛 LexSeek 项目中文件上传的类型、大小、数量、配额、回调确认、旁路上传与使用前校验。

## 1. 背景与问题

当前项目的主上传链路已经有中心配置：`shared/utils/file.ts` 定义了 ASR、文档、图片等允许类型和大小，`/api/v1/storage/presigned-url` 在签名前做 MIME / size 校验，OSS policy 也带 `content-length-range` 限制。

问题在于：这只覆盖了“用户通过预签名 URL 直传 OSS”的主链路。项目里还有文书模板 multipart 上传、合同审查 docx 本地限制、图片 base64 识别、音频解密临时上传、远程图片代理、Markdown 内嵌图片下载、MinerU 中转、Agent workspace 导出等旁路。它们各自维护大小和类型判断，或者只依赖上游已经合法，导致上传安全边界分散。

更具体地说，当前状态是：

- 主直传入口有统一雏形，但 `FileSource` 同时承担“存储分类”和“业务场景”两个职责，表达能力不够。
- 文书模板、合同审查、Agent workspace 等位置存在独立 `MAX_FILE_SIZE` / MIME map。
- callback / confirm-upload 主要核对 `fileId`、路径、用户、PENDING 状态，未把实际对象大小 / Content-Type 纳入统一校验。
- base64、远程 URL、MinerU 代理这类非浏览器直传入口，不天然受 OSS policy 保护。
- 有些 `FileSource` 已存在但没有进入中心配置，如 `DOCUMENT_TEMPLATE`、`DOCUMENT_EXPORT`、`DOC_EMBEDDED_IMAGE`。

这不是一个单点 bug，而是上传治理模型缺失：项目缺少一套能被所有入口复用的“上传策略”。

## 2. 目标 / 非目标

### 目标

1. 所有文件进入系统前，都能追溯到明确的上传策略。
2. 类型、大小、数量、总大小、是否占云盘、是否允许加密、是否允许 base64 / URL / 中转上传，都由统一策略描述。
3. 前端提示、后端签名、multipart 上传、base64 解码、远程下载、MinerU 中转、workspace 导出使用同一套规则。
4. callback / confirm-upload 在身份和路径之外，补上实际对象大小与 MIME 的核验。
5. 文件被业务使用前再次校验用途，避免“上传合法，但被拿去错误场景使用”。
6. 保留现有用户可感知能力，不借治理之名删除需求；确需收紧的高风险类型单独列为兼容决策。

### 非目标

- 不在本设计里重写存储适配器体系。
- 不把所有上传都改造成一个新网关；第一阶段以统一策略和全入口接入为主。
- 不把安全上限完全改成后台可配。后台可下调限制，但不能突破代码内置安全上限。
- 不改变管理端与用户端 API 物理隔离原则。

## 3. 核心设计

核心思路：新增“上传策略”作为安全治理源头，把 `FileSource` 从规则源降级为“存储分类”。

`FileSource` 继续用于 OSS 目录、文件列表来源、业务归类；新增 `UploadPolicyKey` 表达真实业务入口，例如：

- `case_material`
- `assistant_attachment`
- `contract_review_original`
- `demo_case_material`
- `document_template_private`
- `document_template_global`
- `recognition_image_base64`
- `recognition_audio_temp`
- `document_recognition_mineru`
- `remote_image_proxy`
- `doc_embedded_image`
- `agent_workspace_export`
- `document_export`

每个入口只允许选择一个策略。策略决定这个入口能接收什么文件、最大多大、能不能走某种上传方式，以及上传后能不能进入识别/案件材料/模板解析等后续流程。

## 4. 策略模型

新增共享类型，建议放在 `shared/types/uploadPolicy.ts`：

```ts
export enum UploadPolicyKey {
  CASE_MATERIAL = 'case_material',
  ASSISTANT_ATTACHMENT = 'assistant_attachment',
  CONTRACT_REVIEW_ORIGINAL = 'contract_review_original',
  DEMO_CASE_MATERIAL = 'demo_case_material',
  DOCUMENT_TEMPLATE_PRIVATE = 'document_template_private',
  DOCUMENT_TEMPLATE_GLOBAL = 'document_template_global',
  RECOGNITION_IMAGE_BASE64 = 'recognition_image_base64',
  RECOGNITION_AUDIO_TEMP = 'recognition_audio_temp',
  DOCUMENT_RECOGNITION_MINERU = 'document_recognition_mineru',
  REMOTE_IMAGE_PROXY = 'remote_image_proxy',
  DOC_EMBEDDED_IMAGE = 'doc_embedded_image',
  AGENT_WORKSPACE_EXPORT = 'agent_workspace_export',
  DOCUMENT_EXPORT = 'document_export',
}

export interface UploadPolicy {
  key: UploadPolicyKey
  displayName: string
  storageSource: FileSource
  allowedTypes: UploadAllowedType[]
  maxFilesPerRequest: number
  maxTotalBytesPerRequest?: number
  inputModes: UploadInputMode[]
  quotaMode: 'user_storage_required' | 'user_storage_with_temp_fallback' | 'system_storage' | 'temporary' | 'none'
  encryptionAllowed: boolean
  callbackRequired: boolean
  verifyActualObject: boolean
  allowedUsages: UploadUsage[]
}

export interface UploadAllowedType {
  extensions: string[]
  mimeTypes: string[]
  maxBytes: number
}
```

服务端再提供校验服务，建议放在 `server/services/upload-policy/`：

- `getUploadPolicy(policyKey)`
- `listPublicUploadPolicies()`
- `validateUploadIntent(policyKey, file)`
- `validateUploadBatch(policyKey, files)`
- `validateDecodedBase64(policyKey, mimeType, decodedBytes)`
- `validateRemoteDownload(policyKey, responseHeaders, actualBytes)`
- `validateOssObjectAgainstRecord(policyKey, ossFile, headResult, callbackBody?)`
- `assertFileUsableFor(policyKey, ossFile, usage)`

前端只消费可展示字段和上传限制；服务端保留完整安全校验，不能信任前端。

## 5. 初始策略表

| 策略 | 存储分类 | 输入方式 | 类型 / 大小 | 数量 | 配额 | 用途 |
|---|---|---|---|---|---|---|
| `case_material` | `CASE_ANALYSIS` | OSS 直传 | 文档、图片、音频沿用现有主配置：PDF 50MB，doc/docx/md 20MB，txt 1MB，图片 10MB，mp3/m4a 200MB，wav 500MB | 单次 20 | 用户云盘必检 | 案件材料、识别、检索 |
| `assistant_attachment` | `CASE_ANALYSIS` | OSS 直传 | 与 `case_material` 一致 | 单次 20 | 用户云盘必检 | 通用问答附件、后续可转案件 |
| `contract_review_original` | `CASE_ANALYSIS` | OSS 直传 | 仅 docx，20MB | 单次 1 | 用户云盘必检 | 合同审查 |
| `demo_case_material` | `DEMO_CASE` | OSS 直传 | 与案件材料一致 | 单次 20 | 系统存储，不占管理员个人云盘 | 示范案例材料 |
| `document_template_private` | `DOCUMENT_TEMPLATE` | multipart 服务端上传 | 仅 docx，20MB | 单次 1；个人模板总数 20 | 用户云盘必检 | 私人文书模板 |
| `document_template_global` | `DOCUMENT_TEMPLATE` | multipart 服务端上传 | 仅 docx，20MB | 单次 1 | 系统存储 | 管理端全局模板 |
| `recognition_image_base64` | `IMAGE` | base64 | png/jpg/jpeg/gif/webp/heic/heif，解码后 10MB | 单次 1 | 不新增云盘占用，依赖关联 OSS 文件 | 图片识别 |
| `recognition_audio_temp` | `ASR` | 临时 OSS 直传 | m4a/mp3 200MB，wav 500MB；解密后也不得超过原始 MIME 上限 | 单次 1 | 临时路径 | 加密音频解密后识别 |
| `document_recognition_mineru` | `DOC` / `CASE_ANALYSIS` | MinerU 中转 | PDF 50MB，doc/docx 20MB | 按 MinerU 批次限制，项目侧先设单批 20 | 不新增云盘占用，必须绑定已有 OSS 文件 | 文档识别 |
| `remote_image_proxy` | `IMAGE` | 远程 URL 下载 | 默认图片 10MB；保留 SVG，但单独走高风险兼容分支 | 单次 1 | none | 代理读取远程图片 |
| `doc_embedded_image` | `DOC_EMBEDDED_IMAGE` | base64 / URL / MinerU 结果 | 图片 10MB；单文档建议最多 50 张，总计 100MB | 每文档 50 | 用户云盘或系统上下文，按调用方决定 | 文档内嵌图片 |
| `agent_workspace_export` | `CASE_ANALYSIS` | 服务端 workspace 文件 | 现有扩展名 map，单文件 50MB | 单次 1 | 用户云盘优先，不足时临时 24h | AI 生成文件下载 |
| `document_export` | `DOCUMENT_EXPORT` | 服务端生成 | 由导出服务控制，建议 50MB 软上限 | 单次 1 | 系统生成，不接收用户上传 | 文书导出 |

SVG 处理决策：保留 `image/svg+xml` 兼容，但不把它当普通位图处理。SVG 在 `remote_image_proxy` / `doc_embedded_image` 中必须标记为高风险分支，经过 sanitizer / 下载型展示，不进入可执行 HTML 渲染路径。

## 6. 强制校验层

### 6.1 前端展示层

`/api/v1/storage/presigned-url/config` 改为按 `policyKey` 返回上传限制，兼容期可以继续支持 `source` 参数，但新调用方必须传 `policyKey`。

前端上传组件不再手写 accept / max size：

- 通用 uploader：传 `policyKey`。
- 案件材料：`case_material`。
- 通用问答附件：`assistant_attachment`。
- 合同审查：`contract_review_original`。
- 文书模板：`document_template_private` 或 `document_template_global`。

`useBatchUpload.validateFile` 继续做本地快速提示，但后端校验仍是最终边界。

### 6.2 签名前校验

`GET/POST /api/v1/storage/presigned-url` 改为解析 `policyKey`：

1. 校验 `policyKey` 合法。
2. 校验文件名必须有扩展名，扩展名与 MIME 必须都命中同一个 `allowedTypes` 项。
3. 校验每个文件大小、单次数量、总大小。
4. 按策略决定是否检查用户云盘配额。
5. 按策略决定是否允许加密上传。
6. 生成 `ossFiles` 时写入 `source = policy.storageSource`。
7. OSS policy 的 `content-length-range` 和 `Content-Type` 从策略得出。

兼容策略：

- 旧参数 `source` 仍可短期映射到默认策略，例如 `CASE_ANALYSIS -> case_material`。
- 新业务入口必须显式传 `policyKey`，避免继续把 `FileSource` 当业务场景使用。

### 6.3 callback / confirm-upload 到账校验

callback 服务现有校验保留：验签、`fileId`、`filePath`、`userId`、PENDING 状态、加密元信息。

新增实际对象校验：

1. callback body 中的 `size` 必须能转为正整数。
2. callback body 中的 `mimeType` 与策略允许类型匹配。加密文件允许 OSS Content-Type 为 `application/octet-stream`，但必须校验 `x:original_mime_type`。
3. `size` 不得大于 `ossFiles.fileSize` 的容忍范围。常规文件必须相等或小于登记值；加密文件可按策略设置少量容忍。
4. `size` 不得超过策略上限。
5. `confirm-upload` 的 HEAD 兜底同样校验 `headResult.size` 和可取得的 content type。
6. 校验失败时不标记 UPLOADED，并记录结构化日志。

这一步把“签名前说自己是合法文件”和“OSS 实际收到的是合法文件”闭环。

### 6.4 业务使用前校验

所有业务读取 `ossFileId` 后，不能只判断“文件属于当前用户”，还要判断“这个文件能用于当前场景”：

- `material/upload.post.ts`：登记案件材料前调用 `assertFileUsableFor(case_material, ossFile, 'case_material')`。
- 图片识别：确认关联 `ossFileId` 属于当前用户、已上传、且 MIME / size 符合图片策略。
- 音频识别：确认 `originalMimeType || fileType` 符合 ASR 策略。
- 文档识别 / MinerU：确认文件符合文档识别策略。
- 合同审查：只允许 `contract_review_original` 规则下的 docx。
- Agent workspace 导出的文件默认只作为下载卡片，不自动进入案件材料或识别用途；若要进入，必须显式走材料上传策略。

## 7. 旁路入口收口

### 7.1 文书模板

`createDocumentTemplateService` 中的 `.docx + 20MB` 改为调用策略校验。

管理端全局模板和用户私人模板使用不同 `policyKey`：

- 全局模板：系统存储，不占用户云盘。
- 私人模板：既检查模板数量上限，也检查用户云盘空间。

### 7.2 合同审查

前端本地 `.docx + 20MB` 限制继续保留，但来源改为策略配置。

后端签名时用 `contract_review_original`，不要继续只用宽泛的 `CASE_ANALYSIS` 默认策略。这样用户无法通过合同入口上传 PDF、图片或音频。

### 7.3 图片 base64 识别

`/api/v1/recognition/image` 在调用识别服务前补：

- base64 格式校验。
- 解码后字节数校验，不超过图片策略。
- MIME 必须命中图片策略。
- 关联的 `ossFileId` 必须属于当前用户、已上传，并且与本次 MIME / 大小匹配。

### 7.4 音频临时上传

`/api/v1/recognition/audio/temp-upload` 继续允许解密后临时上传，但 `fileSize * 1.1` 不能成为唯一上限。

新增规则：

- `fileSize` 不得超过原始音频 MIME 对应的策略上限。
- 临时上传签名的 `contentLengthRange` 仍可保留少量容忍，但最终不得突破策略上限。
- 原始 `ossFile.originalMimeType` 必须优先于请求参数。

### 7.5 远程图片代理

`/api/v1/proxy/image` 改为调用远程图片策略：

- SSRF guard 保持。
- `Content-Length` 超限时直接拒绝。
- 无 `Content-Length` 时读取过程需要流式限流，不能先完整读入内存再判断。
- 实际读取字节数超限即中断。
- SVG 保留兼容，但必须独立高风险分支处理，不进入可执行 HTML 渲染路径。

### 7.6 Markdown / 文档内嵌图片

`imageProcessor.ts` 处理 base64 和 URL 图片时调用 `doc_embedded_image` 策略：

- base64 解码前后都限制长度。
- URL 下载走 SSRF guard + 流式限流。
- 单张 10MB，单文档最多 50 张，总计 100MB。
- 上传成功后把 `ossFiles.status` 直接置为 UPLOADED，不再留下 PENDING。

### 7.7 MinerU 中转

`/api/v1/recognition/mineru/upload` 当前接收 `uploadUrl + base64 fileContent`，需要收紧：

- 上传 URL 必须来自当前用户刚创建的 MinerU 任务，不接受任意外部 URL。
- 请求应绑定 `ossFileId` / task id / batch id，服务端从任务上下文取上传 URL。
- base64 解码后大小必须符合 `document_recognition_mineru` 策略。
- 原始文件必须属于当前用户、已上传、可用于文档识别。
- MinerU 上传域名白名单校验。

第一阶段如不改接口形态，也至少要补 `uploadUrl` 域名白名单、`fileName` 扩展名、base64 解码大小上限和任务归属校验。

### 7.8 Agent workspace 导出

`upload_workspace_file` 保留 50MB 和临时路径兜底能力，但接入 `agent_workspace_export` 策略：

- MIME map 从策略派生或受策略覆盖。
- 用户云盘不足时临时 24h 的行为保留。
- 记录清楚这是 AI 生成下载文件，不默认成为案件材料。
- 允许用户后续把该文件加入案件，但必须显式通过 `case_material` 策略二次登记，不复用导出策略。

## 8. 安全上限与运行时配置

上传治理分两层：

1. **代码安全上限**：允许的最大类型集合、最大文件大小、最大数量、是否允许 base64 / URL / 中转。这些写在策略注册表里，是不能被后台突破的硬边界。
2. **运行时下调配置**：后续如需要，可允许租户或后台把图片从 10MB 下调到 5MB、把单次 20 个下调到 10 个，但不能上调超过代码上限，也不能开放策略未允许的新类型。

这样既支持运营管理，又不会把安全边界交给数据库配置。

## 9. 数据与日志

短期不需要改 `ossFiles` 表结构，也不强制历史数据迁移。

建议新增结构化日志字段：

- `policyKey`
- `fileId`
- `source`
- `declaredSize`
- `actualSize`
- `declaredMimeType`
- `actualMimeType`
- `validationStage`: `presign` / `callback` / `confirm_upload` / `base64` / `remote_download` / `usage`
- `decision`: `accepted` / `rejected`
- `reason`

如果后续需要审计报表，再考虑新增 `upload_policy_audit_logs` 表；第一期用现有 logger 即可。

## 10. 改动清单

| 文件 / 目录 | 改动 |
|---|---|
| `shared/types/uploadPolicy.ts` | 新增策略 key、策略结构、输入方式、用途类型 |
| `shared/utils/uploadPolicy.ts` | 新增静态策略注册表和只读查询函数 |
| `server/services/upload-policy/` | 新增服务端强校验函数 |
| `shared/utils/file.ts` | 兼容保留，逐步改为从策略注册表生成旧 accept 结构 |
| `server/api/v1/storage/presigned-url/config.get.ts` | 支持按 `policyKey` 返回配置 |
| `server/api/v1/storage/presigned-url/.get.ts` | 单文件签名前改用策略校验 |
| `server/api/v1/storage/presigned-url/.post.ts` | 批量签名前改用策略校验 |
| `server/services/files/ossFileVerify.service.ts` | callback / confirm-upload 增加实际对象核验 |
| `server/api/v1/storage/callback/.post.ts` | 传入 callback size / mimeType 供服务层核验 |
| `app/composables/useBatchUpload.ts` | 前端校验改消费 policy 配置 |
| `app/store/file.ts` | 上传配置接口和签名接口增加 `policyKey` |
| `app/components/**/MaterialUploader.vue` | 案件、通用问答、示范案例等传入明确 policy |
| `app/components/assistant/contract/**` | 合同审查上传改用 `contract_review_original` |
| `server/agents/document/documentTemplate.service.ts` | 文书模板接入策略校验和私人模板云盘配额 |
| `server/api/v1/recognition/image.post.ts` | base64 解码大小和关联文件策略校验 |
| `server/api/v1/recognition/audio/temp-upload.post.ts` | 解密后临时文件加入策略硬上限 |
| `server/api/v1/proxy/image.post.ts` | 远程下载接入策略和流式限流 |
| `server/services/material/imageProcessor.ts` | 内嵌图片接入策略、数量和总量上限 |
| `server/api/v1/recognition/mineru/upload.post.ts` | MinerU 中转补任务绑定、域名白名单和大小校验 |
| `server/services/agent-platform/tools/uploadWorkspaceFile.tool.ts` | workspace 导出接入策略 |
| `tests/**` | 补策略、签名、callback、旁路入口、使用前校验测试 |

## 11. 实施阶段

### 阶段 1：策略中心落地，不改变行为

- 新增策略注册表和服务端校验工具。
- 用现有规则填充初始策略。
- `getFileSourceAccept` 暂时从新策略派生，保证旧调用方不变。
- 补策略单元测试，锁定当前类型 / 大小矩阵。

### 阶段 2：主直传链路切换

- `config.get.ts`、单文件签名、批量签名接入 `policyKey`。
- 前端材料上传组件传明确策略。
- 保留 `source -> policyKey` 兼容映射，并打日志提醒。
- 补签名前拒绝测试：错误 MIME、扩展名不匹配、超大小、超数量、总量超限、配额不足。

### 阶段 3：旁路入口切换

- 文书模板、合同审查、图片 base64、音频临时上传、远程图片、内嵌图片、MinerU、workspace 导出逐个接入策略。
- 每接一个入口，删除该入口本地散落常量或改为从策略读取。
- 高风险 SVG 按已确认口径保留兼容，但不混进通用图片策略。

### 阶段 4：到账确认闭环

- callback 服务传入 `size` / `mimeType`。
- `confirmOssFileByStorageCallbackService` 和 `verifyAndFixOssFileService` 调策略校验实际对象。
- 补回调测试：size 不一致、MIME 不一致、加密原始 MIME 不合法、非 PENDING、路径不一致、用户不一致。

### 阶段 5：清理与防回散

- `rg "MAX_FILE_SIZE|SUPPORTED_.*TYPES|contentLengthRange"` 清理到策略中心或策略调用点。
- 文档更新 `docs/tech-docs/infra/storage-oss.md`。
- 增加 lint-like 测试或脚本，防止新入口继续新增散落上传限制。

## 12. 测试策略

### 单元测试

- 策略注册表：每个 `UploadPolicyKey` 都有合法 `FileSource`、类型、大小、输入方式。
- 文件校验：扩展名 / MIME 双匹配，大小边界，大小超限，未知 MIME，空扩展名。
- 批量校验：单次数量、总大小、混合合法/非法文件。
- base64 校验：非法 base64、解码后超限、MIME 不匹配。
- remote download 校验：Content-Length 超限、无 Content-Length 但流式超限、非法 MIME。

### 接口测试

- `GET/POST /storage/presigned-url` 按策略发签名。
- 旧 `source` 参数兼容映射仍可用。
- 合同审查入口不能上传 PDF / 图片。
- 文书模板只能上传 docx，私人模板检查云盘配额。
- 图片识别 base64 超 10MB 被拒绝。
- MinerU 上传代理拒绝非任务绑定 URL。

### callback / confirm-upload 测试

- callback 验签失败拒绝。
- `fileId` 缺失拒绝。
- 路径不一致拒绝。
- 用户不一致拒绝。
- size 超策略拒绝。
- MIME 不匹配拒绝。
- 加密上传使用 `originalMimeType` 校验。
- HEAD 兜底命中但实际大小不一致时拒绝标记 UPLOADED。

### 回归验证

- 案件材料上传仍可上传 PDF / docx / 图片 / 音频。
- 通用问答附件上传仍可用。
- 合同审查 docx 上传仍可用。
- 文书模板上传、扫描占位符仍可用。
- Agent workspace 文件导出仍可生成下载卡片。
- `npx nuxi typecheck` 通过。

## 13. 验收标准

1. 项目内所有上传入口都能列出对应 `UploadPolicyKey`。
2. 类型、大小、数量、总大小、配额规则在策略中心可查。
3. 主直传、multipart、base64、远程 URL、MinerU、workspace 都调用策略校验。
4. callback / confirm-upload 不再只信任签名前登记值，能核对实际对象。
5. 业务使用 `ossFileId` 前会校验用途。
6. 搜索散落常量时，只剩策略中心或调用策略中心的代码。
7. 上传策略相关测试覆盖成功路径、拒绝路径和兼容路径。

## 14. 风险与权衡

| 风险 | 处理 |
|---|---|
| 一次性改太多入口，回归面大 | 分阶段接入；主链路先切，旁路逐个收 |
| 旧调用方只传 `source` | 保留兼容映射，新增日志，后续统一清理 |
| SVG 兼容与安全冲突 | 保留兼容，但走单独高风险分支，经过 sanitizer / 下载型展示 |
| 私人模板之前可能未检查云盘配额 | 已确定纳入用户云盘配额；发布前做存量数据评估 |
| OSS HEAD 不一定能拿到可靠 Content-Type | size 必须校验；Content-Type 拿不到时按策略降级为“只允许签名时强限制 + 使用前校验”，并记录日志 |
| 加密上传实际对象 MIME 是 octet-stream | 用 `originalMimeType` 校验业务类型，用 size 校验对象大小 |

## 15. 已确认决策

1. `image/svg+xml` 保留，但必须按高风险分支处理，经过 sanitizer / 下载型展示，不进入可执行 HTML 渲染路径。
2. `demo_case_material` 走系统存储，不占管理员个人云盘。
3. 私人文书模板占用户云盘配额。
4. `agent_workspace_export` 生成的文件允许转案件材料，但必须显式调用 `case_material` 策略二次登记，不复用导出策略。

## 16. 推荐结论

采用“统一策略中心 + 全入口强制校验”的方案。

第一期不做上传网关大重构，而是先让每个入口都接入同一套策略。这样能快速解决配置散落、旁路缺口和 callback 未闭环的问题，同时保持现有用户流程稳定。等策略中心稳定后，再考虑是否把部分入口合并成更统一的上传网关。
