# 设计文档

## 概述

本设计文档描述了 LexSeek 法律知识库系统的技术架构和实现方案。

## 架构

### 目录结构

```
server/
├── api/v1/legal/              # 法律内容 API
├── services/legal/            # 法律服务
│   ├── legal.dao.ts
│   ├── legal.service.ts
│   ├── legalArticle.dao.ts
│   └── embedding.service.ts
app/pages/
├── dashboard/legal/           # 用户端法律页面
└── admin/legal-main/          # 后台法律管理页面
```

## 数据模型

### 法律文档表 (legalDocuments)

```prisma
model legalDocuments {
    id          Int       @id @default(autoincrement())
    title       String    @db.VarChar(255)
    category    String    @db.VarChar(50)
    content     String    @db.Text
    status      Int       @default(1)
    
    articles legalArticles[]
    
    @@map("legal_documents")
}
```

### 法律条文表 (legalArticles)

```prisma
model legalArticles {
    id          Int       @id @default(autoincrement())
    documentId  Int       @map("document_id")
    title       String    @db.VarChar(255)
    content     String    @db.Text
    sortOrder   Int       @default(0) @map("sort_order")
    parentId    Int?      @map("parent_id")
    
    document legalDocuments @relation(fields: [documentId], references: [id])
    
    @@map("legal_articles")
}
```

## 正确性属性

### Property 1: 条文层级排序

*For any* 法律条文列表，SHALL 按 sortOrder 正确排序并保持层级结构。

### Property 2: Frontmatter 保留

*For any* Markdown 内容编辑，Frontmatter 元数据 SHALL 被正确保留。

### Property 3: 嵌入向量一致性

*For any* 法律内容更新，嵌入向量 SHALL 同步更新。

## 实现状态

所有组件已完成实现和测试。

### 相关文件

**服务层**:
- `server/services/legal/*.ts`

**API 层**:
- `server/api/v1/legal/*.ts`

**前端**:
- `app/pages/dashboard/legal/*.vue`
- `app/pages/admin/legal-main/*.vue`
