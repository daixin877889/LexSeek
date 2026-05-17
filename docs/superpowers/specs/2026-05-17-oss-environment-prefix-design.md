# OSS 文件环境前缀修复 + 历史迁移 设计文档

> 日期：2026-05-17
> 范围：修复多处 OSS 上传未带环境前缀的 BUG，收敛统一目录约定，并迁移已混入根目录的历史文件

## 一、背景与问题

LexSeek 的开发、测试、生产三个环境**共用同一个阿里云 OSS 存储桶**（`lexseek-files`），靠在 OSS object key 最前面加一个「环境前缀」实现隔离。该前缀来自：

- 配置项：`runtimeConfig.storage.basePath`（`nuxt.config.ts`）
- 环境变量：`NUXT_STORAGE_BASE_PATH`
- 各环境取值：开发 `dev/`、测试 `test/`、生产 `prod/`

正确的上传逻辑会把这个前缀拼到路径最前面。但项目里这段「拼 basePath」的逻辑**从未抽成函数**，而是以内联代码的形式被复制了 4 份；同时有 11 处上传**完全漏拼了前缀**，导致这些文件全部写进了 OSS 根目录、三环境混在一起。开发/测试环境做数据清理时，无法按环境区分这些文件，根本清不掉。

发现的直接症状：文书模板上传到根目录的 `global-templates/` 与 `users/{id}/templates/`，没有任何环境隔离。

### 已确认无问题的部分

- **后台创建示范案例**：材料文件走通用的「批量上传签名」接口（`presigned-url`），该接口正确带环境前缀，示范案例文件已按环境隔离。封面图是 URL 字段，无独立上传逻辑。

## 二、影响范围

### 2.1 缺环境前缀的 11 处上传（BUG）

| # | 业务场景 | 文件:行号 | 当前错误路径 |
|---|---------|----------|------------|
| 1 | 文书模板上传（全局/用户） | `server/agents/document/documentTemplate.service.ts:110-114` | `global-templates/...`、`users/{id}/templates/...` |
| 2 | 文书草稿导出 DOCX | `server/agents/document/documentExport.service.ts:88` | `users/{userId}/document-exports/...` |
| 3 | 合同审查 - 粘贴文本转 docx | `server/agents/contract/contractReview.service.ts:108` | `contract-review/{userId}/{uuid}.docx` |
| 4 | 合同审查 - 历史版本下载注入 | `server/agents/contract/contractReviewVersion.service.ts:387-388` | `contract-review/{userId}/version-{versionId}-{uuid}.docx` |
| 5 | 合同审查 - 审查结果持久化 | `server/agents/contract/middleware/reviewResultPersistence.middleware.ts:113-114` | `contract-review/{userId}/reviewed-{uuid}.docx` |
| 6 | 合同审查 - 重新生成批注稿 | `server/agents/contract/contractReviewRebuild.service.ts:158` | `contract-review/{userId}/rebuild-{uuid}.docx` |
| 7 | Agent 工具上传到用户云盘 | `server/services/agent-platform/tools/uploadWorkspaceFile.tool.ts:205` | `users/{userId}/workspace/{sessionId}/...` |
| 8 | Agent 工具上传到临时区 | `server/services/agent-platform/tools/uploadWorkspaceFile.tool.ts:249` | `temp/{userId}/workspace/{sessionId}/...` |
| 9 | MinerU PDF 转换内嵌图片 | `server/services/material/mineru.service.ts:147` | `mineru/{taskId}/{uniqueName}` |
| 10 | 语音识别原始结果 JSON | `server/services/material/asr.service.ts:390` | `asr/raw/{年}/{月}/{日}/{uuid}.json` |
| 11 | 临时音频上传签名 | `server/api/v1/recognition/audio/temp-upload.post.ts:119` | `temp/asr/{年}/{月}/{日}/...` |

第 3~5 处的实际上传由工具函数 `server/agents/contract/utils/uploadAndRegisterOssFile.ts` 完成，路径由上述各调用方构造后传入；该工具函数本身不拼前缀（另有 re-export shim `server/services/assistant/contract/utils/uploadAndRegisterOssFile.ts`）。

