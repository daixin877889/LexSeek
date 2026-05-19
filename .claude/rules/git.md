# Git 提交规范

## 提交格式

```
type(scope): subject

body (可选)
```

提交应使用 conventional commit 格式和中文提交信息。当涉及多个关注点时，将变更拆分为逻辑性的原子提交。

## Type 类型

| 类型 | 说明 |
|------|------|
| feat | 新功能 |
| fix | 缺陷修复 |
| refactor | 重构 |
| style | 代码格式 |
| perf | 性能优化 |
| test | 测试相关 |
| chore | 构建/工具/杂务 |
| docs | 文档更新 |

## Scope 作用域

- `ui` - UI组件
- `api` - API接口
- `auth` - 认证模块
- `db` - 数据库
- `theme` - 主题系统
- `purchase` - 购买流程
- `cases` - 案件模块
- `tools` - 工具页面
- `membership` - 会员系统
- `payment` - 支付系统
- `storage` - 存储服务
- `oss` - OSS文件存储
- `encryption` - 加密系统
- `rbac` - 权限系统
- `invitation` - 邀请系统
- `analysis` - 法律分析
- `contract` - 合同审查
- `observability` - 可观测性 / Langfuse / OTel
- `seo` - SEO 优化（meta / robots / sitemap / JSON-LD / 站长验证 / OG）
- `cache` - 缓存与失效广播

## 示例

```bash
git commit -m "feat(payment): 新增微信支付适配器"
git commit -m "fix(auth): 修复登录状态判断异常"
git commit -m "refactor(cases): 提取案件筛选逻辑到独立组件"
```

## 提交前检查

- [ ] 代码通过 lint 检查
- [ ] 提交信息符合规范
- [ ] 测试通过
- [ ] 不包含敏感信息
