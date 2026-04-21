<template>
    <Sheet v-model:open="isOpen">
        <SheetContent class="sm:max-w-2xl overflow-y-auto p-6">
            <SheetHeader>
                <SheetTitle>审计记录详情</SheetTitle>
                <SheetDescription class="font-mono text-xs">{{ record?.id }}</SheetDescription>
            </SheetHeader>
            <div v-if="record" class="mt-4 space-y-4">
                <div class="grid grid-cols-2 gap-2 text-sm">
                    <div class="text-muted-foreground">工具</div>
                    <div class="font-mono">{{ record.toolName }}</div>
                    <div class="text-muted-foreground">用户</div>
                    <div>{{ record.userId }}</div>
                    <div class="text-muted-foreground">会话</div>
                    <div class="font-mono text-xs break-all">{{ record.sessionId }}</div>
                    <div class="text-muted-foreground">案件</div>
                    <div>{{ record.caseId ?? '-' }}</div>
                    <div class="text-muted-foreground">判决</div>
                    <div>{{ AgentAuditVerdictText[record.verdict] }}</div>
                    <div class="text-muted-foreground">拒绝原因</div>
                    <div>{{ record.denyReason ?? '-' }}</div>
                    <div class="text-muted-foreground">耗时</div>
                    <div>{{ record.latencyMs }} ms</div>
                    <div class="text-muted-foreground">时间</div>
                    <div class="font-mono text-xs">{{ record.createdAt }}</div>
                </div>
                <div>
                    <div class="text-sm text-muted-foreground mb-2">工具参数</div>
                    <pre class="text-xs bg-muted p-3 rounded overflow-x-auto">{{ JSON.stringify(record.argsDigest, null, 2) }}</pre>
                </div>
            </div>
            <div v-else-if="loading" class="mt-8 text-center text-muted-foreground text-sm">加载中…</div>
        </SheetContent>
    </Sheet>
</template>

<script setup lang="ts">
import { AgentAuditVerdictText, type AgentAuditRecord } from '#shared/types/agentAudit'

const isOpen = defineModel<boolean>('open', { default: false })
const props = defineProps<{ recordId: string }>()

const record = ref<AgentAuditRecord | null>(null)
const loading = ref(false)

watch([() => props.recordId, isOpen], async ([id, open]) => {
    if (!open || !id) return
    loading.value = true
    record.value = null
    try {
        const resp = await useApiFetch<AgentAuditRecord>(`/api/v1/admin/agent-audit-logs/${id}`)
        if (resp) record.value = resp
    } finally {
        loading.value = false
    }
})
</script>
