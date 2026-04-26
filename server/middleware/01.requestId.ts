import { uuidv7 } from '#shared/utils/uuid'
// 鉴权中间件
export default defineEventHandler(async (event) => {
    event.context.requestId = uuidv7()
})