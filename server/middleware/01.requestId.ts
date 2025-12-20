// 鉴权中间件
export default defineEventHandler(async (event) => {
    event.context.requestId = uuidv7()
})