# 实现计划

- [x] 1. 重构 useApi composable
  - [x] 1.1 更新 UseApiOptions 接口，移除 onSuccess 和 onError 回调选项
    - 修改 `app/composables/useApi.ts` 中的 UseApiOptions 接口定义
    - _需求: 4.1, 4.2_
  - [x] 1.2 重构 execute 方法，移除回调调用逻辑
    - 移除 execute 方法中的 onSuccess 和 onError 调用
    - 保留 showError 控制的 toast 提示逻辑
    - 确保 execute 返回 Promise<void>
    - _需求: 1.4, 2.1, 2.2, 2.3_
  - [x] 1.3 更新辅助函数 useApiPost、useApiGet、useApiPut、useApiDelete
    - 移除这些函数中对 onSuccess 和 onError 的类型引用
    - _需求: 4.1, 4.2_
  - [ ]* 1.4 编写属性测试：返回值结构完整性
    - **Property 1: 返回值结构完整性**
    - **验证: 需求 1.1, 3.1**
  - [ ]* 1.5 编写属性测试：成功请求数据填充
    - **Property 2: 成功请求数据填充**
    - **验证: 需求 1.2**
  - [ ]* 1.6 编写属性测试：失败请求错误填充
    - **Property 3: 失败请求错误填充**
    - **验证: 需求 1.3**

- [x] 2. 更新使用 useApi 的页面组件
  - [x] 2.1 重构 register.vue 中的 getVerificationCode 函数
    - 将回调方式改为 await 方式
    - 在 execute 后检查 error.value 处理错误
    - 在 execute 后检查成功状态处理成功逻辑
    - _需求: 1.1, 1.2, 1.3, 4.3_
  - [x] 2.2 检查并更新其他使用 useApi 的文件
    - 搜索项目中所有使用 onSuccess 或 onError 的地方
    - 按照新的 await 方式进行重构
    - _需求: 4.3_

- [x] 3. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。
