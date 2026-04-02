#!/bin/bash
set -euo pipefail

# ============================================================
# LexSeek Docker 多架构构建 & 推送脚本
# 用法: ./scripts/build.sh [--no-cache] [--skip-push] [--tag <tag>]
#       ./scripts/build.sh --platform linux/amd64   # 仅构建 x86
#       ./scripts/build.sh --platform linux/arm64   # 仅构建 ARM
# ============================================================

# 阿里云容器镜像仓库配置
REGISTRY="crpi-r7d4r9dxxbzsk4ir.cn-hangzhou.personal.cr.aliyuncs.com"
NAMESPACE="lexseek"
IMAGE_NAME="lexseek"
USERNAME="daixin@1857010335484493"

# 默认配置
GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
TAG="${GIT_HASH}"
NO_CACHE=""
SKIP_PUSH=false
# PLATFORMS="linux/amd64,linux/arm64"
PLATFORMS="linux/amd64"
BUILDER_NAME="lexseek-builder"

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --no-cache)  NO_CACHE="--no-cache"; shift ;;
        --skip-push) SKIP_PUSH=true; shift ;;
        --tag)       TAG="$2"; shift 2 ;;
        --platform)  PLATFORMS="$2"; shift 2 ;;
        *)           echo "未知参数: $1"; exit 1 ;;
    esac
done

FULL_IMAGE="${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}"

echo "=========================================="
echo "  LexSeek Docker 多架构构建 & 推送"
echo "=========================================="
echo "  镜像:   ${FULL_IMAGE}"
echo "  标签:   ${TAG}, latest"
echo "  架构:   ${PLATFORMS}"
echo "  缓存:   ${NO_CACHE:-启用}"
echo "=========================================="

# 1. 登录仓库（多架构构建需要先登录，因为 buildx 直接推送）
if [ "$SKIP_PUSH" = false ]; then
    echo ""
    echo "[1/3] 登录容器镜像仓库..."

    if [ -z "${DOCKER_REGISTRY_PASSWORD:-}" ]; then
        echo "请输入仓库密码（或设置环境变量 DOCKER_REGISTRY_PASSWORD）:"
        read -s DOCKER_REGISTRY_PASSWORD
    fi

    echo "${DOCKER_REGISTRY_PASSWORD}" | docker login \
        --username="${USERNAME}" \
        --password-stdin \
        "${REGISTRY}"

    echo "✓ 登录成功"
fi

# 2. 确保 buildx builder 存在
echo ""
echo "[2/3] 准备多架构构建环境..."

if ! docker buildx inspect "${BUILDER_NAME}" &>/dev/null; then
    echo "创建 buildx builder: ${BUILDER_NAME}"
    docker buildx create --name "${BUILDER_NAME}" --use --bootstrap
else
    docker buildx use "${BUILDER_NAME}"
fi

echo "✓ 构建环境就绪"

# 3. 构建并推送
echo ""
echo "[3/3] 构建多架构镜像 (${PLATFORMS})..."

BUILD_ARGS=(
    buildx build
    --platform "${PLATFORMS}"
    ${NO_CACHE}
    -t "${FULL_IMAGE}:${TAG}"
    -t "${FULL_IMAGE}:latest"
)

if [ "$SKIP_PUSH" = true ]; then
    # 仅构建不推送，加载到本地（仅单架构时可用）
    if [[ "${PLATFORMS}" == *","* ]]; then
        echo "注意: 多架构仅构建模式不会加载到本地 Docker"
        BUILD_ARGS+=(--output "type=image,push=false")
    else
        BUILD_ARGS+=(--load)
    fi
else
    BUILD_ARGS+=(--push)
fi

BUILD_ARGS+=(.)

docker "${BUILD_ARGS[@]}"

echo ""
echo "=========================================="
if [ "$SKIP_PUSH" = true ]; then
    echo "  构建完成（未推送）"
else
    echo "  构建并推送完成"
fi
echo "  ${FULL_IMAGE}:${TAG}"
echo "  ${FULL_IMAGE}:latest"
echo "  架构: ${PLATFORMS}"
echo "=========================================="
