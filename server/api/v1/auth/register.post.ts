/**
 * 手机验证码注册
 * @param event
 * @returns
 */
export default defineEventHandler(async (event) => {
    const logger = createLogger('Auth')
    try {
        const config = useRuntimeConfig()
        // 从配置获取（配置单位为秒，转换为毫秒）
        const CODE_EXPIRE_MS = config.aliyun.sms.codeExpireMs * 1000
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

        // 验证验证码
        const smsRecord = await findSmsRecordByPhoneAndType(phone, SmsType.REGISTER);
        if (!smsRecord) {
            return resError(event, 400, '验证码不存在,请先获取验证码!')
        }
        if (smsRecord.expiredAt < new Date()) {
            await prisma.smsRecords.delete({
                where: { id: smsRecord.id },
            })
            return resError(event, 400, '验证码已过期')
        }
        if (smsRecord.code !== code) {
            return resError(event, 400, '验证码不正确')
        }

        // 验证用户名是否存在
        if (username) {
            const userByUsername = await findUserByUsername(username);
            if (userByUsername) {
                return resError(event, 400, '用户名已存在,请重新输入!')
            }
        }

        // 删除验证码
        await deleteSmsRecordById(smsRecord.id)

        // 查询用户是否存在
        const user = await findUserByPhone(phone)
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
            const invitedUser = await findUserByInviteCode(invitedBy);
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
        const newUser = await createUser({
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

        // 生成JWT令牌
        const token = JwtUtil.generateToken({
            id: newUser.id,
            phone: newUser.phone,
            role: newUser.role,
            status: newUser.status,
        })

        // 设置 HttpOnly Cookie
        setCookie(event, 'auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 30 // 30天
        });

        return resSuccess(event, '注册成功', {
            token,
            user: {
                id: newUser.id,
                name: newUser.name,
                username: newUser.username,
                phone: newUser.phone,
                email: newUser.email,
                role: newUser.role,
                status: newUser.status,
                company: newUser.company,
                profile: newUser.profile,
                inviteCode: newUser.inviteCode,
            }
        })
    } catch (error: any) {
        logger.error('注册接口错误：', error)

        return resError(event, 400, parseErrorMessage(error, "注册失败"))
    }
})