### 2.2 已带前缀但需收敛的 4 处（现有正确逻辑）

这 4 处各自内联了 `const basePath = storageConfig.basePath` + `${basePath}user${userId}/${source}/` —— 同一段逻辑被复制了 4 遍：

| 业务场景 | 文件:行号 |
|---------|----------|
| 云盘批量上传签名 | `server/api/v1/storage/presigned-url/.post.ts:122-123` |
| 云盘单文件上传签名 | `server/api/v1/storage/presigned-url/.get.ts:66,75` |
| MinerU 结果内嵌图片 | `server/services/material/mineruResult.service.ts:162-163` |
| Markdown 图片处理 | `server/services/material/imageProcessor.ts:83,86` |

### 2.3 关键结论：迁移可行

经核查，所有持久化文件的 OSS 路径**都汇总在 `ossFiles.filePath` 一张表一列**（文书模板、文书导出、合同审查文档、Agent 云盘文件、MinerU 内嵌图、ASR 原始 JSON 全部如此）。内容里的内嵌图片用占位符 `{{OSS_IMAGE:bucket:ossFileId}}` **按文件 ID 引用**，渲染时才查库取路径生成签名 URL —— 没有任何地方把裸 OSS 路径写死进内容。

**因此历史迁移只需操作 `ossFiles.filePath` 一列即可，对所有文件类型都安全**，不会出现「文件搬走了但内容里的链接失效」。

## 三、设计方案

### 3.1 统一目录约定

沿用现有正确逻辑的 `{env}/user{id}/{source}/` 思路，补齐「系统文件」「临时文件」两种归属，形成完整约定：

```
{env}/{owner}/{source}/[{subDir}/]{filename}
```

| 段 | 取值 |
|----|------|
| `{env}` | 环境前缀，复用 `runtimeConfig.storage.basePath`（`dev/`/`test/`/`prod/`）。为空时整体不加前缀 |
| `{owner}` | 用户文件 `user{id}`；无归属的系统文件（如全局文书模板）`system`；临时文件 `temp` |
| `{source}` | 业务分类，用现有 `FileSource` 枚举值（`document_template`/`document_export`/`caseAnalysis`/`doc_embedded_image`/`asr` 等） |
| `{subDir}` | 可选二级目录（如 workspace 的 sessionId、MinerU 的 taskId、ASR 的日期分桶） |

### 3.2 统一函数（收敛现有 4 处轮子）

新增路径构造模块 `server/utils/storagePath.ts`，导出：

- `buildStorageKey({ scope, userId?, source, fileName, subDir? })` → 返回完整 object key（含 `{env}` 前缀）
- `buildStorageDir({ scope, userId?, source, subDir? })` → 返回目录（末尾带 `/`），供预签名上传流程使用

落点说明：这是纯路径拼接工具，既非 Service 也非 DAO，**不能**放进 `server/services/storage/`（该目录受 `*.service.ts` / `*.dao.ts` 命名规范约束）。它依赖 `useRuntimeConfig()`（服务端专用，非双端），故也不进 `shared/utils/`。落在 `server/utils/`，与 `server/utils/db.ts`、`server/utils/jwt.ts` 等服务端通用工具一致，调用方显式 import。

约束与行为：

- `scope: 'user' | 'system' | 'temp'`；`scope='user'` 时 `userId` 必填，否则抛错（内部不变量自卫）。
- 内部读 `useRuntimeConfig().storage.basePath`。`basePath` 为空字符串时不加前缀（保持未配置环境的现状，不破坏现有行为）。
- 仅供 Nitro 运行时（API handler / Service / 中间件 / Agent 工具）调用 —— 独立 tsx 脚本里 `useRuntimeConfig()` 不存在，迁移脚本不使用本函数（见 3.4）。
- 不把前缀逻辑埋进 `uploadFileService` 内部 —— 预签名流程需要在调用存储服务**之前**就拿到带前缀的完整路径用于写 `ossFiles` 行，埋进服务层会导致「数据库记录路径」与「实际上传 key」不一致。统一函数 + 各调用点显式调用是最稳的方案。

