---
title: Redis持久化
date: 2024-07-08 14:43:50
tags: Redis
categories: Redis
---
## Redis持久化
### RDB快照（snapshot）
在默认情况下，Redis将内存数据库

### bgsave的写时复制(COW)机制

**save与bgsave对比**

### AOF（append-only file）
```
# appendonly yes  # 打开这个配置即开启AOF
```
有三个策略可以配置：
```
appendfsync always:
appendfsync everysec:
appendfsync no:
```
推荐（并且也是默认）的措施为每秒fsync一次，这种fsync策略可以兼容可以兼顾速度和安全性
#### AOF重写
AOF文件里可能

如下两个配置可以控制AOF的自动重写频率
```
# auto-aof-rewrite-min-size 64mb
# auto-aof-rewrite-percentage 100
```

**RDB和AOF，我应该用哪一个**
命令|RDB|AOF
---|---|---|
启动优先级|低|高
体积|小|大
恢复速度|快|慢
数据安全性|容易丢失|根据策略决定
### Redis 4.0 的混合持久化
通过如下配置可以开启混合持久化(**必须先开启aof**):
```
# aof-use-rdb-preamble yes
```
#### Redis数据备份策略
1. 写crontab定时调度脚本，每小时都copy一份rdb或aof的备份到一个目录中去，仅仅保留最近48小时的备份
2. 每天都保留
3. 
4. 