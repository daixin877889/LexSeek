<template>
    <div class="space-y-6">
        <!-- 页面标题 -->
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
                <h1 class="text-2xl md:text-3xl font-bold mb-1">Skills 管理</h1>
                <p class="text-muted-foreground text-sm">管理 Agent 扩展 Skill，扫描文件系统并关联到节点</p>
            </div>
        </div>

        <!-- Skill 列表 -->
        <AdminSkillsSkillList />
    </div>
</template>

<script setup lang="ts">
import AdminSkillsSkillList from '~/components/admin/skills/SkillList.vue'

definePageMeta({
    layout: 'admin-layout',
    title: 'Skills 管理',
})
</script>
