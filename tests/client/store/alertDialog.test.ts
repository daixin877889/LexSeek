/**
 * AlertDialog Store 测试
 *
 * 测试全局确认对话框状态管理
 *
 * **Feature: alert-dialog-store**
 * **Validates: Requirements 7.1, 7.2**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAlertDialogStore } from '../../../app/store/alertDialog'

describe('AlertDialog Store', () => {
    beforeEach(() => {
        // 每个测试前创建新的 Pinia 实例
        setActivePinia(createPinia())
    })

    describe('初始状态', () => {
        it('初始状态应正确', () => {
            const store = useAlertDialogStore()
            expect(store.isVisible).toBe(false)
            expect(store.title).toBe('')
            expect(store.message).toBe('')
            expect(store.type).toBe('success')
            expect(store.confirmText).toBe('确认')
            expect(store.cancelText).toBe('取消')
            expect(store.showCancel).toBe(true)
        })
    })

    describe('showDialog 显示对话框', () => {
        it('应正确设置对话框内容', () => {
            const store = useAlertDialogStore()
            store.showDialog({
                title: '测试标题',
                message: '测试消息',
                type: 'success',
                confirmText: '确定',
                cancelText: '取消',
                showCancel: true,
                onConfirm: () => { },
                onCancel: () => { },
            })

            expect(store.isVisible).toBe(true)
            expect(store.title).toBe('测试标题')
            expect(store.message).toBe('测试消息')
            expect(store.type).toBe('success')
            expect(store.confirmText).toBe('确定')
            expect(store.cancelText).toBe('取消')
        })

        it('缺少 title 时应使用默认值', () => {
            const store = useAlertDialogStore()
            store.showDialog({
                title: null,
                message: '消息',
                type: null,
                confirmText: null,
                cancelText: null,
                showCancel: true,
                onConfirm: () => { },
                onCancel: () => { },
            })

            expect(store.title).toBe('提示')
        })

        it('缺少 type 时应使用默认值 success', () => {
            const store = useAlertDialogStore()
            store.showDialog({
                title: '标题',
                message: '消息',
                type: null,
                confirmText: null,
                cancelText: null,
                showCancel: true,
                onConfirm: () => { },
                onCancel: () => { },
            })

            expect(store.type).toBe('success')
        })

        it('showCancel 为 false 时应隐藏取消按钮', () => {
            const store = useAlertDialogStore()
            store.showDialog({
                title: '标题',
                message: '消息',
                type: 'success',
                confirmText: null,
                cancelText: null,
                showCancel: false,
                onConfirm: () => { },
                onCancel: () => { },
            })

            expect(store.showCancel).toBe(false)
        })

        it('应正确设置自定义 zIndex', () => {
            const store = useAlertDialogStore()
            store.showDialog({
                title: '标题',
                message: '消息',
                type: 'success',
                confirmText: null,
                cancelText: null,
                showCancel: true,
                zIndex: 1000,
                onConfirm: () => { },
                onCancel: () => { },
            })

            expect(store.zIndex).toBe(1000)
        })
    })

    describe('showSuccessDialog 显示成功对话框', () => {
        it('应设置 type 为 success', () => {
            const store = useAlertDialogStore()
            store.showSuccessDialog({
                title: '成功',
                message: '操作成功',
                type: null,
                confirmText: null,
                cancelText: null,
                showCancel: true,
                onConfirm: () => { },
                onCancel: () => { },
            })

            expect(store.type).toBe('success')
            expect(store.isVisible).toBe(true)
        })
    })

    describe('showErrorDialog 显示错误对话框', () => {
        it('应设置 type 为 error', () => {
            const store = useAlertDialogStore()
            store.showErrorDialog({
                title: '错误',
                message: '操作失败',
                type: null,
                confirmText: null,
                cancelText: null,
                showCancel: true,
                onConfirm: () => { },
                onCancel: () => { },
            })

            expect(store.type).toBe('error')
            expect(store.isVisible).toBe(true)
        })
    })

    describe('hideDialog 隐藏对话框', () => {
        it('应隐藏对话框', () => {
            const store = useAlertDialogStore()
            store.showDialog({
                title: '标题',
                message: '消息',
                type: 'success',
                confirmText: null,
                cancelText: null,
                showCancel: true,
                onConfirm: () => { },
                onCancel: () => { },
            })
            expect(store.isVisible).toBe(true)

            store.hideDialog()
            expect(store.isVisible).toBe(false)
        })
    })

    describe('handleConfirm 处理确认', () => {
        it('应调用确认回调并隐藏对话框', () => {
            const store = useAlertDialogStore()
            const confirmCallback = vi.fn()

            store.showDialog({
                title: '标题',
                message: '消息',
                type: 'success',
                confirmText: null,
                cancelText: null,
                showCancel: true,
                onConfirm: confirmCallback,
                onCancel: () => { },
            })

            store.handleConfirm()

            expect(confirmCallback).toHaveBeenCalledTimes(1)
            expect(store.isVisible).toBe(false)
        })

        it('没有回调时不应报错', () => {
            const store = useAlertDialogStore()
            store.showDialog({
                title: '标题',
                message: '消息',
                type: 'success',
                confirmText: null,
                cancelText: null,
                showCancel: true,
                onConfirm: null as unknown as () => void,
                onCancel: () => { },
            })

            expect(() => store.handleConfirm()).not.toThrow()
            expect(store.isVisible).toBe(false)
        })
    })

    describe('handleCancel 处理取消', () => {
        it('应调用取消回调并隐藏对话框', () => {
            const store = useAlertDialogStore()
            const cancelCallback = vi.fn()

            store.showDialog({
                title: '标题',
                message: '消息',
                type: 'success',
                confirmText: null,
                cancelText: null,
                showCancel: true,
                onConfirm: () => { },
                onCancel: cancelCallback,
            })

            store.handleCancel()

            expect(cancelCallback).toHaveBeenCalledTimes(1)
            expect(store.isVisible).toBe(false)
        })

        it('没有回调时不应报错', () => {
            const store = useAlertDialogStore()
            store.showDialog({
                title: '标题',
                message: '消息',
                type: 'success',
                confirmText: null,
                cancelText: null,
                showCancel: true,
                onConfirm: () => { },
                onCancel: null as unknown as () => void,
            })

            expect(() => store.handleCancel()).not.toThrow()
            expect(store.isVisible).toBe(false)
        })
    })

    describe('多次显示对话框', () => {
        it('新对话框应覆盖旧对话框', () => {
            const store = useAlertDialogStore()

            store.showDialog({
                title: '第一个',
                message: '消息1',
                type: 'success',
                confirmText: null,
                cancelText: null,
                showCancel: true,
                onConfirm: () => { },
                onCancel: () => { },
            })

            store.showDialog({
                title: '第二个',
                message: '消息2',
                type: 'error',
                confirmText: null,
                cancelText: null,
                showCancel: false,
                onConfirm: () => { },
                onCancel: () => { },
            })

            expect(store.title).toBe('第二个')
            expect(store.message).toBe('消息2')
            expect(store.type).toBe('error')
            expect(store.showCancel).toBe(false)
        })
    })
})
