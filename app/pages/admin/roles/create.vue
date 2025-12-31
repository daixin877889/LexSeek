<template>
  <NuxtLayout name="admin-layout">
    <div class="space-y-6 max-w-2xl">
      <!-- 页面标题 -->
      <div>
        <h1 class="text-2xl font-bold">创建角色</h1>
        <p class="text-muted-foreground">创建新的系统角色</p>
      </div>

      <!-- 表单 -->
      <Card class="shadow-none">
        <CardContent class="pt-6">
          <form @submit.prevent="handleSubmit" class="space-y-6">
            <div class="space-y-2">
              <Label for="name">角色名称 <span class="text-destructive">*</span></Label>
              <Input id="name" v-model="form.name" placeholder="请输入角色名称" />
            </div>

            <div class="space-y-2">
              <Label for="code">角色标识 <span class="text-destructive">*</span></Label>
              <Input id="code" v-model="form.code" placeholder="请输入角色标识（英文、下划线）" />
              <p class="text-xs text-muted-foreground">角色标识用于程序识别，创建后不可修改</p>
            </div>

            <div class="space-y-2">
              <Label for="description">描述</Label>
              <Textarea id="description" v-model="form.description" placeholder="请输入角色描述" rows="3" />
            </div>

            <div class="space-y-2">
              <Label>状态</Label>
              <div class="flex items-center space-x-2">
                <Switch id="status" v-model:checked="statusEnabled" />
                <Label for="status" class="font-normal">{{ statusEnabled ? '启用' : '禁用' }}</Label>
              </div>
            </div>

            <div class="flex gap-4 pt-4">
              <Button type="submit" :disabled="submitting">
                <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                创建角色
              </Button>
              <Button type="button" variant="outline" @click="navigateTo('/admin/roles')">
                取消
              </Button>
            </div>
          </form>
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
  title: "创建角色",
})

/** 表单数据 */
const form = ref({
  name: '',
  code: '',
  description: '',
})

/** 状态开关 */
const statusEnabled = ref(true)

/** 提交状态 */
const submitting = ref(false)

/** 提交表单 */
const handleSubmit = async () => {
  // 验证
  if (!form.value.name.trim()) {
    toast.error('请输入角色名称')
    return
  }
  if (!form.value.code.trim()) {
    toast.error('请输入角色标识')
    return
  }
  if (!/^[a-z_]+$/.test(form.value.code)) {
    toast.error('角色标识只能包含小写字母和下划线')
    return
  }

  submitting.value = true
  try {
    const result = await useApiFetch('/api/v1/admin/roles', {
      method: 'POST',
      body: {
        name: form.value.name.trim(),
        code: form.value.code.trim(),
        description: form.value.description.trim() || null,
        status: statusEnabled.value ? 1 : 0,
      },
    })

    if (result) {
      toast.success('创建成功')
      navigateTo('/admin/roles')
    }
  } finally {
    submitting.value = false
  }
}
</script>
