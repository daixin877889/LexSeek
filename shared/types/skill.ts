/**
 * Skill 系统相关枚举与常量。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5
 */

/**
 * Skill 来源：本期仅实现 filesystem；uploaded 字段预留给未来"后台 UI 上传 skill"功能，
 * 阶段 1 不实现该路径但必须保留字段以便未来兼容。
 */
export enum SkillSource {
    FILESYSTEM = 'filesystem',
    UPLOADED = 'uploaded',
}

/** Skill 启停状态：与 nodes.status 风格一致（数字编码）*/
export enum SkillStatus {
    DISABLED = 0,
    ENABLED = 1,
}

/** Skill 文件系统根目录（项目根的相对路径）*/
export const SKILLS_FS_ROOT = '.deepagents/skills' as const

/** SKILL.md frontmatter 解析结果（gray-matter / 自实现解析共用类型）*/
export interface SkillFrontmatter {
    name: string
    description?: string
    license?: string
    version?: string
}
