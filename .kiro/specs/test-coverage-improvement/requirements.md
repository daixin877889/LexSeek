# 测试覆盖率提升需求文档

## 概述

本 spec 记录了项目测试覆盖率提升的需求和完成状态。目标是将整个项目的测试覆盖率提升到接近 100%。

## 用户故事

### US-1: 服务端测试覆盖率提升
**作为** 开发者
**我希望** 服务端代码有完整的测试覆盖
**以便** 确保后端逻辑的正确性和稳定性

**验收标准:**
- [x] AC-1.1: `server/lib/oss` 模块覆盖率 > 95%
- [x] AC-1.2: `server/lib/storage` 模块覆盖率 > 95%
- [x] AC-1.3: `server/lib/payment` 模块覆盖率 = 100%
- [x] AC-1.4: `server/utils/password.ts` 覆盖率 = 100%
- [x] AC-1.5: `server/utils/jwt.ts` 覆盖率 > 80%
- [x] AC-1.6: 整体服务端覆盖率 > 95%

### US-2: 客户端测试覆盖率提升
**作为** 开发者
**我希望** 客户端代码有完整的测试覆盖
**以便** 确保前端逻辑的正确性和用户体验

**验收标准:**
- [x] AC-2.1: `app/utils/file.ts` 工具函数测试完成（72 个测试）
  - `getFileIcon` 图标获取（11 个测试）
  - `getFileIconBg` 背景色获取（8 个测试）
  - `getFileIconColor` 颜色获取（7 个测试）
  - `isImageType/isAudioType/isVideoType` 类型判断（21 个测试）
  - `canPreviewFile` 预览判断（5 个测试）
  - `isHeicFormat` HEIC 格式判断（8 个测试）
  - `convertHeicToJpeg` HEIC 转换（4 个测试）
  - 属性测试（8 个测试）
- [x] AC-2.2: `app/utils/auth.ts` 认证工具函数测试完成
- [x] AC-2.3: `app/utils/resetStore.ts` Store 重置工具测试完成
- [x] AC-2.4: `app/lib/utils.ts` cn 函数测试完成
- [x] AC-2.5: `store/alertDialog.ts` AlertDialog Store 测试完成

### US-3: Composables 测试覆盖
**作为** 开发者
**我希望** 所有 composables 有完整的测试覆盖
**以便** 确保可复用逻辑的正确性

**验收标准:**
- [x] AC-3.1: `useAgeCrypto` Age 加密核心功能测试完成
- [x] AC-3.2: `useApi` API 请求封装核心逻辑测试完成
- [x] AC-3.3: `useFileDecryption` 文件解密状态管理测试完成
- [x] AC-3.4: `useFileEncryption` 文件加密状态管理测试完成
- [x] AC-3.5: `useFileUploadWorker` 文件上传 Worker 测试完成
- [x] AC-3.6: `useUserNavigation` 用户导航逻辑测试完成

### US-4: 共享类型测试覆盖
**作为** 开发者
**我希望** 共享类型定义有测试验证
**以便** 确保类型定义的正确性和一致性

**验收标准:**
- [x] AC-4.1: 自定义错误类测试完成（encryption.test.ts）
- [x] AC-4.2: 枚举值正确性测试完成（enums.test.ts）
- [x] AC-4.3: 名称映射一致性测试完成（name-mappings.test.ts）

## 测试目录结构

```
tests/
├── server/           # 服务端测试
│   ├── membership/   # 会员系统（级别、用户会员、积分、兑换码、营销活动）
│   ├── storage/      # 存储系统（阿里云 OSS、签名、回调）
│   ├── payment/      # 支付系统（适配器、状态转换）
│   ├── crypto/       # 加密系统（元数据、解密）
│   └── utils/        # 工具函数（序列化、密码、JWT）
├── client/           # 客户端测试
│   ├── utils/        # 工具函数（file、auth、resetStore）
│   ├── composables/  # Composables（useApi、useAgeCrypto 等）
│   ├── store/        # Store（alertDialog）
│   └── lib/          # 库函数（utils）
└── shared/           # 共享类型测试
    └── types/        # 类型定义（encryption、enums、name-mappings）
```

## 测试运行命令

```bash
# 运行所有测试
bun run test

# 运行服务端测试
bun run test:server

# 运行客户端测试
bun run test:client

# 运行共享类型测试
bun run test:shared

# 运行特定模块测试
bun run test:membership
bun run test:storage
bun run test:payment
bun run test:crypto
bun run test:utils
```

## 当前状态

- **总测试文件**: 52 个
- **总测试用例**: 932+ 个
- **服务端覆盖率**: 97.19%
- **状态**: ✅ 已完成

## 技术规范

- 测试框架: vitest + fast-check
- 属性测试配置: `{ numRuns: 100 }`
- 日期生成器需过滤无效日期: `.filter(d => !isNaN(d.getTime()))`
- 字典键生成器需排除 JS 保留字: `['__proto__', 'constructor', 'prototype']`
- 使用 `vi.stubGlobal` 模拟 Nuxt 自动导入的全局变量
