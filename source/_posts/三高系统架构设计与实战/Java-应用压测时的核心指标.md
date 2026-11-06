---
title: Java 应用压测时的核心指标
date: 2026-11-06 16:45:37
categories: 高并发系统
tags:
    - 高并发系统 
    - 压测指标
---
压测不仅要知道系统能承受多少并发，更重要的是能够通过监控指标，定位系统瓶颈，判断性能拐点，并验证优化效果。

## Java 应用压测的核心指标

### 应用性能指标

这些指标用于衡量 Java 应用整体的吞吐能力和响应速度。

|指标|	作用|	重点关注|
|---|---|---|
|QPS|	每秒处理的请求数|	最大稳定 QPS|
|TPS|	每秒完成的业务事务数|	最大稳定 TPS|
|平均响应时间|	请求的平均处理耗时|	随并发增长的变化|
|P95 响应时间	|95% 请求的响应时间不超过该值|	尾部请求延迟|
|P99 响应时间|	99% 请求的响应时间不超过该值|	长尾延迟|
|错误率	|请求失败的比例|	5xx、超时、业务失败|
|并发请求数|	同时正在处理的请求数|	是否接近系统容量上限|

其中，QPS、P99、错误率是最值得关注的三个指标。

### JVM 内存指标

| 指标 | 含义 | 关注点 |
|---|---|---|
| Heap Used | 堆内存已使用量 | 是否持续增长 |
| Heap Committed | JVM 已申请的堆内存 | JVM 内存扩张情况 |
| Old Gen Used | 老年代使用量 | Full GC 风险、内存泄漏 |
| Eden Used | Eden 区使用量 | 对象创建和回收情况 |
| Metaspace Used | 元空间使用量 | 类加载、动态生成类 |
| Direct Memory | 堆外直接内存使用量 | NIO、Netty 内存 |
| Allocation Rate | 每秒对象分配量 | 对象创建压力 |

重点关注两个指标：
- **Old Gen Used**：如果每次 GC 后老年代内存仍然不断增长，需要排查长期存活对象及潜在内存泄漏。
- **Allocation Rate**：如果每秒分配大量临时对象，可能造成频繁 Young GC，增加 CPU 消耗和响应延迟。

### GC 指标

GC 对 Java 应用的性能影响非常重要。

| 指标 | 含义 | 关注点 |
|---|---|---|
| Young GC Count | Young GC 次数 | 是否频繁 |
| Young GC Pause | Young GC 暂停时间 | 是否影响响应时间 |
| Full GC Count | Full GC 次数 | 是否出现异常 Full GC |
| Full GC Pause | Full GC 暂停时间 | 是否发生长时间停顿 |
| GC Time Ratio | GC 时间占总运行时间的比例 | GC 开销是否过高 |
| GC Reclaimed Memory | GC 回收内存量 | 内存回收效率 |

例如，压测期间如果出现：
- QPS 从 5000 降到 2000。
- P99 从 100ms 升到 1000ms。
- 同期出现一次 800ms 的 GC 暂停。

那么 GC 就是需要优先调查的原因之一。

但要注意，GC 暂停与延迟尖峰同时出现只能说明存在相关性，还需要通过 GC 日志、JFR 等进一步确认。

### CPU 与线程指标

| 指标 | 含义 | 关注点 |
|---|---|---|
| Process CPU Usage | Java 进程 CPU 使用率 | 应用是否 CPU 密集 |
| System CPU Usage | 系统整体 CPU 使用率 | 服务器是否资源不足 |
| Live Thread Count | 当前存活线程数 | 是否不断增加 |
| Runnable Threads | 可运行线程数 | 是否存在 CPU 竞争 |
| Blocked Threads | 等待进入 synchronized 的线程数 | 是否存在锁竞争 |
| Waiting Threads | 等待中的线程数 | 是否存在大量等待 |
| Thread Deadlock | 线程死锁 | 是否出现死锁 |

例如：

如果 CPU 使用率长期接近容器可用 CPU 上限，同时 Runnable 线程很多，说明可能存在 CPU 竞争或计算热点。

如果 CPU 使用率不高，但是 P99 非常高，那么应重点检查：
- 线程池任务排队
- 数据库连接池等待
- synchronized 锁竞争
- Redis、MySQL 等外部服务响应缓慢
- 网络 IO 等待
此时可以通过 jstack、jcmd、JFR 或 async-profiler 进一步分析。

### 线程池与 Web 容器指标

对于 Spring Boot 应用，尤其是使用 Tomcat 的服务，这部分非常重要。

| 指标 | 含义 |
|---|---|
| Busy Threads | Tomcat 正在处理请求的线程数 |
| Current Threads | Tomcat 当前线程总数 |
| Max Threads | Tomcat 最大工作线程数 |
| Active Threads | 业务线程池正在执行任务的线程数 |
| Queue Size | 线程池等待队列长度 |
| Rejected Task Count | 线程池拒绝任务数 |
| Task Execution Time | 线程池任务执行耗时 |

假设 Tomcat 最大线程数配置为 200。

压测过程中：
- Tomcat Busy Threads = 200
- CPU 使用率 = 40%
- QPS 不再增加
- P99 持续升高

这说明 Tomcat 工作线程可能已经成为并发限制因素。

但不能直接通过增加 `maxThreads` 解决问题，还需要判断工作线程是否**大量等待数据库、Redis 或其他下游服务**。

### 数据库连接池指标

以 Spring Boot 常用的 Druid 为例：

| Druid 指标 | 含义 | 压测关注点 |
|---|---|---|
| `ActiveCount` | 当前活跃连接数 | 是否持续接近 `MaxActive` |
| `PoolingCount` | 当前空闲连接数 | 是否长期为 0 |
| `WaitThreadCount` | 当前等待获取连接的线程数 | 是否持续增长 |

## 常见问题的排查思路

### CPU占用异常的高

