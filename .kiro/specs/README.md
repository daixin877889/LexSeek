# LexSeek Specs 索引

本目录包含 LexSeek 项目的所有功能规格文档，按功能模块分类组织。

## 模块列表

| 模块 | 描述 | 状态 |
|------|------|------|
| [会员系统](./会员系统/) | 会员级别、权益、升级等功能 | ✅ 已完成 |
| [积分系统](./积分系统/) | 积分获取、消耗、查询等功能 | ✅ 已完成 |
| [支付订单系统](./支付订单系统/) | 商品、订单、支付等功能 | ✅ 已完成 |
| [营销活动管理](./营销活动管理/) | 营销活动、兑换码等功能 | ✅ 已完成 |
| [法律知识库](./法律知识库/) | 法律内容管理、搜索、嵌入等功能 | ✅ 已完成 |
| [案件分析系统](./案件分析系统/) | 案件分析、文档识别等功能 | 🔄 部分进行中 |
| [文件存储系统](./文件存储系统/) | 文件上传、存储、加密等功能 | ✅ 已完成 |
| [权限管理系统](./权限管理系统/) | RBAC、菜单、路由权限等功能 | ✅ 已完成 |
| [模型管理](./模型管理/) | AI 模型管理功能 | ✅ 已完成 |
| [认证系统](./认证系统/) | 用户注册、登录、密码管理等功能 | ✅ 已完成 |
| [前端基础设施](./前端基础设施/) | 水合修复、代码优化等 | ✅ 已完成 |
| [后端基础设施](./后端基础设施/) | 日志、时区、类型定义、服务层等 | ✅ 已完成 |
| [测试体系](./测试体系/) | 单元测试、集成测试、属性测试等 | ✅ 已完成 |

## 状态说明

- ✅ 已完成 - 所有需求已实现并通过测试
- 🔄 进行中 - 部分功能正在开发中
- ⏳ 待开始 - 已规划但未开始

## 文档结构

每个模块目录包含以下文件：

- `requirements.md` - 需求文档，定义用户故事和验收标准
- `design.md` - 设计文档，描述技术架构和实现方案
- `tasks.md` - 任务清单，列出实现任务和状态

## 整合说明

本目录结构由原始的 50 个独立 spec 整合而来，按功能模块重新组织：

### 会员积分相关
- membership-system → 会员系统
- point-system → 积分系统
- membership-benefits → 会员系统
- membership-upgrade-calculation → 会员系统
- membership-upgrade-settlement → 会员系统
- membership-payment-fixes → 支付订单系统
- gift-points-effective-date-fix → 积分系统
- unified-point-service → 积分系统

### 支付营销相关
- pricing-purchase → 支付订单系统
- wechat-jsapi-payment → 支付订单系统
- admin-redemption-codes → 营销活动管理
- admin-product-campaign-management → 营销活动管理

### 法律知识相关
- legal-knowledge-base → 法律知识库
- legal-search → 法律知识库
- legal-detail-page → 法律知识库
- legal-content-split-editor → 法律知识库
- legal-article-hierarchy-sorting → 法律知识库
- legal-management-url-state → 法律知识库
- embedding-metadata-migration → 法律知识库
- batch-embed-fix → 法律知识库
- markdown-frontmatter-preserve → 法律知识库

### 案件分析相关
- case-analysis → 案件分析系统
- docx-browser-recognition → 案件分析系统
- mineru-batch-upload → 案件分析系统
- local-file-recognition → 案件分析系统

### 文件存储相关
- ali-oss-library → 文件存储系统
- storage-adapter → 文件存储系统
- client-side-encryption → 文件存储系统
- file-uploader-refactor → 文件存储系统
- custom-file-list-display → 文件存储系统

### 权限管理相关
- admin-rbac-menu → 权限管理系统
- rbac-enhancement → 权限管理系统
- route-permission-edit → 权限管理系统

### 其他
- model-management → 模型管理
- auth-api-refactor → 认证系统
- dashboard-hydration-fix → 前端基础设施
- nuxt-hydration-refactor → 前端基础设施
- useapi-async-refactor → 前端基础设施
- code-deduplication → 前端基础设施
- universal-logger → 后端基础设施
- server-logger-requestid → 后端基础设施
- timezone-fix → 后端基础设施
- type-definition-refactor → 后端基础设施
- service-layer-refactoring → 后端基础设施
- services-refactor → 后端基础设施
- api-integration-tests → 测试体系
- server-test-coverage → 测试体系
- test-coverage-improvement → 测试体系
- test-refactoring → 测试体系
