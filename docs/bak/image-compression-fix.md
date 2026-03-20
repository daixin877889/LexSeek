# 图片识别大小限制修复

## 问题描述

当用户上传大尺寸图片（超过 10MB）进行 OCR 识别时，OpenAI API 会返回错误：

```
400 The request failed because the size of the input image (16 MB) exceeds the limit (10 MB)
```

当遇到不支持的图片格式（如损坏的数据或特殊格式）时，会返回错误：

```
Input buffer contains unsupported image format
```

## 根本原因

1. OpenAI Vision API 对输入图片有大小限制（10MB），但系统在调用 API 之前没有对图片进行压缩处理
2. Sharp 在处理某些特殊格式或损坏的图片数据时会失败

## 解决方案

### 1. 添加图片压缩工具

创建了 `server/utils/imageCompression.ts`，提供以下功能：

- **自动压缩**：当图片超过指定大小时自动压缩
- **智能缩放**：保持宽高比的同时限制最大尺寸
- **质量调整**：如果首次压缩不足，自动降低质量重试
- **格式支持**：支持 PNG、JPEG、WebP 等常见格式
- **格式转换**：遇到不支持的格式时，自动转换为 JPEG

### 2. 修改 OCR 服务

在 `server/services/material/ocr.service.ts` 的 `extractImageInfo` 函数中：

- 对 data URL 格式的图片进行压缩
- 对普通 URL 的图片先下载再压缩
- 压缩限制设置为 9MB（留有余量）

### 3. 压缩策略

```typescript
{
  maxSizeBytes: 9 * 1024 * 1024,  // 9MB（留1MB余量）
  maxWidth: 2048,                  // 最大宽度
  maxHeight: 2048,                 // 最大高度
  quality: 85                      // 初始质量
}
```

### 4. 格式转换策略

当遇到无法识别的图片格式时：
1. 尝试使用 Sharp 强制转换为 JPEG（质量 90）
2. 递归调用压缩函数处理转换后的 JPEG
3. 如果转换失败，抛出明确的错误信息

## 技术细节

### 使用的库

- **sharp**：高性能的 Node.js 图片处理库
  - 支持多种图片格式
  - 提供高质量的压缩算法
  - 性能优秀
  - 支持格式转换

### 压缩流程

1. 尝试读取图片元数据
2. 如果读取失败，尝试强制转换为 JPEG
3. 检查图片大小，如果小于限制则直接返回
4. 如果尺寸超过限制，按比例缩放
5. 根据原始格式选择输出格式（PNG/JPEG/WebP）
6. 应用压缩
7. 如果仍超限且质量 > 50，降低质量重试

### 质量保证

- 保持图片宽高比
- 不放大小图片
- 使用 mozjpeg 获得更好的 JPEG 压缩
- 递归降低质量直到满足大小要求
- 自动处理不支持的格式

## 测试覆盖

创建了完整的单元测试 `tests/server/utils/imageCompression.test.ts`：

- ✅ 压缩超过限制的大图片
- ✅ 保持小于限制的图片不变
- ✅ 正确处理不同格式（JPEG、PNG、WebP）
- ✅ 质量降低重试机制
- ✅ Base64 格式处理
- ✅ 自定义压缩选项
- ✅ 保持图片宽高比
- ✅ 处理损坏的图片数据并尝试转换

## 影响范围

### 修改的文件

1. `server/utils/imageCompression.ts` - 新增
2. `server/services/material/ocr.service.ts` - 修改
3. `tests/server/utils/imageCompression.test.ts` - 新增
4. `package.json` - 添加 sharp 依赖

### 受益场景

- 用户上传高分辨率截图
- 扫描的文档图片
- 手机拍摄的照片
- 任何超过 10MB 的图片
- HEIC/HEIF 等特殊格式（自动转换）
- 损坏或格式异常的图片数据

## 性能影响

- 压缩操作在服务端进行，不影响客户端性能
- sharp 库性能优秀，压缩速度快
- 只有超过限制的图片才会被压缩
- 压缩后的图片会被缓存，避免重复处理
- 格式转换只在必要时进行

## 后续优化建议

1. **客户端预压缩**：在上传前就在浏览器端压缩图片
2. **渐进式压缩**：使用二分法快速找到最佳质量参数
3. **格式转换**：对于 PNG 图片，可以考虑转换为 JPEG 以获得更好的压缩比
4. **缓存压缩结果**：避免对同一图片重复压缩

## 相关问题

- 修复了加密文件缓存问题（`useDocxRecognition.ts`）
- 确保缓存存储的是解密后的内容
- 添加了不支持格式的自动转换功能
