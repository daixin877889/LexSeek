<template>
  <div class="theme-brand space-y-6">
    <div>
      <h1 class="text-2xl md:text-3xl font-bold mb-1">审计日志</h1>
      <p class="text-muted-foreground text-sm">查看权限变更和 Agent 工具调用记录</p>
    </div>

    <Tabs default-value="permission" class="w-full">
      <TabsList>
        <TabsTrigger value="permission" :class="adminBrandFocusClass">权限审计</TabsTrigger>
        <TabsTrigger value="agent" :class="adminBrandFocusClass">Agent 工具审计</TabsTrigger>
      </TabsList>
      <TabsContent value="permission">
        <PermissionAuditTab />
      </TabsContent>
      <TabsContent value="agent">
        <AgentAuditTab />
      </TabsContent>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import PermissionAuditTab from './components/PermissionAuditTab.vue'
import AgentAuditTab from './components/AgentAuditTab.vue'
import { adminBrandFocusClass } from '~/utils/adminBrandStyles'

definePageMeta({ layout: 'admin-layout', title: '审计日志' })
</script>
