---
title: Mac下vscode+vim的一些快捷键
date: 2025-02-24 08:00:22
tags:
---

## setting.json中的配置


```json
// 控制资源管理器中的键盘导航无法自动触发
"workbench.list.automaticKeyboardNavigation": false,

// 绑定vim前导键
   "vim.leader": "<space>",
   // 启用easymotion插件
   "vim.easymotion": true,
   // 启用系统粘贴板作为vim寄存器
   "vim.useSystemClipboard": true,
   // 由vim接管ctrl+any的按键，而不是vscode
   "vim.useCtrlKeys": true,
   // 突出显示与当前搜索匹配的所有文本
   "vim.hlsearch": true,
    // 普通模式下的非递归按键绑定
   "vim.normalModeKeyBindingsNonRecursive": [],
    // 插入模式下的非递归按键绑定
   "vim.insertModeKeyBindings": [],
   // 命令模式下的非递归按键绑定
   "vim.commandLineModeKeyBindingsNonRecursive": [],
   // 可视模式下的非递归按键绑定
   "vim.operatorPendingModeKeyBindings": [],
   // 下面定义的按键将交由vscode进行处理，而不是vscode-vim插件
   "vim.handleKeys": {
     "<C-a>": false,
     "<C-f>": false
   }

```

可以定义在按下一些按键后，调用vscode下的命令API，比如在NORMAL模式下按下<leader>gc后，调用vscode的全局命令：
```json
   "vim.normalModeKeyBindingsNonRecursive": [
     {
       "before": [
         "<leader>",
         "g",
         "c"
       ],
       "commands": [
         "workbench.action.showCommands"
       ]
     }
   ],
```


## 参考

[vscode + vim 全键盘操作高效搭配方案](https://zhuanlan.zhihu.com/p/430603620)