**15 处全部收敛到统一函数**：2.1 的 11 处补齐，2.2 的 4 处把内联代码替换为函数调用（行为不变）。

### 3.3 各上传点改造后的目标路径

| 场景 | 改造后路径 | scope |
|------|-----------|-------|
| 全局文书模板 | `{env}/system/document_template/...` | system |
| 用户文书模板 | `{env}/user{id}/document_template/...` | user |
| 文书草稿导出 | `{env}/user{id}/document_export/...` | user |
| 合同审查文档 ×4 | `{env}/user{id}/caseAnalysis/...` | user |
| Agent 云盘文件 | `{env}/user{id}/caseAnalysis/{sessionId}/...` | user |
| Agent 临时文件 | `{env}/temp/caseAnalysis/{sessionId}/...` | temp |
| MinerU 内嵌图 | `{env}/user{id}/doc_embedded_image/{taskId}/...` | user |
| ASR 原始 JSON | `{env}/user{id}/asr/{日期}/...` | user |
| 临时音频上传 | `{env}/temp/asr/{日期}/...` | temp |
| 云盘上传 / MinerU 结果图（现有正确） | 路径基本不变，仅改为走统一函数 | user |

补充说明：

- 合同审查文件目前归在 `FileSource.CASE_ANALYSIS`（即 `caseAnalysis/` 目录），沿用现状。若要独立的 `contract` 分类需新增 `FileSource` 枚举值 —— **不在本次范围**。
- ASR 原始 JSON 的 `ossFiles` 行当前未写 `source` 字段，本次顺带补上 `FileSource.ASR`，使其与目录约定一致。

### 3.4 历史迁移脚本（全环境）

新增维护脚本 `server/scripts/migrateOssBasePath.ts`，按环境各跑一次（用对应环境的 `.env` 连各环境数据库）。

**迁移范围**：`ossFiles` 表中所有未带前缀的行 —— `ossFiles` 是唯一记录「OSS key ↔ 所属环境」的数据源（该表按环境物理隔离在各环境的数据库里）。不写 `ossFiles` 记录的文件（如 temp 临时文件）没有环境归属信息、无法迁移，见 3.5。

迁移流程：

1. 查 `ossFiles` 中 `filePath` 非空、且**不以本环境 basePath 开头**的行；
2. 逐条检查源 object 是否存在（用脚本开头建好的 OSS client 调 `getObjectMeta`，不存在则跳过并记日志，同时读出对象大小）；
3. 在 OSS 内 copy 到 `${basePath}${filePath}`：通过 `server/lib/oss/client.ts` 的 `createOssClient(config)` 取底层 ali-oss client，调 `client.copy(目标key, 源key)`（同 bucket 服务端 copy，**参数目标在前、源在后**）；
4. 更新该行 `ossFiles.filePath` 为新路径；源对象**暂时保留**。

**脚本引导与配置获取（独立 tsx 运行约束）**：迁移脚本以 `npx tsx` 独立运行，**不在 Nitro 运行时内**，`useRuntimeConfig()` 不可用。因此：

- 环境前缀直接读 `process.env.NUXT_STORAGE_BASE_PATH`（未配置回落 `''`），**不**经 `buildStorageKey` —— 迁移只做「在旧路径前拼 `{basePath}`」的字符串操作，不重构目录。
- 脚本要触达 `server/lib/oss` 与存储配置 DAO（其内部链路依赖 `useRuntimeConfig()`），照现有脚本 `server/scripts/rebuildLawEmbeddings.ts` 的模式，在脚本开头从 `process.env` 构造并 mock `globalThis.useRuntimeConfig` 与 `globalThis.logger`。
- Prisma：脚本开头**显式**执行 `globalThis.prisma = prisma`（`prisma` 取自 `~~/server/utils/db` 单例），与 mock `useRuntimeConfig`/`logger` 并列。**不能只靠 `import` 副作用** —— `getDefaultStorageConfigDao` 所在的 `storageConfig.dao.ts` 引用的是全局 `prisma`（未显式 import），而 `db.ts` 仅在 `NODE_ENV !== 'production'` 时才把单例挂到 `globalThis`；迁移脚本要在含生产的全环境运行，必须自己挂全局（照 `server/scripts/rebuildLawEmbeddings.ts` 的引导模式）。
- OSS 配置经 `getDefaultStorageConfigDao` 取系统默认存储配置，`createOssClient` 在脚本开头建一次、全程复用，不逐行重建 client。

