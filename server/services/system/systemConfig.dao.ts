
/**
 * 系统配置存储库
 *
 * 负责系统配置的数据库操作和缓存管理
 */


/*
/**
 * 根据配置组和键获取配置
 *
 * @param configGroup 配置组
 * @param key 配置键
 * @param includeDisabled 是否包含禁用状态的配置项
 * @returns 系统配置对象
 */
export async function getConfigsByGroupAndKeyDao(configGroup: string, key: string, includeDisabled: boolean = false): Promise<systemConfigs | null> {
    try {
        // 构建查询条件
        const where: any = {
            configGroup: configGroup,
            key: key,
            deletedAt: null
        };

        // 是否只查询启用状态的配置
        if (!includeDisabled) {
            where.status = SystemConfigStatus.ENABLED;
        }

        // 执行查询
        const configs = await prisma.systemConfigs.findFirst({
            where,
        });


        return configs;
    } catch (error) {
        logger.error(`数据库查询系统配置失败(Group: ${configGroup}, Key: ${key})`, { error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}


/**
 * 根据配置键获取所有配置
 *
 * @param key 配置键
 * @param includeDisabled 是否包含禁用状态的配置项
 * @returns 系统配置对象数组
 */
export async function getConfigsByKeyDao(key: string, includeDisabled: boolean = false): Promise<systemConfigs[]> {
    try {
        // 构建查询条件
        const where: any = {
            key: key,
            deletedAt: null
        };

        // 是否只查询启用状态的配置
        if (!includeDisabled) {
            where.status = SystemConfigStatus.ENABLED;
        }

        // 执行查询
        const configs = await prisma.systemConfigs.findMany({
            where,
            orderBy: {
                configGroup: 'asc'
            }
        });
        return configs;
    } catch (error) {
        logger.error(`数据库查询系统配置失败(Key: ${key})`, { error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}


/**
 * 分页获取系统配置列表
 *
 * @param group 配置组（可选）
 * @param page 页码
 * @param pageSize 每页数量
 * @returns 分页的系统配置列表
 */
export async function getConfigsByPageDao(group: string | null = null, page: number = 1, pageSize: number = 10): Promise<{ configs: systemConfigs[]; total: number; page: number; pageSize: number }> {

    // 构建查询条件
    const where: any = {
        deletedAt: null
    };

    // 如果指定了配置组，则按组筛选
    if (group) {
        where.configGroup = group;
    }

    try {
        // 执行查询
        const configs = await prisma.systemConfigs.findMany({
            where,
            orderBy: [
                { configGroup: 'asc' },
                { key: 'asc' }
            ],
            skip: (page - 1) * pageSize,
            take: pageSize
        });

        const total = await prisma.systemConfigs.count({
            where
        });

        // 确保查询结果不为空
        if (!configs) {
            logger.error("Prisma查询系统配置返回null", { group, page, pageSize });
            return { configs: [], total: 0, page, pageSize };
        }

        logger.info("获取系统配置列表:", {
            group,
            page,
            pageSize,
            resultCount: configs.length,
            total
        });


        return {
            total,
            page,
            pageSize,
            configs: configs,
        };

    } catch (error) {
        logger.error("获取系统配置列表失败", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            group,
            page,
            pageSize
        });
        // 出错时返回空结果
        return { configs: [], total: 0, page, pageSize };
    }
}


/**
 * 获取所有系统配置组
 *
 * @returns 所有配置组的唯一列表
 */
export async function getAllConfigGroupsDao(): Promise<string[]> {
    try {
        // 使用Prisma获取所有不同的配置组
        const distinctGroups = await prisma.systemConfigs.findMany({
            where: {
                deletedAt: null
            },
            select: {
                configGroup: true
            },
            distinct: ['configGroup'],
            orderBy: {
                configGroup: 'asc'
            }
        });

        const groups = distinctGroups.map((item: any) => item.configGroup);

        return groups;
    } catch (error) {
        logger.error("获取所有系统配置组失败", { error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}

/**
 * 根据配置组获取所有配置
 *
 * @param group 配置组
 * @param includeDisabled 是否包含禁用状态的配置项
 * @returns 系统配置对象数组
 */
export async function getConfigsByGroupDao(group: string, includeDisabled: boolean = false): Promise<systemConfigs[]> {
    try {
        // 构建查询条件
        const where: any = {
            configGroup: group,
            deletedAt: null
        };

        // 是否只查询启用状态的配置
        if (!includeDisabled) {
            where.status = 1;
        }

        // 执行查询
        const configs = await prisma.systemConfigs.findMany({
            where,
            orderBy: {
                key: 'asc'
            }
        });

        return configs;
    } catch (error) {
        logger.error(`数据库查询系统配置失败(Group: ${group})`, { error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}

/**
 * 根据ID获取系统配置
 *
 * @param id 配置ID
 * @returns 系统配置对象，不存在返回null
 */
export async function getConfigByIdDao(id: number): Promise<systemConfigs | null> {
    try {
        const config = await prisma.systemConfigs.findFirst({
            where: {
                id: id,
                deletedAt: null
            }
        });

        return config;
    } catch (error) {
        logger.error(`数据库查询系统配置失败(ID: ${id})`, { error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}
