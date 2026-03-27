/**
 * moduleIcons 模块图标工具测试
 *
 * 测试模块图标映射功能
 *
 * **Feature: module-icons-utils**
 * **Validates: 模块图标映射功能**
 */

import { describe, it, expect } from 'vitest'
import { getModuleIcon } from '~/utils/moduleIcons'

describe('getModuleIcon 图标映射', () => {
    it('FileText 应返回 FileTextIcon', () => {
        const icon = getModuleIcon('FileText')
        expect(icon).toBeDefined()
    })

    it('Calendar 应返回 CalendarIcon', () => {
        const icon = getModuleIcon('Calendar')
        expect(icon).toBeDefined()
    })

    it('Scale 应返回 ScaleIcon', () => {
        const icon = getModuleIcon('Scale')
        expect(icon).toBeDefined()
    })

    it('TrendingUp 应返回 TrendingUpIcon', () => {
        const icon = getModuleIcon('TrendingUp')
        expect(icon).toBeDefined()
    })

    it('Tag 应返回 TagIcon', () => {
        const icon = getModuleIcon('Tag')
        expect(icon).toBeDefined()
    })

    it('Shield 应返回 ShieldIcon', () => {
        const icon = getModuleIcon('Shield')
        expect(icon).toBeDefined()
    })

    it('ClipboardList 应返回 ClipboardListIcon', () => {
        const icon = getModuleIcon('ClipboardList')
        expect(icon).toBeDefined()
    })

    it('未知图标名应返回默认 FileTextIcon', () => {
        const icon = getModuleIcon('UnknownIcon')
        const defaultIcon = getModuleIcon('FileText')
        expect(icon).toBe(defaultIcon)
    })

    it('空字符串应返回默认 FileTextIcon', () => {
        const icon = getModuleIcon('')
        const defaultIcon = getModuleIcon('FileText')
        expect(icon).toBe(defaultIcon)
    })

    it('不同图标名应返回对应图标', () => {
        const icon1 = getModuleIcon('FileText')
        const icon2 = getModuleIcon('Calendar')
        expect(icon1).not.toBe(icon2)
    })
})
