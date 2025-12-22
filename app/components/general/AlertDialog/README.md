# 通用组件 (General Components)

## AlertDialog 全局确认对话框组件

### 组件说明

该组件用于显示全局确认对话框，支持成功和错误两种样式，可通过Pinia状态管理来控制其显示和隐藏。

### 特点

- 支持成功和错误两种样式
- 支持自定义标题和内容
- 支持自定义确认和取消按钮文本
- 支持确认和取消回调函数
- 可选择是否显示取消按钮

### 如何使用

1. 首先在App.vue或布局组件中引入该组件

```vue
<template>
  <div>
    <!-- 其他页面内容 -->
    <AlertDialog />
  </div>
</template>

<script setup>
import AlertDialog from '@/components/general/AlertDialog';
</script>
```

2. 在需要显示确认对话框的地方通过状态管理来控制显示

```js
import { useAlertDialogStore } from '@/stores';

// 获取确认对话框store
const alertDialogStore = useAlertDialogStore();

// 显示确认对话框
const showConfirmDialog = () => {
  alertDialogStore.showDialog({
    title: '确认操作',
    message: '您确定要执行此操作吗？',
    onConfirm: () => {
      // 确认后的处理逻辑
      console.log('用户确认了操作');
    },
    onCancel: () => {
      // 取消后的处理逻辑
      console.log('用户取消了操作');
    }
  });
};

// 显示错误确认对话框
const showDeleteConfirm = () => {
  alertDialogStore.showErrorDialog({
    title: '删除确认',
    message: '此操作将永久删除数据，且无法恢复。是否继续？',
    confirmText: '确认删除',
    onConfirm: () => {
      // 确认删除的处理逻辑
      console.log('用户确认了删除操作');
    }
  });
};
```

3. 可以为任何元素添加点击事件来触发确认对话框

```vue
<button @click="showConfirmDialog">确认操作</button>
<button @click="showDeleteConfirm">删除数据</button>
```

### API

#### 状态管理

确认对话框组件使用 `useAlertDialogStore` 来管理显示状态：

```js
import { useAlertDialogStore } from '@/stores';
const alertDialogStore = useAlertDialogStore();
```

#### 可用方法

| 方法名 | 描述 | 参数 |
| ---- | ---- | ---- |
| showDialog | 显示确认对话框 | options: Object |
| showSuccessDialog | 显示成功样式的确认对话框 | options: Object |
| showErrorDialog | 显示错误样式的确认对话框 | options: Object |
| hideDialog | 隐藏确认对话框 | 无 |
| handleConfirm | 处理确认操作 | 无 |
| handleCancel | 处理取消操作 | 无 |

#### options参数说明

| 参数名 | 类型 | 描述 | 默认值 |
| ---- | ---- | ---- | ---- |
| title | String | 对话框标题 | '提示' |
| message | String | 对话框内容 | '' |
| type | String | 对话框类型：'success'或'error' | 'success' |
| confirmText | String | 确认按钮文本 | '确认' |
| cancelText | String | 取消按钮文本 | '取消' |
| showCancel | Boolean | 是否显示取消按钮 | true |
| onConfirm | Function | 确认按钮点击回调 | null |
| onCancel | Function | 取消按钮点击回调 | null |
