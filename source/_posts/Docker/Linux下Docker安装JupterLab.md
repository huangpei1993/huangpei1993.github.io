---
title: Linux下Docker安装JupterLab
categories: 
- Linux
tags:
- Linux
- Docker
- JupterLab
---
## **Linux下Docker安装JupterLab**

# 拉取docker镜像

```bash
docker pull jupyter/base-notebook:latest
```
[https://jupyter-docker-stacks.readthedocs.io/en/latest/using/selecting.html](https://jupyter-docker-stacks.readthedocs.io/en/latest/using/selecting.html)
## 启动参数

```bash
docker run -d \
    --user root \
	-p 9510:8888 \
	-e JUPYTER_ENABLE_LAB=yes \
    -v /home/hp/jupyter:/home/jovyan/work \
    --name jupyter_lab \
    jupyter/minimal-notebook:latest \
    start-notebook.sh \
    --NotebookApp.password='argon2:$argon2id$v=19$m=10240,t=10,p=8$mc/yVgXn0YmLqw13rdzb2w$XECu8Nua+gs9o1kY2hkFpWoyMeYBgfIzr72nkHRFAh4' \
    --NotebookApp.allow_password_change=False \
    --NotebookApp.allow_remote_access=True \
    --NotebookApp.open_browser=False \
    --NotebookApp.notebook_dir="/home/jovyan/work"


```
NotebookApp.password 后面不是跟的明文，需要运行下面两行Python代码设置之后，复制返回值

```bash
from notebook.auth import passwd
passwd()
```
## 修改容器内部pip的镜像地址
### Linux系统：

```bash
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
[install]
trusted-host=http://mirrors.aliyun.com
```
## JupyterLab中配置Git
## 出现的问题
1.新建文件夹时出现:Permission denied: Untitled Folder
   

```bash
chmod 777 jupyter -R
```
