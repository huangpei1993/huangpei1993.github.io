---
title: Windows下使用 Hexo+GitHub 搭建个人免费博客教程
categories: Hexo
tags:
- Hexo
- GitHub
---
## 介绍
### GitHub Pages 是什么？
What is GitHub Pages? - GitHub Help
https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages

GitHub Pages 是由 GitHub 官方提供的一种免费的静态站点托管服务，让我们可以在 GitHub 仓库里托管和发布自己的静态网站页面。
### Hexo 是什么？
官网：hexo.io
Hexo 是一个快速、简洁且高效的静态博客框架，它基于 Node.js 运行，可以将我们撰写的 Markdown 文档解析渲染成静态的 HTML 网页。
### Hexo + GitHub 文章发布原理
在本地撰写 Markdown 格式文章后，通过 Hexo 解析文档，渲染生成具有主题样式的 HTML 静态网页，再推送到 GitHub 上完成博文的发布。

## 环境搭建
Hexo 基于 Node.js，搭建过程中还需要使用 npm（Node.js 已带） 和 git，因此先搭建本地操作环境，安装 Node.js 和 Git。
### 安装nodejs和Git
#### 下载
Node.js：https://nodejs.org/zh-cn
![Node下载界面](./%E4%BD%BF%E7%94%A8HexoAndGitHub%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%85%8D%E8%B4%B9%E5%8D%9A%E5%AE%A2%E6%95%99%E7%A8%8B/nodejs%E4%B8%8B%E8%BD%BD.jpg)
Git：https://git-scm.com/downloads
![Git下载界面_1](./%E4%BD%BF%E7%94%A8HexoAndGitHub%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%85%8D%E8%B4%B9%E5%8D%9A%E5%AE%A2%E6%95%99%E7%A8%8B/git_%E4%B8%8B%E8%BD%BD.png)
![Git下载界面_2](./%E4%BD%BF%E7%94%A8%20Hexo%2BGitHub%20%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%85%8D%E8%B4%B9%E5%8D%9A%E5%AE%A2%E6%95%99%E7%A8%8B/git_%E4%B8%8B%E8%BD%BD_1.png)
#### 安装
下载 Node.js 和 Git 程序并安装，一路点 “下一步” 按默认配置完成安装。
#### 验证安装
安装完成后，Win+R 输入 cmd 并打开，依次输入 node -v、npm -v 和 git --version 并回车，如下图出现程序版本号即可。
#### 更换npm安装源
```bash
npm config set registry http://registry.npm.taobao.org
```
### 连接 Github
1. 如果没有Github账户的话，需要用你的邮箱注册一个账户,并按下图找到自己的用户名，比如我的是huangpei1993
![获取用户名](./%E4%BD%BF%E7%94%A8%20Hexo%2BGitHub%20%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%85%8D%E8%B4%B9%E5%8D%9A%E5%AE%A2%E6%95%99%E7%A8%8B/github_username.png)

2. 在电脑的任何目录下右键 -> Git Bash Here，输入如下命令设置用户名和邮箱
```bash
git config --global user.name "用户名"
git config --global user.email "注册时的邮箱"
```
3. 创建 SSH 密匙
输入 ```bash ssh-keygen -t rsa -C "GitHub 邮箱"```，然后一路回车。
4. 添加密匙
   4.1 进入 [C:\Users\用户名\.ssh] 目录（要勾选显示“隐藏的项目”），用记事本打开公钥 id_rsa.pub 文件并复制里面的内容。
   4.2 登陆 GitHub ，进入 Settings 页面，选择左边栏的 SSH and GPG keys，点击 New SSH key。
   4.3 Title 随便取个名字，粘贴复制的 id_rsa.pub 内容到 Key 中，点击 Add SSH key 完成添加。
![添加SSH密匙_1](./%E4%BD%BF%E7%94%A8%20Hexo%2BGitHub%20%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%85%8D%E8%B4%B9%E5%8D%9A%E5%AE%A2%E6%95%99%E7%A8%8B/1668164769005.jpg)
![添加SSH密匙_2](./%E4%BD%BF%E7%94%A8%20Hexo%2BGitHub%20%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%85%8D%E8%B4%B9%E5%8D%9A%E5%AE%A2%E6%95%99%E7%A8%8B/WX20221111-190751%402x.png)
### 创建 Github Pages 仓库
GitHub 主页右上角加号 -> New repository：
Repository name 中输入 用户名.github.io
勾选 “Initialize this repository with a README”
Description 选填
填好后点击 Create repository 创建。
![创建仓库_1](./%E4%BD%BF%E7%94%A8%20Hexo%2BGitHub%20%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%85%8D%E8%B4%B9%E5%8D%9A%E5%AE%A2%E6%95%99%E7%A8%8B/WX20221111-191106%402x.png)
![](./%E4%BD%BF%E7%94%A8%20Hexo%2BGitHub%20%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%85%8D%E8%B4%B9%E5%8D%9A%E5%AE%A2%E6%95%99%E7%A8%8B/WX20221111-191254%402x.png)
创建后默认自动启用 HTTPS，博客地址为：https://用户名.github.io

