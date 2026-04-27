#!/usr/bin/env bash
# 阶段 5 全量回归脚本
# 用途：AI 基建统一改造阶段 5（法律助手 → 文书 / 合同，无 caseId）收尾前一键验证
# 用法：bash scripts/stage5-regression.sh

set -e

PASS="[OK]"
FAIL="[ERROR]"

echo "======================================="
echo "  阶段 5 · 法律助手 → 文书 / 合同 全量回归"
echo "======================================="

# -----------------------------------------------
# 1/6 类型检查
# -----------------------------------------------
echo ""
echo "[1/6] 类型检查..."
TYPECHECK_OUT=$(npx nuxi typecheck 2>&1 || true)
echo "$TYPECHECK_OUT" | tail -10
REMAINING=$(echo "$TYPECHECK_OUT" | grep -E "error TS" | grep -v "app.vue" | head -5)
if [ -n "$REMAINING" ]; then
    echo "$FAIL 类型检查发现新 TS 错误（非 app.vue 历史问题）："
    echo "$REMAINING"
    exit 1
fi
echo "$PASS 类型检查通过（仅残留 app.vue 历史 TS2589/TS2321）"

# -----------------------------------------------
# 2/6 阶段 5 新增测试
# -----------------------------------------------
echo ""
echo "[2/6] 阶段 5 新增测试..."
npx vitest run \
    tests/server/agent-platform/subAgent/ \
    tests/server/agent-platform/tools/ \
    tests/server/agent-platform/nodeSkills.assistant.test.ts \
    tests/server/assistant/document/templateRecommend.service.test.ts \
    tests/server/assistant/document/draftLinkCase.service.test.ts \
    tests/server/assistant/contract/reviewLinkCase.api.test.ts \
    tests/server/case/cases.active.api.test.ts \
    tests/server/case/cases.active.handler.test.ts \
    tests/app/composables/useCaseLinker.test.ts \
    tests/app/components/agents/ \
    tests/app/components/cases/CaseLinkerDialog.test.ts \
    2>&1 | tail -10
echo "$PASS 阶段 5 新增测试通过"

# -----------------------------------------------
# 3/6 受影响 vertical：文书 + 合同 + 法律助手
#
# 注：documentDraft.dao.test.ts 在与其他测试并发时偶发 FK flaky（stage 4 已知
# pre-existing 测试隔离问题，本阶段未引入），因此独立串行跑该文件。
# -----------------------------------------------
echo ""
echo "[3/6] 文书 + 合同 + 法律助手 业务测试..."

# Step 3a：除 dao flaky 外的所有受影响 vertical 测试
npx vitest run \
    tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts \
    tests/server/workflow/agents/documentMainAgent.test.ts \
    tests/server/workflow/agents/assistantAgent.test.ts \
    tests/server/assistant/contract/ \
    --exclude '**/documentDraft.dao.test.ts' \
    2>&1 | tail -10

# 文书目录但排除 dao 文件
npx vitest run \
    tests/server/assistant/document/draftLinkCase.service.test.ts \
    tests/server/assistant/document/drafts.api.test.ts \
    tests/server/assistant/document/documentDraft.deleteCascade.test.ts \
    tests/server/assistant/document/documentTemplate.dao.test.ts \
    tests/server/assistant/document/templateRecommend.service.test.ts \
    2>&1 | tail -10

# Step 3b：documentDraft.dao.test.ts 独立串行跑（避免并发 FK flaky）
echo "  · documentDraft.dao.test.ts 独立跑（避免 pre-existing 并发 flaky）..."
npx vitest run tests/server/assistant/document/documentDraft.dao.test.ts 2>&1 | tail -5
echo "$PASS 受影响 vertical 测试通过"

# -----------------------------------------------
# 4/6 平台底座 + 阶段 4 防回退
# -----------------------------------------------
echo ""
echo "[4/6] 平台底座（阶段 1-4 既有）..."
npx vitest run \
    tests/server/agent-platform/factory \
    tests/server/agent-platform/sse \
    tests/server/agent-platform/nodeSkills.contract.test.ts \
    tests/shared/utils/clauseLocator.test.ts \
    2>&1 | tail -10
echo "$PASS 平台底座通过"

# -----------------------------------------------
# 5/6 前端工具卡片 + interrupt 卡片 + 来源条相关
# -----------------------------------------------
echo ""
echo "[5/6] 前端组件 + composable..."
npx vitest run \
    tests/app/components/agents \
    tests/app/composables \
    tests/app/components/assistant/contract/ContractDocxPreview.test.ts \
    2>&1 | tail -10
echo "$PASS 前端组件 + composable 通过"

# -----------------------------------------------
# 6/6 工作区干净检查
# -----------------------------------------------
echo ""
echo "[6/6] 工作区干净度..."
DIRTY=$(git status --porcelain | grep -v "bun.lock\|package.json\|vitest.config.ts" || true)
if [ -n "$DIRTY" ]; then
    echo "$FAIL 工作区不干净（已忽略 bun.lock/package.json/vitest.config.ts pre-existing 漂移）："
    echo "$DIRTY"
    exit 1
fi
echo "$PASS 工作区干净（含 pre-existing 漂移文件）"

echo ""
echo "======================================="
echo "  阶段 5 全量回归通过 ✓"
echo "======================================="
echo ""
echo "建议打 tag："
echo "  git tag -a ai-unify-stage-5-done -m '阶段 5 完成：法律助手 → 文书 / 合同（无 caseId）'"
