/**
 * Interrupt 注册表
 *
 * 中心化管理所有中断类型的处理器组件，支持 isToolCard 标志区分工具卡（TemplateSelectCard / StanceSelectCard）
 * 与中断卡（CaseInfoCheckHandler 等）。
 */

import type { Component } from 'vue'

export interface InterruptRegistryOptions {
  isToolCard?: boolean
}

export class InterruptRegistry {
  private handlers = new Map<string, {
    component: Component
    isToolCard?: boolean
  }>()

  /**
   * 注册一个中断处理器组件
   */
  register(type: string, component: Component, opts?: InterruptRegistryOptions): void {
    this.handlers.set(type, {
      component,
      isToolCard: opts?.isToolCard,
    })
  }

  /**
   * 获取指定类型的处理器组件
   */
  getComponent(type: string): Component | undefined {
    return this.handlers.get(type)?.component
  }

  /**
   * 判断指定类型是否是工具卡（vs 中断卡）
   */
  isToolCard(type: string): boolean {
    return this.handlers.get(type)?.isToolCard ?? false
  }

  /**
   * 获取所有已注册的类型
   */
  getAllTypes(): string[] {
    return Array.from(this.handlers.keys())
  }
}

/**
 * 全局单例
 */
export const globalInterruptRegistry = new InterruptRegistry()
