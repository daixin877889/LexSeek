import {
  FileTextIcon,
  CalendarIcon,
  ScaleIcon,
  TrendingUpIcon,
  TagIcon,
  ShieldIcon,
  ClipboardListIcon,
} from 'lucide-vue-next'
import type { Component } from 'vue'

/** 模块图标名 → lucide 组件映射 */
const MODULE_ICON_MAP: Record<string, Component> = {
  FileText: FileTextIcon,
  Calendar: CalendarIcon,
  Scale: ScaleIcon,
  TrendingUp: TrendingUpIcon,
  Tag: TagIcon,
  Shield: ShieldIcon,
  ClipboardList: ClipboardListIcon,
}

/** 根据图标名获取组件，默认返回 FileTextIcon */
export function getModuleIcon(iconName: string): Component {
  return MODULE_ICON_MAP[iconName] ?? FileTextIcon
}
