# LexSeek 开发规范索引

> 注意：所有规范文件通过 `.claude/rules/` 自动加载（带 paths 限定），无需手动引用。

## 通用规范（所有文件触发）

- **commands.md** - 开发、测试、Prisma 命令
- **architecture.md** - 目录结构和技术栈
- **main.md** - 语言要求、TDD 模式、框架约定、自动导入
- **git.md** - Git 提交规范
- **types.md** - shared/types 组织、导入规范
- **database.md** - 数据库迁移强制规则（schema + migrate dev + 禁止手工改 migrations）

## 范围限定规范

| 规范 | 触发路径 |
|------|---------|
| api.md | server/** |
| ui.md | app/components/**, app/**/*.vue |
| testing.md | tests/** |
| fetch.md | app/** |
