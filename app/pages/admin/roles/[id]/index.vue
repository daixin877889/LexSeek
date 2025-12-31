<template>
  <NuxtLayout name="admin-layout">
    <div class="space-y-6 max-w-2xl">
      <!-- 页面标题 -->
      <div>
        <h1 class="text-2xl font-bold">编辑角色</h1>
        <p class="text-muted-foreground">修改角色基本信息</p>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="flex items-center justify-center py-12">
        <Loader2 class="h-8 w-8 animate-spin" />
      </div>

      <!-- 表单 -->
      <Card v-else-if="role" class="shadow-none">
        <CardContent class="pt-6">
          <form @submit.prevent="handleSubmit" class="space-y-6">
            <div class="space-y-2">
              <Label for="name">角色名称 <span class="text-destructive">*</span></Label>
              <Input id="name" v-model="form.name" placeholder="请输入角色名称" />
            </div>

            <div class="space-y-2">
              <Label for="code">角色标识</Label>
              <Input id="code" :value="role.code" disabled class="bg-muted" />
              <p class="text-xs text-muted-foreground">角色标识创建后不可修改</p>
            </div>

            <div class="space-y-2">
              <Label for="description">描述</Label>
              <Textarea id="description" v-model="form.description" placeholder="请输入角色描述" rows="3" />
            </div>

            <div class="space-y-2">
              <Label>状态</Label>
              <div class="flex items-center space-x-2">
                <Switch id="status" v-model:checked="statusEnabled" :disabled="role.code === 'super_admin'" />
                <Label for="status" class="font-normal">{{ statusEnabled ? '启用' : '禁用' }}</Label>
              </div>
              <p v-if="role.code === 'super_admin'" class="text-xs text-muted-foreground">
                超级管理员角色不能禁用
              </p>
            </div>

            <div class="flex gap-4 pt-4">
              <Button type="submit" :disabled="submitting">
                <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                保存修改
              </Button>
              <Button type="button" variant="outline" @click="navigateTo('/admin/roles')">
                取消
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <!-- 未找到 -->
      <Card v-else class="shadow-none">
        <CardContent class="py-12 text-center text-muted-foreground">
          角色不存在
        </CardContent>
      </Card>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

definePageMeta({
  layout: false,
  title: "权限分配"
})

const route = useRoute()
const roleId = computed(() => Number(route.params.id))

/** 角色类型 */
interface Role {
  id: number
  name: string
  code: string
  description: string | null
  status: number
}

/** 加载状态 */
const loading = ref(true)

/** 角色数据 */
const role = ref<Role | null>(null)

/** 表单数据 */
const form = ref({
  name: '',
  description: '',
})

/** 状态开关 */
const statusEnabled = ref(true)

/** 提交状态 */
const submitting = ref(false)

/** 加载角色详情 */
const loadRole = async () => {
  loading.value = true
  try {
    const data = await useApiFetch<Role>(`/api/v1/admin/roles/${roleId.value}`)
    if (data) {
      role.value = data
      form.value.name = data.name
      form.value.description = data.description || ''
      statusEnabled.value = data.status === 1
    }
  } finally {
    loading.value = false
  }
}

/** 提交表单 */
const handleSubmit = async () => {
  if (!form.value.name.trim()) {
    toast.error('请输入角色名称')
    return
  }

  submitting.value = true
  try {
    const result = await useApiFetch(`/api/v1/admin/roles/${roleId.value}`, {
      method: 'PUT',
      body: {
        name: form.value.name.trim(),
        description: form.value.description.trim() || null,
        status: statusEnabled.value ? 1 : 0,
      },
    })

    if (result) {
      toast.success('保存成功')
      navigateTo('/admin/roles')
    }
  } finally {
    submitting.value = false
  }
}

// 初始加载
onMounted(() => {
  loadRole()
})
</script>
