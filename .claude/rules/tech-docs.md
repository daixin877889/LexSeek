---
paths:
  - "server/services/workflow/**"
  - "server/services/case/**"
  - "server/services/material/**"
  - "server/services/agent/**"
  - "server/services/retrieval/**"
  - "server/services/legal/**"
  - "server/services/model/**"
  - "server/services/node/**"
  - "server/services/payment/**"
  - "server/services/membership/**"
  - "server/services/point/**"
  - "server/services/rbac/**"
  - "server/services/auth/**"
  - "server/services/users/**"
  - "server/services/sms/**"
  - "server/services/sse/**"
  - "server/services/storage/**"
  - "server/lib/payment/**"
  - "server/lib/storage/**"
  - "server/lib/oss/**"
  - "prisma/**"
---

# 技术文档参考

开发后端模块时，请先阅读对应的技术文档了解模块架构和已知陷阱：

| 源码路径 | 技术文档 |
|---------|---------|
| server/services/workflow/ | docs/tech-docs/backend/workflow.md |
| server/services/case/ | docs/tech-docs/backend/case.md |
| server/services/material/ | docs/tech-docs/backend/material.md |
| server/services/agent/, server/services/sse/ | docs/tech-docs/backend/agent.md |
| server/services/retrieval/ | docs/tech-docs/backend/retrieval.md |
| server/services/legal/ | docs/tech-docs/backend/legal.md |
| server/services/model/ | docs/tech-docs/backend/model.md |
| server/services/node/ | docs/tech-docs/backend/node.md |
| server/services/payment/, server/lib/payment/ | docs/tech-docs/backend/payment.md |
| server/services/membership/ | docs/tech-docs/backend/membership.md |
| server/services/point/ | docs/tech-docs/backend/point.md |
| server/services/rbac/ | docs/tech-docs/backend/rbac.md |
| server/services/auth/, users/, sms/ | docs/tech-docs/backend/auth-users-sms.md |
| server/lib/storage/, server/lib/oss/ | docs/tech-docs/patterns/adapter-factory.md |
| prisma/ | docs/tech-docs/infra/database.md + docs/tech-docs/architecture/data-model.md |

**通用参考**：
- 踩坑记录：docs/tech-docs/guides/pitfalls.md
- Service+DAO 模式：docs/tech-docs/patterns/service-dao.md