### 本地安装 Hexo 博客程序
新建一个文件夹用来存放 Hexo 工程，命名如下 hexo 。打开该文件夹，右键 -> Git Bash Here。
#### 安装 Hexo
使用 npm 一键安装 Hexo 博客程序：
``` bash
npm install -g hexo-cli
```
#### Hexo 初始化和本地预览
1. 初始化Hexo
``` bash
hexo init      # 初始化
```
但是因为网络原因，这个过程会非常慢，我们改用下面的命令
``` bash
git clone https://gitee.com/weilining/hexo-starter.git 你的github用户名.github.io
cd 你的github用户名.github.io
git submodule init
git submodule update
npm i
```
2. 完成后依次输入下面命令，启动本地服务器进行预览：
```bash
hexo g   # 生成页面
hexo s   # 启动预览
```
访问 http://localhost:4000，出现 Hexo 默认页面，本地博客安装成功！
![Hexo预览界面](./%E4%BD%BF%E7%94%A8%20Hexo%2BGitHub%20%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%85%8D%E8%B4%B9%E5%8D%9A%E5%AE%A2%E6%95%99%E7%A8%8B/v2-1c3baeecf1ef3bec5c8ef3f14639f68b_1440w.webp.jpeg)
3. 预览完成后，记得在命令行床后使用 Ctrl+C 关闭服务器

Tips：如果出现页面加载不出来，可能是端口被占用了。Ctrl+C 关闭服务器，运行 hexo server -p 5000 更改端口号后重试。

#### Hexo 博客文件夹目录结构
![Hexo 博客文件夹目录结构](./%E4%BD%BF%E7%94%A8%20Hexo%2BGitHub%20%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%85%8D%E8%B4%B9%E5%8D%9A%E5%AE%A2%E6%95%99%E7%A8%8B/WX20221111-185545%402x.png)

### 部署 Hexo 到 GitHub Pages
本地博客测试成功后，就是上传到 GitHub 进行部署，使其能够在网络上访问。
首先安装 hexo-deployer-git：
```bash
npm install hexo-deployer-git --save
```
然后修改 _config.yml 文件末尾的 Deployment 部分，修改成如下：
```bash
deploy:
  type: git
  repository: git@github.com:用户名/用户名.github.io.git
  branch: master
```
完成后运行 ```bash hexo d``` 将网站上传部署到 GitHub Pages。

完成！这时访问我们的 GitHub 域名 https://用户名.github.io 就可以看到 Hexo 网站了，如果出现404页面，可以稍等1分钟后刷新页面。

## 开始使用
### 发布文章
1. 进入博客所在目录(即 用户名.github.io)，右键打开 Git Bash Here，创建博文
```bash
hexo new "My New Post"
```
2. 然后 source 文件夹中会出现一个 My New Post.md 文件，就可以使用 Markdown 编辑器在该文件中撰写文章了。
3. 写完后运行下面代码将文章渲染并部署到 GitHub Pages 上完成发布。以后每次发布文章都是这三条条命令。
```bash
hexo clean # 清空上次生成的文件，防止修改了文件后不生效
hexo g   # 生成页面
hexo d   # 部署发布
```
4. 也可以不使用命令自己创建 .md 文件，只需在文件开头手动加入如下格式 Front-matter 即可，写完后运行 hexo g 和 hexo d 发布。
```bash
---
title: Hello World # 标题
date: 2019/3/26 hh:mm:ss # 时间
categories: # 分类
- Diary
tags: # 标签
- PS3
- Games
---

摘要
<!--more-->
正文
```
### 网站设置
包括网站名称、描述、作者、链接样式等，全部在网站目录下的 _config.yml 文件中，参考【官方文档https://hexo.io/zh-cn/docs/configuration】按需要编辑。

### 更换主题
1. 可以看到，默认的Hexo个人界面是比较单调的，这时候我们可以使用别人已经做好的主题，给你的个人主页“装修”一番
2. 在 【Themes | Hexo https://hexo.io/themes/】 选择一个喜欢的主题，比如我使用的是 hexo-theme-matery，进入网站目录(即 用户名.github.io)打开 Git Bash Here 下载主题：
```bash
git clone git clone https://github.com/blinkfox/hexo-theme-matery.git themes/hexo-theme-matery
```
如果github用不了，可以使用我搬运的仓库
```bash
https://gitee.com/huangpei1993/hexo-theme-matery.git themes/hexo-theme-matery
```
然后修改 _config.yml 中的 theme 为新主题名称 hexo-theme-matery，发布。
3. 预览新主题
```bash
hexo g   # 生成页面
hexo s   # 启动预览
```
确认修改好之后，就可以部署到github主页上去了
```bash
hexo clean # 清空上次生成的文件，防止修改了文件后不生效
hexo g   # 生成页面
hexo d   # 部署发布
```
效果如下
![](./%E4%BD%BF%E7%94%A8HexoAndGitHub%E6%90%AD%E5%BB%BA%E4%B8%AA%E4%BA%BA%E5%85%8D%E8%B4%B9%E5%8D%9A%E5%AE%A2%E6%95%99%E7%A8%8B/WX20221111-191953%402x.png)
4. 对新主题进行自定义
该主题的作者对怎样修改他的主题做了非常详细的说明，详情请参考
github: https://github.com/blinkfox/hexo-theme-matery
gitee: https://gitee.com/huangpei1993/hexo-theme-matery
但是要注意一点，在如下图的主题配置项之后的内容需要在 用户名.github.io/themes/hexo-theme-matery 目录下的_config.yml进行配置！！！！！

最后配置好之后不要忘记部署发布上github

## 我的个人网站和Hexo项目
个人网站：https://huangpei1993.github.io
Hexo项目仓库地址：https://gitee.com/huangpei1993/huangpei1993.github.io

如果你有任何的建议、意见或问题，欢迎随时和我联系。

## 你可能还需要的内容
1. 将Hexo工程代码上传到Gitee或Github仓库，防止本地项目代码丢失
2. 如何使用Markdown编写你的博客

## 参考
https://zhuanlan.zhihu.com/p/60578464
https://www.jianshu.com/p/a409601734f1