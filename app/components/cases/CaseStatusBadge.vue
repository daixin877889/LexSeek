<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '~/components/ui/badge'
import { CaseStatus, CaseStatusText, CaseStatusBadgeClass } from '#shared/types/case'

interface Props {
  status: CaseStatus | number
}

const props = defineProps<Props>()

const label = computed(() =>
  CaseStatusText[props.status as CaseStatus] ?? '未知',
)

const badgeClass = computed(() =>
  CaseStatusBadgeClass[props.status as CaseStatus] ?? 'bg-muted text-muted-foreground',
)
</script>

<template>
  <Badge :class="badgeClass" variant="outline">
    {{ label }}
  </Badge>
</template>
