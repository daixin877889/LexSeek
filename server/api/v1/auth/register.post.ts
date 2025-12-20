/**
 * 手机验证码注册
 *
 * 使用短信验证码完成用户注册流程
 * @param event H3Event 对象
 * @returns 注册结果，包含 token 和用户信息
 */
export default defineEventHandler(async (event) => {
    const logger = createLogger('Auth')
    try {
        // 参数验证规则
        const schema = z.object({
            phone: z.string("手机号不能为空").regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
            code: z.string("验证码不能为空").regex(/^\d{6}$/, "验证码格式不正确"),
            name: z.string("姓名不能为空").max(20, "姓名长度不能超过20个字符"),
            username: z.string().max(20, "用户名长度不能超过20个字符").optional(),
            password: z.string("密码不能为空").regex(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, "密码至少8位，至少包含字母和数字"),
            company: z.string().max(100, "公司名称长度不能超过100个字符").optional(),
            profile: z.string().max(200, "个人简介长度不能超过200个字符").optional(),
            invitedBy: z.string("邀请人 ID 格式错误").optional(),
        })
        const body = await readValidatedBody(event, (payload) => schema.parse(payload))
        const { phone, code, name, password, username, company, profile, invitedBy } = body;

        // 使用统一的验证码验证服务
        const verificationResult = await verifySmsCode(phone, code, SmsType.REGISTER)
        if (!verificationResult.success) {
            return resError(event, verificationResult.errorCode!, verificationResult.error!)
        }

        // 验证用户名是否存在
        if (username) {
            const userByUsername = await findUserByUsernameDao(username);
            if (userByUsername) {
                return resError(event, 400, '用户名已存在,请重新输入!')
            }
        }

        // 查询用户是否存在
        const user = await findUserByPhoneDao(phone)
        if (user && user.status === UserStatus.ACTIVE) {
            return resError(event, 400, '该手机号已注册，请直接登录')
        }

        // 验证用户是否被禁用
        if (user && user.status === UserStatus.INACTIVE) {
            return resError(event, 400, '该手机号已禁用，请联系管理员')
        }

        // 加密密码
        const hashedPassword = await generatePassword(password);

        // 如果有邀请人，则设置邀请人ID
        let invitedById: number | null = null;
        if (invitedBy) {
            const invitedUser = await findUserByInviteCodeDao(invitedBy);
            if (invitedUser) {
                invitedById = invitedUser.id;
            }
        }

        // 生成唯一用户名（如果未提供）
        const generateUniqueUsername = async (baseUsername: string): Promise<string> => {
            let finalUsername = baseUsername;
            let suffix = 1;
            while (await prisma.users.findUnique({ where: { username: finalUsername } })) {
                finalUsername = `${baseUsername}_${suffix}`;
                suffix++;
            }
            return finalUsername;
        };

        const defaultUsername = `用户${phone.slice(-4)}`;
        const finalUsername = username ?? await generateUniqueUsername(defaultUsername);

        // 创建用户
        const newUser = await createUserDao({
            name: name ?? `用户${phone.slice(-4)}`,
            username: finalUsername,
            phone,
            password: hashedPassword,
            role: $Enums.UserRole.user,
            status: UserStatus.ACTIVE,
            company: company ?? null,
            profile: profile ?? null,
            inviteCode: await generateUniqueInviteCode(),
            registerChannel: UserRegisterChannel.WEB,
            invitedBy: invitedById,
        })

        // 使用统一的 token 生成服务
        const token = generateAuthToken(event, {
            id: newUser.id,
            phone: newUser.phone,
            role: newUser.role,
            status: newUser.status,
        })

        // 使用统一的用户信息格式化服务
        return resSuccess(event, '注册成功', {
            token,
            user: formatUserResponseService(newUser)
        })
    } catch (error: any) {
        logger.error('注册接口错误：', error)

        return resError(event, 400, parseErrorMessage(error, "注册失败"))
    }
})
