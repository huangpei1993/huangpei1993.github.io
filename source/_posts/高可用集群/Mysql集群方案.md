---
title: Mysql集群方案
date: 2025-09-21 00:19:45
tags:
---

## MySQL高可用核心目标

在部署前，必须明确高可用方案的目标：

1. **数据一致性**：确保集群中所有节点的数据是一致的，这是最重要的前提。
2. **高可用性**：在主节点发生故障时，能自动或快速手动切换到备用节点，减少服务中断时间（RTO - 恢复时间目标）。
3. **容错性**：能够容忍部分节点、网络分区等故障。
4. **可扩展性**：部分方案支持扩展，能轻松添加只读副本。
5. **性能影响**：方案本身对数据库性能的影响尽可能小。

## 主流高可用集群部署方案详解 

以下是几种主流方案的详细部署介绍和对比

## 方案一：基于复制（Replication）的半同步复制 + MHA （Master High Availability）

这是一种经典且成熟的“组合拳”方案，结合了MySQL原生功能和第三方工具

### 1. 架构组件

**MySQL 主从复制：** 基础是标准的**异步复制**或**半同步复制**（推荐半同步，确保数据更强的一致性）。
**MHA Node：** 数据节点，运行在每个 MYSQL 服务器上。

### 2. 部署步骤简介

**搭建主从复制：** 配置一个主库（Master）和至少两个从库（Slave），建议采用半同步复制。

**配置SSH互信：** 确保 MHA Manager 可以无密码登陆到所有节点。

**安装MHA Node：** 在所有 MySQL服务器上安装 MHA Node包。

### 3. 安装配置 MHA Manager

- 创建配置文件 `app1.conf`，定义集群节点、复制用户、监控用户等。
- 示例配置：

```conf
[server default]
manager_log=/var/log/masterha/app1.log
manager_workdir=/var/log/masterha/app1
master_binlog_dir=/var/lib/mysql
user=mha_user
password=mha_password
ssh_user=root
repl_user=repl_user
repl_password=repl_password
ping_interval=1

[server1]
hostname=master_ip
candidate_master=1

[server2]
hostname=slave1_ip
candidate_master=1

[server3]
hostname=slave2_ip
no_master=1 # 仅作为备用，不优先提升为主
```

### 4. 启动MHA：使用 `masterha_manager` 命令启动监控

#### 故障切换流程

- MHA Manager 定期 Ping Master。
- 发现 Master 宕机后，选择数据最新的 Slave 作为新 Master。
- 通过其他 Slave 上保存的 Relay Log 补全差异数据。
- 改变其他 Slave 指向新 Master，并完成切换。

#### 问：宕机的主节点恢复后，是否会抢回主节点，还是变为从节点？

### 5. 优缺点

- **优点：**
  - 成熟稳定，社区广泛应用。
  - 故障转移速度快（通常10-30秒）。
  - 能最大程度保证数据一致性（补全Relay Log）。
  - 对现有架构侵入性小，主要在应用层。

- **缺点：**
  - 需要自行部署和管理多个组件，复杂度较高。
  - VIP 飘移或应用连接切换需要配合脚本（如：`master_ip_failover`）。
  - MHA 仅负责故障转移，不提供读写分离和负载均衡（需配合 ProxySQL/HAProxy等）。

## 方案二：Galera Cluster(PXC,Percona XtraDB Cluster)

这是一个真正的多主（Multi-Master）同步复制集群方案

### 1. 架构组建

- **Percona Server for MySQL 或 MariaDB Server：** 数据库本身。
- **Galera Library：** 提供同步复制的核心库，基于 WSREP API。
- **至少三个节点：** 基于 Quorum 机制，防止”脑裂“。

### 2. 部署步骤简介

1. **安装 Percona XtraDB Cluster：** 在所有节点上安装 PXC 软件包。

2. **配置第一个节点（引导节点）：**

    ```conf
    [mysqld]
    wsrep_provider=/usr/lib/libgalera_smm.so
    wsrep_cluster_name=pxc-cluster
    wsrep_cluster_address=gcomm:// # 初始化为第一个节点
    wsrep_node_address=node1_ip
    wsrep_sst_method=xtrabackup-v2
    wsrep_sst_auth="sst_user:sst_password"
    binlog_format=ROW
    default_storage_engine=InnoDB
    innodb_autoinc_lock_mode=2
    ```

3. **启动第一个节点：** 使用 `systemctl start mysql@bootstrap.service` 以引导模式启动。

4. **配置并启动其他节点：**