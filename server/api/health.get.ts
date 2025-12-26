/**
 * 健康检查 API
 * 用于 Docker 容器健康检查和负载均衡器探测
 */
export default defineEventHandler(() => {
    return {
        status: 'ok',
        timestamp: new Date().toISOString()
    }
})
