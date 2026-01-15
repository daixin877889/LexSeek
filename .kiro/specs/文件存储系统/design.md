# 设计文档

## 概述

本设计文档描述了 LexSeek 文件存储系统的技术架构和实现方案。

## 架构

### 目录结构

```
server/
├── api/v1/oss/                # OSS 相关 API
├── lib/
│   ├── oss/                   # OSS 库
│   └── storage/               # 存储适配器
├── services/
│   ├── files/                 # 文件服务
│   ├── storage/               # 存储服务
│   └── encryption/            # 加密服务
app/
├── composables/
│   └── useOssImageRenderer.ts # OSS 图片渲染
└── components/
    └── FileUploader.vue       # 文件上传组件
```

## 组件和接口

### 存储适配器接口

```typescript
interface StorageAdapter {
  upload(file: File, path: string): Promise<UploadResult>;
  download(path: string): Promise<Blob>;
  delete(path: string): Promise<void>;
  getSignedUrl(path: string): Promise<string>;
}
```

### 加密服务接口

```typescript
interface EncryptionService {
  encrypt(data: ArrayBuffer, key: string): Promise<ArrayBuffer>;
  decrypt(data: ArrayBuffer, key: string): Promise<ArrayBuffer>;
}
```

## 数据模型

### 文件表 (ossFiles)

```prisma
model ossFiles {
    id          Int       @id @default(autoincrement())
    userId      Int       @map("user_id")
    fileName    String    @map("file_name")
    fileSize    BigInt    @map("file_size")
    mimeType    String    @map("mime_type")
    ossKey      String    @map("oss_key")
    encrypted   Boolean   @default(false)
    
    @@map("oss_files")
}
```

## 实现状态

所有组件已完成实现和测试。

### 相关文件

**服务层**:
- `server/services/files/*.ts`
- `server/services/storage/*.ts`
- `server/services/encryption/*.ts`

**库**:
- `server/lib/oss/*.ts`
- `server/lib/storage/*.ts`

**API 层**:
- `server/api/v1/oss/*.ts`
