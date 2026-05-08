<template>
    <div class="space-y-4">
        <!-- 操作栏 -->
        <div class="flex justify-end">
            <Button variant="outline" :disabled="resyncing" @click="handleResync">
                <RefreshCw v-if="!resyncing" class="h-4 w-4 mr-2" />
                <Loader2 v-else class="h-4 w-4 mr-2 animate-spin" />
                重新扫描
            </Button>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="flex justify-center py-12">
            <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
        </div>

        <!-- 空状态 -->
        <div v-else-if="skills.length === 0" class="flex flex-col items-center justify-center py-12 text-center">
            <Boxes class="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 class="text-lg font-medium mb-1">暂无 Skill</h3>
            <p class="text-muted-foreground text-sm">点击「重新扫描」从文件系统同步 skills</p>
        </div>

        <!-- Skill 列表 -->
        <template v-else>
            <div class="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>名称</TableHead>
                            <TableHead>中文名</TableHead>
                            <TableHead>版本</TableHead>
                            <TableHead>来源</TableHead>
                            <TableHead>路径</TableHead>
                            <TableHead class="w-[100px]">上次同步</TableHead>
                            <TableHead class="w-[80px]">启用</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <TableRow v-for="skill in skills" :key="skill.name">
                            <TableCell class="font-mono text-sm font-medium">{{ skill.name }}</TableCell>
                            <TableCell>
                                <div class="flex items-center gap-2">
                                    <span>{{ skill.customTitle ?? skill.title ?? '-' }}</span>
                                    <Button variant="ghost" size="icon" class="h-6 w-6" @click="handleEdit(skill)">
                                        <Pencil class="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </TableCell>
                            <TableCell>
                                <Badge v-if="skill.version" variant="secondary">v{{ skill.version }}</Badge>
                                <span v-else class="text-muted-foreground text-sm">-</span>
                            </TableCell>
                            <TableCell>
                                <Badge variant="outline">{{ skill.source }}</Badge>
                            </TableCell>
                            <TableCell class="font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                                {{ skill.path }}
                            </TableCell>
                            <TableCell class="text-sm text-muted-foreground">
                                {{ skill.syncedAt ? formatDate(skill.syncedAt) : '-' }}
                            </TableCell>
                            <TableCell>
                                <AdminSkillsSkillEnableSwitch
                                    :skill-name="skill.name"
                                    v-model="skill.status"
                                />
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>
        </template>

        <AdminSkillsSkillEditDialog
            ref="editDialogRef"
            @success="loadSkills"
        />
    </div>
</template>

<script setup lang="ts">
import { Boxes, Loader2, Pencil, RefreshCw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFormatters } from '~/composables/useFormatters'
import AdminSkillsSkillEnableSwitch from '~/components/admin/skills/SkillEnableSwitch.vue'
import AdminSkillsSkillEditDialog from '~/components/admin/skills/SkillEditDialog.vue'

const { formatDate: formatDateRaw } = useFormatters()

interface Skill {
    name: string
    path: string
    source: string
    title: string | null
    customTitle: string | null
    description: string | null
    version: string | null
    status: number
    syncedAt: string | null
    createdAt: string
    updatedAt: string
}

const skills = ref<Skill[]>([])
const loading = ref(false)
const resyncing = ref(false)

function formatDate(date: string) {
    return formatDateRaw(date, 'MM-DD HH:mm')
}

async function loadSkills() {
    loading.value = true
    try {
        const data = await useApiFetch<Skill[]>('/api/v1/admin/skills')
        if (data) skills.value = data
    } finally {
        loading.value = false
    }
}

async function handleResync() {
    resyncing.value = true
    try {
        const result = await useApiFetch('/api/v1/admin/skills/resync', { method: 'POST' })
        if (result !== null) {
            toast.success('扫描完成')
            await loadSkills()
        }
    } finally {
        resyncing.value = false
    }
}

const editDialogRef = ref<{ openEdit: (skill: Skill) => void } | null>(null)
function handleEdit(skill: Skill) {
    editDialogRef.value?.openEdit(skill)
}

onMounted(loadSkills)
</script>
