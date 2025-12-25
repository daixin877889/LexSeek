# 文件加密模块文档

本文档详细介绍项目中的端到端文件加密功能，包括加密原理、架构设计和使用方法。

## 文档目录

- [加密原理](./加密原理.md) - 加密算法、密钥管理和安全机制
- [API 参考](./API参考.md) - useAgeCrypto composable 的完整 API 文档
- [使用指南](./使用指南.md) - 如何在项目中使用加密功能
- [架构设计](./架构设计.md) - 模块架构和数据流

## 功能概述

本项目实现了基于 [age-encryption](https://github.com/FiloSottile/age) 的端到端文件加密功能：

- **客户端加密**：文件在用户设备上加密后再上传，服务器无法查看文件内容
- **非对称加密**：使用 X25519 密钥对，公钥加密、私钥解密
- **密码保护**：私钥使用用户密码加密存储，只有用户能解锁
- **会话持久化**：解锁状态保存在 IndexedDB，刷新页面无需重新输入密码
- **多用户隔离**：每个用户的私钥使用 `identity-user-{userId}` 格式独立存储，互不干扰
- **恢复密钥**：支持生成恢复密钥，用于忘记密码时重置

## 核心文件

```
app/
├── composables/
│   └── useAgeCrypto.ts      # 加密核心 composable
├── workers/
│   └── crypto.worker.ts     # Web Worker 执行加密/解密
├── store/
│   ├── encryption.ts        # 加密配置状态管理
│   └── auth.ts              # 认证状态（登出时清理加密状态）
├── components/
│   ├── encryption/
│   │   ├── SetupDialog.vue        # 首次设置对话框
│   │   ├── PasswordDialog.vue     # 密码验证对话框
│   │   ├── ChangePasswordDialog.vue # 修改密码对话框
│   │   └── RecoveryKeyDialog.vue  # 恢复密钥对话框
│   └── general/
│       └── fileUploader.vue # 支持加密的文件上传组件
└── pages/
    └── dashboard/
        └── settings/
            └── file-encryption.vue # 加密设置页面

server/
└── api/
    └── v1/
        └── encryption/
            ├── config.get.ts      # 获取加密配置
            ├── config.post.ts     # 保存加密配置
            ├── config.put.ts      # 更新加密配置
            ├── recovery.post.ts   # 使用恢复密钥重置密码
            └── recovery-key.get.ts # 获取恢复密钥加密的私钥

shared/
└── types/
    └── encryption.ts        # 类型定义和错误类
```

## 快速开始

```typescript
// 1. 获取 composable
const { 
  isUnlocked,
  generateKeyPair,
  encryptFile,
  decryptFile,
  unlockIdentity,
  lockIdentity 
} = useAgeCrypto()

// 2. 生成密钥对（首次设置）
const { identity, recipient } = await generateKeyPair()

// 3. 加密文件
const encryptedBlob = await encryptFile(file, recipient)

// 4. 解密文件（需要先解锁私钥）
await unlockIdentity(encryptedIdentity, password)
const decryptedBuffer = await decryptFile(encryptedBlob)
```

## 安全说明

⚠️ **重要提示**：

1. 加密密码无法找回，请妥善保管
2. 建议设置恢复密钥以防忘记密码
3. 丢失密码和恢复密钥将无法解密已加密的文件
4. 私钥仅存储在用户设备上，服务器只保存加密后的私钥
