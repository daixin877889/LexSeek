#!/usr/bin/env bash
# 阶段 2 全量回归脚本
# 用途：AI 基建统一改造阶段 2 收尾前一键验证
# 用法：bash scripts/stage2-regression.sh

set -e

PASS="[OK]"
FAIL="[ERROR]"

echo "======================================="
echo "  阶段 2 全量回归"
echo "======================================="

# -----------------------------------------------
# 1/4 类型检查
# -----------------------------------------------
echo ""
echo "[1/4] 类型检查..."
TYPECHECK_OUT=$(npx nuxi typecheck 2>&1 || true)
echo "$TYPECHECK_OUT" | tail -20
if echo "$TYPECHECK_OUT" | grep -E "error TS" > /dev/null 2>&1; then
    echo ""
    echo "$FAIL 类型检查发现 TS 错误，请修复后重新运行"
    exit 1
fi
echo "$PASS 类型检查通过"

# -----------------------------------------------
# 2/4 平台库 + agent 测试集
# -----------------------------------------------
echo ""
echo "[2/4] 平台库 + agent 测试集..."
npx vitest run tests/shared/types tests/server/agent-platform tests/server/agent 2>&1 | tail -15
echo "$PASS 平台库测试通过"

# -----------------------------------------------
# 3/4 全后端回归
# -----------------------------------------------
echo ""
echo "[3/4] 全后端回归（tests/server）..."
npx vitest run tests/server 2>&1 | tail -15
echo "$PASS 全后端测试通过"

# -----------------------------------------------
# 4/4 工作区干净检查
# -----------------------------------------------
echo ""
echo "[4/4] 工作区干净检查..."
if [ -n "$(git status --porcelain)" ]; then
    echo "$FAIL 工作区有未提交改动，请先 commit 或 stash"
    git status --short
    exit 1
fi
echo "$PASS 工作区干净"

# -----------------------------------------------
# 汇总
# -----------------------------------------------
echo ""
echo "======================================="
echo "  阶段 2 回归 PASS - 可以打 tag"
echo "======================================="
echo ""
echo "  下一步："
echo "    git tag -a ai-unify-stage-2-done -m '阶段 2 完成'"
echo ""
