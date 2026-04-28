---
paths:
  - "app/components/**"
  - "app/pages/**"
  - "app/composables/**"
  - "app/store/**"
  - "app/layouts/**"
---

# 前端技术文档参考

开发前端模块时，请先阅读对应的技术文档：

| 源码路径 | 技术文档 |
|---------|---------|
| `app/pages/`、`app/layouts/` | `docs/tech-docs/frontend/overview.md` |
| `app/components/` | `docs/tech-docs/frontend/components.md` |
| `app/composables/` | `docs/tech-docs/frontend/composables.md` |
| `app/store/` | `docs/tech-docs/frontend/stores.md` |
| `app/components/case*`、`app/components/initAnalysis/`、`app/components/caseDetail/` | `docs/tech-docs/frontend/case-analysis-ui.md` |
| `app/pages/admin/`、`app/components/admin/` | 暂无独立文档；参考 `app/components/admin/Breadcrumb.vue` + `NavMain.vue` 的统一风格，每个 admin 子页一律照抄已有 CRUD 页面（`models/` / `nodes/` / `prompts/` / `orders/` / `payments/`）的列表 / 详情 / 编辑结构 |
| `app/components/agents/`、`app/components/assistant/` | 阅读 `composables/agents/` 与 `composables/useStreamChat.ts` 源码；后端对应 `server/services/agent-platform/` |

**通用参考**：
- 数据请求规范：`.claude/rules/fetch.md`
- 确认 / 警告对话框：`useAlertDialogStore`（`app/store/alertDialog.ts`），禁用浏览器原生 `confirm/alert/prompt`
- 图标：一律用 `lucide-vue-next` SVG 组件，**禁止 emoji**
