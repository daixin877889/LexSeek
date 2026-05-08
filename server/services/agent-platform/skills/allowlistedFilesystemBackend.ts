/**
 * 装饰 FilesystemBackend：拦截 ls() 过滤掉非白名单 skill 子目录。
 *
 * 用于 createSkillsMiddleware 的 backend 参数。deepagents 在 sources 父目录下
 * 调 backend.ls() 列子目录加载 SKILL.md，本类把"父目录里"不在白名单内的
 * 子目录从结果中剔除——让被管理员禁用的 skill 不被 LLM 看到，也不会被
 * deepagents 注入的 read/run/write 工具加载到对话流中。
 *
 * 设计要点：
 *  - 仅在 path 是注册的 skill 父目录之一时过滤；其它路径（如 SKILL.md 子目录、
 *    工作区目录）不动，避免误伤业务逻辑
 *  - 文件项（is_dir=false）不动，避免影响父目录下的非 skill 文件（如 README）
 *  - 路径标准化：去尾斜杠对齐 skillParentDirs 集合
 */

import { FilesystemBackend, type LsResult } from 'deepagents'

export interface AllowlistedFilesystemBackendOptions {
    rootDir: string
    /** skill 父目录集合（已规范化无尾斜杠的绝对/相对路径） */
    skillParentDirs: Set<string>
    /** 允许的 skill 子目录名集合（空集合 → 父目录下所有目录都被过滤） */
    allowedSkillNames: Set<string>
}

function trimTrailingSlash(path: string): string {
    return path.replace(/[\\/]+$/, '')
}

export class AllowlistedFilesystemBackend extends FilesystemBackend {
    private readonly skillParentDirs: Set<string>
    private readonly allowedSkillNames: Set<string>

    constructor(opts: AllowlistedFilesystemBackendOptions) {
        super({ rootDir: opts.rootDir })
        this.skillParentDirs = new Set(
            [...opts.skillParentDirs].map(trimTrailingSlash),
        )
        this.allowedSkillNames = opts.allowedSkillNames
    }

    override async ls(path: string): Promise<LsResult> {
        const result = await super.ls(path)
        if (result.error || !result.files) return result

        const normalized = trimTrailingSlash(path)
        if (!this.skillParentDirs.has(normalized)) return result

        // 在注册的 skill 父目录下：仅保留白名单内的子目录 + 全部文件
        const filtered = result.files.filter((info) => {
            if (!info.is_dir) return true
            const name = trimTrailingSlash(info.path).split(/[\\/]/).pop() ?? ''
            return this.allowedSkillNames.has(name)
        })
        return { ...result, files: filtered }
    }
}
