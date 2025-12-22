export default defineEventHandler(async (event) => {
  const logger = createLogger('users')
  try {

    // 参数验证
    const body = await readValidatedBody(event, (payload) => z.object({
      currentPassword: z.string("当前密码不能为空").regex(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, "密码至少8位，至少包含字母和数字"),
      newPassword: z.string("当前密码不能为空").regex(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, "密码至少8位，至少包含字母和数字"),
    }).parse(payload))

    const user = event.context.auth.user;
    const token = event.context.auth.token;
    const expiredTimestamp = event.context.auth.user.exp;

    if (!user) {
      return resError(event, 401, "用户未登录");
    }
    const { currentPassword, newPassword } = body;

    // 获取用户信息
    const userInfo = await findUserByIdDao(user.id)
    if (!userInfo) {
      return resError(event, 400, '用户不存在')
    }
    // 如果用户已有密码，需要验证旧密码
    if (userInfo.password) {
      const isPasswordValid = await comparePassword(currentPassword, userInfo.password);
      if (!isPasswordValid) {
        return resError(event, 400, "当前密码错误");
      }
    }
    // 加密新密码
    const hashedNewPassword = await generatePassword(newPassword);

    // 更新用户密码
    const updatedUser = await updateUserPasswordDao(user.id, hashedNewPassword);
    if (!updatedUser) {
      return resError(event, 400, "更新用户密码失败");
    }

    // 添加 token 黑名单
    if (token && expiredTimestamp) {
      await addTokenBlacklistDao(token, user.id, new Date(expiredTimestamp * 1000));
    }

    // 清除认证 cookie
    clearAuthCookies(event);

    return resSuccess(event, "更新用户密码成功", true)
  } catch (error) {
    logger.error("更新用户密码失败：", error);
    return resError(event, 400, parseErrorMessage(error, "更新用户密码失败"));
  }
});
