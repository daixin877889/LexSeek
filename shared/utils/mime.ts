import mimeInstance from 'mime'

// mime 库默认导出的已经是实例，直接重新导出为命名导出
export const mime = mimeInstance
