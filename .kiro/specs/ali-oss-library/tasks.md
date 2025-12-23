# 实现计划：阿里云 OSS 通用库

## 概述

将阿里云 OSS 功能封装成一个通用的、可配置的库，支持客户端直传签名、服务端文件操作和私有文件 URL 签名。所有配置在调用时传入，不依赖环境变量。

## 任务

- [x] 1. 创建类型定义和配置验证
  - [x] 1.1 创建 OSS 库类型定义文件
    - 在 `shared/types/oss.ts` 中定义所有接口类型
    - 包含 OssConfig、PostSignatureOptions、CallbackConfig 等接口
    - 包含所有返回值类型定义
    - _需求: 10.1, 10.2, 10.3_

  - [x] 1.2 实现配置验证函数
    - 在 `shared/utils/oss/validator.ts` 中实现 validateConfig 函数
    - 验证必需字段：accessKeyId、accessKeySecret、bucket、region
    - 抛出包含缺少字段名的明确错误
    - _需求: 1.1, 1.2_

  - [ ]* 1.3 编写配置验证属性测试
    - **Property 1: 配置验证完整性**
    - **验证: 需求 1.1, 1.2**

- [x] 2. 实现核心客户端工厂
  - [x] 2.1 实现 OSS 客户端创建函数
    - 在 `shared/utils/oss/client.ts` 中实现 createOssClient 函数
    - 支持直接使用 AK/SK 创建客户端
    - 支持使用 STS 获取临时凭证创建客户端
    - _需求: 1.3, 1.4_

  - [x] 2.2 实现工具函数
    - 在 `shared/utils/oss/utils.ts` 中实现辅助函数
    - formatDateToUTC、getStandardRegion、getCredential 等
    - _需求: 2.1_

- [x] 3. 实现客户端直传签名功能
  - [x] 3.1 实现 generatePostSignature 函数
    - 在 `shared/utils/oss/postSignature.ts` 中实现
    - 生成 V4 签名所需的所有字段
    - 支持自定义过期时间、目录前缀
    - _需求: 2.1, 2.2, 2.3, 4.1, 4.3_

  - [ ]* 3.2 编写签名结果结构属性测试
    - **Property 2: 签名结果结构完整性**
    - **验证: 需求 2.1, 2.4**

  - [ ]* 3.3 编写签名过期时间属性测试
    - **Property 3: 签名过期时间一致性**
    - **验证: 需求 2.2**

  - [ ]* 3.4 编写目录前缀属性测试
    - **Property 6: 目录前缀传递正确性**
    - **验证: 需求 4.1**

- [x] 4. 实现回调配置功能
  - [x] 4.1 实现回调配置生成
    - 在 generatePostSignature 中添加回调配置支持
    - 生成 Base64 编码的回调配置
    - 支持自定义回调参数
    - _需求: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 4.2 编写回调配置属性测试
    - **Property 4: 回调配置编码正确性**
    - **Property 5: 无回调时结果不含 callback 字段**
    - **验证: 需求 3.1, 3.2, 3.3**

- [x] 5. 实现策略条件扩展
  - [x] 5.1 实现策略条件合并
    - 在 generatePostSignature 中添加条件支持
    - 支持 contentLengthRange、contentType 等条件
    - _需求: 5.1, 5.2, 5.3_

  - [ ]* 5.2 编写策略条件属性测试
    - **Property 7: 策略条件合并正确性**
    - **验证: 需求 5.1, 5.2, 5.3**

- [x] 6. 检查点 - 确保客户端直传功能测试通过
  - 确保所有测试通过，如有问题请询问用户

- [x] 7. 实现私有文件 URL 签名
  - [x] 7.1 实现 generateSignedUrl 函数
    - 在 `shared/utils/oss/signedUrl.ts` 中实现
    - 生成带签名的私有文件访问 URL
    - 支持自定义过期时间和响应头
    - _需求: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 7.2 编写签名 URL 属性测试
    - **Property 8: 签名 URL 结构正确性**
    - **Property 9: 签名 URL 过期时间正确性**
    - **验证: 需求 6.1, 6.2, 6.4**

- [x] 8. 实现服务端文件上传
  - [x] 8.1 实现 uploadFile 函数
    - 在 `shared/utils/oss/upload.ts` 中实现
    - 支持 Buffer 和 Readable 流上传
    - 支持自定义元数据和存储类型
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 8.2 编写上传结果属性测试
    - **Property 10: 上传结果结构正确性**
    - **验证: 需求 7.3**

- [x] 9. 实现服务端文件下载
  - [x] 9.1 实现 downloadFile 和 downloadFileStream 函数
    - 在 `shared/utils/oss/download.ts` 中实现
    - downloadFile 返回 Buffer
    - downloadFileStream 返回 Readable 流
    - 支持范围下载
    - _需求: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 9.2 编写下载返回类型属性测试
    - **Property 11: 下载返回类型正确性**
    - **验证: 需求 8.1, 8.2**

- [x] 10. 实现服务端文件删除
  - [x] 10.1 实现 deleteFile 函数
    - 在 `shared/utils/oss/delete.ts` 中实现
    - 支持单个文件和批量删除
    - 删除不存在的文件不抛出错误
    - _需求: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 10.2 编写删除结果属性测试
    - **Property 12: 删除结果结构正确性**
    - **验证: 需求 9.3, 9.4**

- [x] 11. 创建统一导出和错误类型
  - [x] 11.1 创建错误类型定义
    - 在 `shared/utils/oss/errors.ts` 中定义错误类
    - OssConfigError、OssStsError、OssNotFoundError 等
    - _需求: 1.2, 7.4, 8.3_

  - [x] 11.2 创建统一导出文件
    - 在 `shared/utils/oss/index.ts` 中统一导出所有函数和类型
    - _需求: 10.1, 10.2_

- [x] 12. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加快 MVP 开发
- 每个任务都引用了具体的需求以便追溯
- 检查点用于确保增量验证
- 属性测试验证通用正确性属性
- 单元测试验证特定示例和边界情况
