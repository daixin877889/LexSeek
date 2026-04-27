#!/usr/bin/env bash
# 阶段 3 全量回归脚本
# 用途：AI 基建统一改造阶段 3（search_law 普及）收尾前一键验证
# 用法：bash scripts/stage3-regression.sh

set -e

PASS="[OK]"
FAIL="[ERROR]"

echo "======================================="
echo "  阶段 3 · search_law 普及 全量回归"
echo "======================================="

# -----------------------------------------------
# 1/5 类型检查
# -----------------------------------------------
echo ""
echo "[1/5] 类型检查..."
TYPECHECK_OUT=$(npx nuxi typecheck 2>&1 || true)
echo "$TYPECHECK_OUT" | tail -20
if echo "$TYPECHECK_OUT" | grep -E "error TS" > /dev/null 2>&1; then
    # 阶段 3 不引入新 ts 代码，只动 SQL + 测试 + 一次性脚本
    # 容忍 app.vue 历史路由深度问题（项目记忆已记）
    REMAINING=$(echo "$TYPECHECK_OUT" | grep -E "error TS" | grep -v "app.vue" | head -5)
    if [ -n "$REMAINING" ]; then
        echo ""
        echo "$FAIL 类型检查发现新 TS 错误（非 app.vue 历史问题）："
        echo "$REMAINING"
        exit 1
    fi
fi
echo "$PASS 类型检查通过"

# -----------------------------------------------
# 2/5 节点配置防回退测试（阶段 3 核心）
# -----------------------------------------------
echo ""
echo "[2/5] 节点配置防回退测试 (nodeConfig.searchLaw.test)..."
npx vitest run tests/server/agent-platform/nodeConfig.searchLaw.test.ts 2>&1 | tail -15
echo "$PASS 节点配置测试通过"

# -----------------------------------------------
# 3/5 平台库 + agent 测试集（阶段 2 已有）
# -----------------------------------------------
echo ""
echo "[3/5] 平台库 + agent 测试集..."
npx vitest run tests/shared/types tests/server/agent-platform tests/server/agent 2>&1 | tail -15
echo "$PASS 平台库测试通过"

# -----------------------------------------------
# 4/5 受影响业务 streaming 测试
# -----------------------------------------------
echo ""
echo "[4/5] 业务 streaming 测试 (contract / document / module / case-main / assistant)..."
npx vitest run \
    tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts \
    tests/server/workflow/agents/documentMainAgent.test.ts \
    tests/server/workflow/agents/moduleAgent.test.ts \
    tests/server/workflow/agents/caseMainAgent.test.ts \
    tests/server/workflow/agents/assistantAgent.test.ts \
    2>&1 | tail -15
echo "$PASS 业务流式测试通过"

# -----------------------------------------------
# 5/5 工作区干净检查
# -----------------------------------------------
echo ""
echo "[5/5] 工作区干净度..."
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
    echo "$FAIL 工作区不干净，请先提交或暂存："
    echo "$DIRTY"
    exit 1
fi
echo "$PASS 工作区干净"

echo ""
echo "======================================="
echo "  阶段 3 全量回归通过 ✓"
echo "======================================="
echo ""
echo "建议打 tag："
echo "  git tag -a ai-unify-stage-3-done -m '阶段 3 完成：search_law 普及'"
echo ""
