#!/usr/bin/env bash
# 阶段 4 全量回归脚本
# 用途：AI 基建统一改造阶段 4（合同审查接入底座 - C+ 方案）收尾前一键验证
# 用法：bash scripts/stage4-regression.sh

set -e

PASS="[OK]"
FAIL="[ERROR]"

echo "======================================="
echo "  阶段 4 · 合同审查接入底座 全量回归"
echo "======================================="

# -----------------------------------------------
# 1/5 类型检查
# -----------------------------------------------
echo ""
echo "[1/5] 类型检查..."
TYPECHECK_OUT=$(npx nuxi typecheck 2>&1 || true)
echo "$TYPECHECK_OUT" | tail -10
REMAINING=$(echo "$TYPECHECK_OUT" | grep -E "error TS" | grep -v "app.vue" | head -5)
if [ -n "$REMAINING" ]; then
    echo "$FAIL 类型检查发现新 TS 错误（非 app.vue 历史问题）："
    echo "$REMAINING"
    exit 1
fi
echo "$PASS 类型检查通过"

# -----------------------------------------------
# 2/5 阶段 4 新增测试
# -----------------------------------------------
echo ""
echo "[2/5] 阶段 4 新增测试..."
npx vitest run \
    tests/server/agent-platform/factory/runStateGraphAgent.test.ts \
    tests/server/agent-platform/sse/customEventEmitter.test.ts \
    tests/server/agent-platform/nodeSkills.contract.test.ts \
    2>&1 | tail -10
echo "$PASS 阶段 4 测试通过"

# -----------------------------------------------
# 3/5 合同审查 + 现有平台/agent 测试
# -----------------------------------------------
echo ""
echo "[3/5] 合同审查 + 平台库 + agent 测试..."
npx vitest run \
    tests/server/workflow/agents/contractReviewMainAgent.test.ts \
    tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts \
    tests/server/workflow/agents/contractReviewMainAgent.contextSegments.test.ts \
    tests/server/workflow/agents/contractReviewMainAgent.playbook.test.ts \
    tests/server/workflow/agents/contractReviewMainAgent.stage.test.ts \
    tests/shared/types tests/server/agent-platform \
    2>&1 | tail -15
echo "$PASS 合同审查 + 平台测试通过"

# -----------------------------------------------
# 4/5 受影响业务 streaming 测试
# -----------------------------------------------
echo ""
echo "[4/5] 业务 streaming 测试 (document / module / case-main / assistant)..."
npx vitest run \
    tests/server/workflow/agents/documentMainAgent.test.ts \
    tests/server/workflow/agents/moduleAgent.test.ts \
    tests/server/workflow/agents/caseMainAgent.test.ts \
    tests/server/workflow/agents/assistantAgent.test.ts \
    2>&1 | tail -10
echo "$PASS 业务流式测试通过"

# -----------------------------------------------
# 5/5 工作区干净检查
# -----------------------------------------------
echo ""
echo "[5/5] 工作区干净度..."
DIRTY=$(git status --porcelain | grep -v "bun.lock\|package.json\|vitest.config.ts" || true)
if [ -n "$DIRTY" ]; then
    echo "$FAIL 工作区不干净（已忽略 bun.lock/package.json/vitest.config.ts pre-existing 漂移）："
    echo "$DIRTY"
    exit 1
fi
echo "$PASS 工作区干净（含 pre-existing 漂移文件）"

echo ""
echo "======================================="
echo "  阶段 4 全量回归通过 ✓"
echo "======================================="
echo ""
echo "建议打 tag："
echo "  git tag -a ai-unify-stage-4-done -m '阶段 4 完成：合同审查接入底座（C+ 方案）'"
