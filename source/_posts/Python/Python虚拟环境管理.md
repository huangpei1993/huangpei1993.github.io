---
title: Python虚拟环境管理
categories: Python
tags:
- Python
---
# Python虚拟环境管理
## 1.安装
python3.6及以上已经默认安装，python3.5需要通过系统的包管理工具安装：

```bash
sudo apt install python3-venv
```
## 2.创建虚拟环境
选择一个合适的文件夹(如~/test_env)，使用如下命令创建一个虚拟环境test_env

```bash
python3 -m venv test_env
```
## 3.启用虚拟环境
在Linux和Mac环境下，执行下面的命令：

```bash
source ~/test_env/bin/activate
```
在Windows环境下，执行下面的命令:
```bash
.\test_env\bin\activate.bat
```
## 4.退出虚拟环境
退出虚拟的python环境，在命令行执行下面的命令即可：
```bash
deactivate
```
## 5.删除虚拟环境
直接删除虚拟环境所在文件夹即可
## 6.VSCode中切换虚拟环境运行
使用vscode的python environments插件进行切换即可
