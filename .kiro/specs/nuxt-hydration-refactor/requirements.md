# 需求文档

## 简介

解决 `app/app.vue` 中的 Nuxt 水合（Hydration）状态不匹配问题。当前实现在 `<script setup>` 顶层直接调用异步操作，导致服务端渲染（SSR）和客户端水合时状态不一致。

## 术语表

- **Hydration（水合）**: Nuxt/Vue SSR 中，客户端接管服务端渲染的 HTML 并使其具有交互性的过程
- **SSR（服务端渲染）**: 在服务器上生成 HTML 内容的技术
- **Auth_Store**: 管理用户认证状态的 Pinia store
- **User_Store**: 管理用户信息的 Pinia store
- **Role_Store**: 管理用户角色和权限路由的 Pinia store

## 需求

### 需求 1：认证状态初始化

**用户故事：** 作为用户，我希望应用在加载时能正确初始化认证状态，以便我能无缝访问已登录的功能。

#### 验收标准

1. WHEN 应用启动时，THE Auth_Store SHALL 从 cookie 中读取认证状态
2. THE Auth_Store SHALL 确保服务端和客户端的认证状态一致
3. IF 认证状态初始化失败，THEN THE Auth_Store SHALL 将用户视为未登录状态

### 需求 2：用户信息获取

**用户故事：** 作为已登录用户，我希望应用能正确获取我的用户信息，以便显示个性化内容。

#### 验收标准

1. WHEN 用户已认证且页面首次加载，THE User_Store SHALL 在服务端预取用户信息
2. WHEN 用户登录状态变化，THE User_Store SHALL 在客户端重新获取用户信息
3. IF 获取用户信息失败，THEN THE User_Store SHALL 保持空状态并记录错误

### 需求 3：角色信息获取

**用户故事：** 作为已登录用户，我希望应用能正确获取我的角色信息，以便显示对应的功能菜单。

#### 验收标准

1. WHEN 用户已认证且页面首次加载，THE Role_Store SHALL 在服务端预取角色列表
2. WHEN 当前角色变化，THE Role_Store SHALL 获取对应的权限路由
3. WHEN 用户登录状态变化，THE Role_Store SHALL 在客户端重新获取角色信息
4. IF 获取角色信息失败，THEN THE Role_Store SHALL 保持空列表并记录错误

### 需求 4：水合状态一致性

**用户故事：** 作为用户，我希望页面加载时不会出现闪烁或状态不一致的问题。

#### 验收标准

1. THE App_Component SHALL 使用 useAsyncData 或 callOnce 确保 SSR 数据正确传递到客户端
2. THE App_Component SHALL 确保 SSR 预取的数据在客户端水合时保持一致
3. WHILE 数据加载中，THE App_Component SHALL 保持 UI 稳定不闪烁

### 需求 5：错误处理

**用户故事：** 作为用户，我希望在数据加载失败时应用能优雅处理，不影响基本使用。

#### 验收标准

1. IF 用户信息获取失败，THEN THE App_Component SHALL 继续正常运行
2. IF 角色信息获取失败，THEN THE App_Component SHALL 继续正常运行
3. WHEN 发生错误时，THE App_Component SHALL 记录错误日志以便调试
