import { describe, it, expect } from 'vitest'
import { SkillSource, SkillStatus, SKILLS_FS_ROOT } from '#shared/types/skill'

describe('SkillSource', () => {
    it('包含 filesystem / uploaded 两种来源', () => {
        expect(SkillSource.FILESYSTEM).toBe('filesystem')
        expect(SkillSource.UPLOADED).toBe('uploaded')
    })
})

describe('SkillStatus', () => {
    it('使用 0/1 数字编码，与 nodes.status 风格一致', () => {
        expect(SkillStatus.DISABLED).toBe(0)
        expect(SkillStatus.ENABLED).toBe(1)
    })
})

describe('SKILLS_FS_ROOT', () => {
    it('指向 .deepagents/skills 相对路径', () => {
        expect(SKILLS_FS_ROOT).toBe('.deepagents/skills')
    })
})
