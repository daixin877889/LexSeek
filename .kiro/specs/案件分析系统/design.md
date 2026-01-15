# 设计文档

## 概述

本设计文档描述了 LexSeek 案件分析系统的技术架构和实现方案。

## 架构

### 目录结构

```
server/
├── api/v1/
│   ├── case/                  # 案件分析 API
│   └── recognition/           # 文档识别 API
│       ├── doc/               # 文档识别
│       └── mineru/            # MinerU 服务
├── services/
│   ├── case/                  # 案件服务
│   └── material/              # 材料服务
│       ├── materialEmbedding.service.ts
│       └── mineruToken.service.ts
app/
├── pages/dashboard/analysis/  # 案件分析页面
├── composables/
│   ├── useDocxRecognition.ts  # DOCX 识别
│   ├── useMineruRecognition.ts # MinerU 识别
│   ├── useLocalFileCache.ts   # 本地文件缓存
│   └── useFileReader.ts       # 文件读取
└── components/caseAnalysis/   # 案件分析组件
```

## 组件和接口

### 文档识别服务

```typescript
// 文档识别接口
interface DocumentRecognitionService {
  recognizeDocx(file: File): Promise<RecognitionResult>;
  recognizePdf(file: File): Promise<RecognitionResult>;
  recognizeImage(file: File): Promise<RecognitionResult>;
}
```

### MinerU 服务

```typescript
// MinerU 批量上传接口
interface MineruService {
  uploadBatch(files: File[]): Promise<BatchUploadResult>;
  getTaskStatus(taskId: string): Promise<TaskStatus>;
  getResult(taskId: string): Promise<RecognitionResult>;
}
```

## 实现状态

### 已完成

- 案件分析核心功能
- 本地文件识别
- 文件缓存机制

### 进行中

- DOCX 浏览器端识别
- MinerU 批量上传

### 相关文件

**服务层**:
- `server/services/case/*.ts`
- `server/services/material/*.ts`

**API 层**:
- `server/api/v1/case/*.ts`
- `server/api/v1/recognition/*.ts`

**前端**:
- `app/pages/dashboard/analysis/*.vue`
- `app/composables/useDocxRecognition.ts`
- `app/composables/useMineruRecognition.ts`
