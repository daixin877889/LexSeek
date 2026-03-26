export interface TodoItem {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

const statusOrder: Record<string, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
}

function extractTodoItems(args: any, resultContent: any): TodoItem[] {
  // 优先从工具返回值解析
  if (resultContent != null) {
    try {
      const parsed = typeof resultContent === 'string' ? JSON.parse(resultContent) : resultContent
      const items = parsed?.update?.todos ?? parsed?.todos
      if (Array.isArray(items) && items.length > 0) {
        return items.map((item: any, idx: number) => ({
          id: item.id ?? `todo-${idx}`,
          text: item.content ?? item.title ?? item.text ?? item.name ?? '',
          status: item.status ?? 'pending',
        }))
      }
    }
    catch { /* 解析失败，降级到 args */ }
  }

  // 降级从工具调用参数解析
  const argTodos = args?.todos
  if (Array.isArray(argTodos) && argTodos.length > 0) {
    return argTodos.map((item: any, idx: number) => ({
      id: item.id ?? `todo-${idx}`,
      text: item.content ?? item.title ?? item.text ?? item.name ?? '',
      status: item.status ?? 'pending',
    }))
  }

  return []
}

export function useTaskQueueParser(messages: MaybeRef<any[]>) {
  const todos = ref<TodoItem[]>([])

  watch(
    () => toValue(messages),
    (msgs) => {
      if (!msgs?.length) return

      // Pass 1: 收集所有 ToolMessage 结果
      const toolResultMap = new Map<string, any>()
      for (const m of msgs) {
        const isToolMsg = m?.type === 'tool' || m?.constructor?.name === 'ToolMessage'
        if (isToolMsg) {
          const callId = m.tool_call_id ?? m.additional_kwargs?.tool_call_id
          if (callId) toolResultMap.set(callId, m)
        }
      }

      // Pass 2: 找到最新的已完成 write_todos 调用
      let latestTodos: TodoItem[] | null = null
      for (const m of msgs) {
        const toolCalls: any[] = m?.tool_calls ?? m?.additional_kwargs?.tool_calls ?? []
        for (const tc of toolCalls) {
          if (tc.name !== 'write_todos') continue
          const result = toolResultMap.get(tc.id ?? '')
          // 跳过尚未完成的工具调用（无 ToolMessage 结果），防止流式重渲染
          if (!result) continue
          const parsed = extractTodoItems(tc.args, result.content)
          if (parsed.length > 0) latestTodos = parsed
        }
      }

      if (!latestTodos) return

      // 排序：进行中 > 待处理 > 已完成
      latestTodos.sort((a, b) => (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1))

      // 原地 diff：只修改变化的字段，避免替换数组引用触发全量重渲染
      const current = todos.value
      for (let i = 0; i < latestTodos.length; i++) {
        const incoming = latestTodos[i]!
        if (i < current.length) {
          if (current[i]!.id !== incoming.id) current[i]!.id = incoming.id
          if (current[i]!.text !== incoming.text) current[i]!.text = incoming.text
          if (current[i]!.status !== incoming.status) current[i]!.status = incoming.status
        }
        else {
          current.push({ id: incoming.id, text: incoming.text, status: incoming.status })
        }
      }
      if (current.length > latestTodos.length) {
        current.splice(latestTodos.length)
      }
    },
    { deep: true },
  )

  return { todos: readonly(todos) }
}
