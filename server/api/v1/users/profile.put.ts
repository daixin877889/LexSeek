/**
 * 更新当前登录用户的资料
 */

export default defineEventHandler(async (event) => {
  const logger = createLogger('users')
  try {
    // 参数验证
    const body = await readValidatedBody(event, (payload) => z.object({
      name: z.string("姓名不能为空").max(20, "姓名长度不能超过20个字符"),
      company: z.string().max(100, "公司名称长度不能超过100个字符").optional(),
      profile: z.string().max(200, "个人简介长度不能超过200个字符").optional(),
    }).parse(payload))

    const user = event.context.auth.user;
    const { name, company, profile } = body;

    // 更新用户资料
    const updatedUser = await updateUserProfileDao(user.id, {
      name,
      company: company ?? undefined,
      profile: profile ?? undefined,
    });

    // 获取更新后的用户信息
    const userInfo = await findUserByIdDao(updatedUser.id)
    if (!userInfo) {
      return resError(event, 400, '用户不存在')
    }

    // 使用统一的格式化用户信息服务
    const responseUser = formatUserResponseService(userInfo)
    return resSuccess(event, "更新用户资料成功", responseUser);
  } catch (error: any) {
    logger.error('更新用户资料失败：', error)
    return resError(event, 400, parseErrorMessage(error, "更新用户资料失败"))
  }
});