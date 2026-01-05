# 实现计划：管理后台产品管理和营销管理

## 概述

本实现计划将产品管理和营销管理功能分解为可执行的编码任务，按照服务层 → API 层 → 前端页面的顺序实现。

## 任务列表

- [x] 1. 扩展类型定义和服务层
  - [x] 1.1 扩展营销活动类型定义
    - 在 `shared/types/campaign.ts` 中添加 `UpdateCampaignParams` 接口
    - 更新 `CampaignInfo` 接口，将 `endAt` 改为可选
    - _Requirements: 7.2, 8.2_

  - [x] 1.2 扩展产品服务层
    - 在 `server/services/product/product.service.ts` 中添加管理后台所需的服务方法
    - 实现 `getProductsForAdminService`、`createProductService`、`updateProductService`、`toggleProductStatusService`、`deleteProductService`
    - _Requirements: 1.1, 2.4, 3.2, 4.1, 5.2_

  - [x] 1.3 扩展营销活动服务层
    - 在 `server/services/campaign/campaign.service.ts` 中添加管理后台所需的服务方法
    - 实现 `getCampaignsForAdminService`、`createCampaignService`、`updateCampaignService`、`toggleCampaignStatusService`、`deleteCampaignService`
    - _Requirements: 6.1, 7.2, 8.2, 9.1, 10.2_

- [x] 2. 实现产品管理 API
  - [x] 2.1 实现产品列表 API
    - 创建 `server/api/v1/admin/products/index.get.ts`
    - 支持分页、类型筛选、状态筛选
    - _Requirements: 1.1, 1.4, 1.5, 1.6_

  - [x] 2.2 实现产品详情 API
    - 创建 `server/api/v1/admin/products/[id].get.ts`
    - _Requirements: 3.1_

  - [x] 2.3 实现产品创建 API
    - 创建 `server/api/v1/admin/products/index.post.ts`
    - 使用 zod 进行参数验证
    - _Requirements: 2.4, 2.5_

  - [x] 2.4 实现产品更新 API
    - 创建 `server/api/v1/admin/products/[id].put.ts`
    - _Requirements: 3.2_

  - [x] 2.5 实现产品状态切换 API
    - 创建 `server/api/v1/admin/products/[id]/status.patch.ts`
    - _Requirements: 4.1_

  - [x] 2.6 实现产品删除 API
    - 创建 `server/api/v1/admin/products/[id].delete.ts`
    - _Requirements: 5.2_

- [x] 3. 实现营销活动管理 API
  - [x] 3.1 实现营销活动列表 API
    - 创建 `server/api/v1/admin/campaigns/index.get.ts`
    - 支持分页、类型筛选、状态筛选
    - _Requirements: 6.1, 6.4, 6.5, 6.6_

  - [x] 3.2 实现营销活动详情 API
    - 创建 `server/api/v1/admin/campaigns/[id].get.ts`
    - _Requirements: 8.1_

  - [x] 3.3 实现营销活动创建 API
    - 创建 `server/api/v1/admin/campaigns/index.post.ts`
    - 使用 zod 进行参数验证，包括时间验证
    - _Requirements: 7.2, 7.3, 7.4_

  - [x] 3.4 实现营销活动更新 API
    - 创建 `server/api/v1/admin/campaigns/[id].put.ts`
    - _Requirements: 8.2_

  - [x] 3.5 实现营销活动状态切换 API
    - 创建 `server/api/v1/admin/campaigns/[id]/status.patch.ts`
    - _Requirements: 9.1_

  - [x] 3.6 实现营销活动删除 API
    - 创建 `server/api/v1/admin/campaigns/[id].delete.ts`
    - _Requirements: 10.2_

- [x] 4. Checkpoint - 确保 API 层测试通过
  - 所有 API 接口已实现并正常工作

- [x] 5. 实现产品管理前端页面
  - [x] 5.1 创建产品管理列表页面
    - 创建 `app/pages/admin/products/index.vue`
    - 实现产品列表展示、分页、筛选功能
    - 实现创建/编辑对话框
    - 实现状态切换和删除功能
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3_

- [x] 6. 实现营销活动管理前端页面
  - [x] 6.1 创建营销活动管理列表页面
    - 创建 `app/pages/admin/campaigns/index.vue`
    - 实现营销活动列表展示、分页、筛选功能
    - 实现创建/编辑对话框
    - 实现状态切换和删除功能
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3_

- [x] 7. 更新管理后台导航
  - [x] 7.1 更新导航组件
    - 修改 `app/components/admin/NavMain.vue`
    - 添加产品管理和营销管理的导航入口
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 8. Checkpoint - 确保前端页面正常工作
  - 产品管理和营销活动管理页面已实现

- [x] 9. 编写属性测试
  - [x] 9.1 编写产品管理属性测试
    - 创建 `tests/server/product/product.admin.service.test.ts`
    - **Property 1: 产品筛选结果一致性**
    - **Property 2: 产品 CRUD 往返一致性**
    - **Property 3: 产品状态切换幂等性**
    - **Property 8: 分页数据完整性（产品）**
    - **Validates: Requirements 1.4, 1.5, 1.6, 2.4, 3.2, 4.1, 5.2**

  - [x] 9.2 编写营销活动管理属性测试
    - 创建 `tests/server/membership/campaign.admin.service.test.ts`
    - **Property 4: 营销活动筛选结果一致性**
    - **Property 5: 营销活动 CRUD 往返一致性**
    - **Property 6: 营销活动时间验证**
    - **Property 7: 营销活动状态切换幂等性**
    - **Property 8: 分页数据完整性（营销活动）**
    - **Validates: Requirements 6.4, 6.5, 6.6, 7.2, 7.4, 8.2, 9.1, 10.2**

- [x] 10. Final Checkpoint - 确保所有测试通过
  - 产品管理测试：15 个测试全部通过
  - 营销活动管理测试：15 个测试全部通过

## 备注

- 每个任务都引用了具体的需求以便追溯
- Checkpoint 任务用于确保增量验证
- 属性测试验证通用的正确性属性