安全设计：

- `--dry-run`（默认）：只打印将要迁移的清单，不做任何写操作；
- `--execute`：实际执行复制 + 改库；
- `--delete-source`：**独立步骤**，仅删除「已确认复制成功且改库成功」的根目录旧对象。先复制验证、再改库、最后才删源，杜绝丢数据；
- 脚本幂等（已带前缀的行天然跳过）、分批处理、详细日志；
- 对单个 >1GB 的对象跳过并告警（阿里云 `CopyObject` 不支持超大对象，需 `multipartUploadCopy`）。本项目迁移对象均为 docx / JSON / 内嵌图等小文件，实际不触发，仅作防御；
- 生产环境按 `dry-run → execute → 人工验证 → delete-source` 的顺序操作。

**迁移只补前缀、不追改旧文件目录结构**。结果：迁移后 OSS 桶 `{env}/` 下会同时存在旧式目录（`global-templates/`、`contract-review/`、`mineru/`、`users/` 等）与新约定目录（`user{id}/`、`system/`、`temp/`）。两者共存 —— 每个文件都靠 `ossFiles.filePath` 自描述、访问完全正常，且**环境已隔离（本次要解决的核心问题已达成）**。新旧目录风格混杂仅是观感问题，不影响功能。

### 3.5 不在本次范围

- **`temp/` 临时文件的历史数据无法迁移**（非主动放弃，是技术上做不到）：Agent 配额不足降级的临时区文件、临时音频上传，按设计就**不写 `ossFiles` 记录**（`temp-upload.post.ts` 文件头注释明写「临时文件不创建 ossFiles 记录」；`uploadWorkspaceFile.tool.ts` 临时分支返回合成 id、不落库）。既无 `ossFiles` 记录，就没有任何数据能把这些根目录 `temp/` 文件归属到具体环境，无法按环境迁移。所幸这些文件本就短命（识别完成即删 / 靠 OSS 生命周期老化）。代码侧仍会修复，让**新**临时文件带 `{env}/` 前缀。
- 不给存储适配器新增通用 `copy` 方法 —— 仅迁移脚本需要，脚本内直接用 OSS client 即可，避免适配器层接口膨胀。
- 不为合同审查新增独立 `FileSource` 枚举值（沿用现状 `FileSource.CASE_ANALYSIS`）。

## 四、测试

- 为 `buildStorageKey` / `buildStorageDir` 编写单元测试：覆盖 user/system/temp 三种 scope、`basePath` 为空、带/不带 `subDir`、`scope='user'` 缺 `userId` 抛错等分支（`useRuntimeConfig` 按现有测试基建 `tests/server/_helpers/handler-test.ts` 的方式 mock）。
- 现有断言更新：`tests/server/assistant/document/documentTemplate.service.test.ts` 第 304-353 行断言 `global-templates/` 前缀，需改为期望带环境前缀（测试环境 `basePath=test/`，即 `test/system/document_template/...`）。
- 为修复后的关键上传点补充 / 修改路径断言，确认生成的 key 带 `{env}` 前缀。
- 迁移脚本：补 `--dry-run` 行为的单元测试（识别待迁移行、幂等跳过已带前缀行）。
- 按项目规范，每个模块代码完成后先跑相关单测，整个计划完成后再做全量测试。

## 五、验收标准

1. 15 处上传全部经由统一函数构造路径，11 处 BUG 点产出的 key 均带 `{env}` 前缀。
2. 统一函数及受影响测试全部通过；`npx nuxi typecheck` 无错误。
3. 迁移脚本在 dry-run 下能正确列出各环境待迁移文件；execute 后 `ossFiles.filePath` 与 OSS 实际对象一致、文件可正常下载。
4. 修复后新上传的文书模板落在 `{env}/system/document_template/` 或 `{env}/user{id}/document_template/`，不再进入 OSS 根目录。
