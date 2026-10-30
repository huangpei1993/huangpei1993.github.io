---
title: SpringBoot 使用 Caffeine 本地缓存
date: 2026-10-30 16:26:57
catagories: 高并发系统
tags:
    - Caffeine
    - 缓存
    - 学习笔记
    - 高性能
---

## 缓存组件 Caffeine 介绍
Caffeine 是当前 Java 生态中性能最优的进程内缓存库，Spring Framework 5.x 起已将默认缓存实现从 Guava Cache 切换为 Caffeine。它的核心价值在于近乎最优的命中率与极低的读写延迟：读操作全程无锁，命中路径仅经过 `ConcurrentHashMap.get` 与过期检查，开销在纳秒级别。

Caffeine 并不是 Spring Boot 的“默认缓存”。在没有引入任何缓存库时，Spring Boot 配置的是一个无淘汰、无过期能力的 `ConcurrentHashMap` 管理器，实质上是带注解的内存泄漏隐患。Caffeine 之所以“接管”，是因为你显式将它加入了 `classpath。`

## 淘汰策略：W-TinyLFU

传统 LRU 无法应对周期性全表扫描（热点数据被冲走），传统 LFU 无法应对突发流量（旧热点永久占位）。W-TinyLFU 将两者结合，使用三段式队列结构实现：
|区域|占比（默认）|淘汰策略|作用|
|---|---|---|---|
|Window（Eden）|~1%|严格LRU|承接新写入数据，给突发流量存活的机会|
|Main-Probation（适用区）|~20%|LRU|新数据淘汰竞争的“待定区”|
|Main-Protected（保护区）|~79%|LRU|存放真正的高频热点|

**数据流转逻辑**：新数据先进入 Window；Window 满后，队尾候选者必须与 Main-Probation 队尾的“受害者”进行**频率 PK**，只有 `FrequencySketch` 中记录的访问频率更高时，候选者才被准入 Main 区，否则直接丢弃。频率记录使用 Count-Min Sketch（概率型计数结构），每个 key 的频率压缩到约 4 bit，避免了传统 LFU 用 HashMap 记录频率带来的内存膨胀。同时，频率计数器会周期性衰减（所有记录减半），防止历史热点永久占据空间。

## 读写路径无锁化

Caffeine 的读写快，不是因为 W-TinyLFU 在命中路径上做了什么，而是因为命中路径上根本没有淘汰逻辑。W-TinyLFU 解决的是“容量压力下淘汰谁”的问题，而命中路径的性能来自彻底的读写分离。

- 读路径：业务线程从 `ConcurrentHashMap` 取出数据后，仅将这次访问事件写入一个分条环形数组（条带数 ≈ CPU 核数，CAS 入队），然后立即返回。读线程从不等待维护逻辑。
- 写路径：事件进入 MPSC 队列，由 Caffeine 内部的单一维护线程异步批量消费，在独享锁的前提下更新频率 sketch 和队列指针。
- 有损记录：如果 RingBuffer 被打满，读线程会直接丢弃该次访问记录而不阻塞。在足够大的访问基数下，少量记录的丢失对宏观频率统计影响可忽略，这是用统计精度换取绝对吞吐。

这一架构使 Caffeine 在高并发下的 p99 延迟表现显著优于基于加锁维护链表的方案；

## 在 Spring Boot 中配置 Caffeine

### 依赖引入

```maven
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-cache</artifactId>
</dependency>
<dependency>
    <groupId>com.github.ben-manes.caffeine</groupId>
    <artifactId>caffeine</artifactId>
</dependency>
```
Caffeine 版本由 Spring Boot BOM 管理，无需手写 `<version>`。注意版本与 JDK 的对应关系：Caffeine 3.x 要求 Java 11+，Java 8 项目应使用 2.x 系列。

### 最小配置（属性方式）

```yaml
spring:
  cache:
    type: caffeine
    cache-names: products,users
    caffeine:
      spec: maximumSize=500,expireAfterAccess=600s
```

`spec` 字符串适用于 `CaffeineSpec` 能表达的值参数。一旦需要 `weigher`、`removalListener`、自定义 `Expiry` 或独立 `Executor`，属性方式即不再够用，必须转向编程式配置。

### 编程式配置

```java
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public CaffeineCacheManager cacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager();
        manager.setCaffeine(Caffeine.newBuilder()
                .maximumSize(10_000)
                .expireAfterWrite(Duration.ofMinutes(10))
                .expireAfterAccess(Duration.ofMinutes(30))
                .recordStats());
        return manager;
    }
}
```

如果调用 `setCacheNames(...)`，缓存集合在启动时固定，请求未知名称返回 `null`；不设置则按需惰性创建，这在开发期方便，但在生产环境会静默掩盖 `@Cacheable` 中的拼写错误（拼错的缓存名会悄悄创建一个新缓存，而不是报错）。

### 多缓存差异化配置

`spring.cache.caffeine.spec` 或全局 `setCaffeine(...)` 会无差别应用到该 `manager` 管理的所有缓存。比如，商品需要缓存30分钟，而库存缓存可能只需要1分钟，用同一套 TTL 和容量会造成配置漂移。

解决方案是`registerCustomCache`：
```java
@Bean
public CaffeineCacheManager cacheManager() {
    CaffeineCacheManager manager = new CaffeineCacheManager();
    // 全局默认：未单独注册的缓存使用这套配置
    manager.setCaffeine(Caffeine.newBuilder()
            .maximumSize(1_000)
            .expireAfterWrite(Duration.ofMinutes(5))
            .recordStats());

    manager.registerCustomCache("product",
            Caffeine.newBuilder()
                    .maximumSize(200)
                    .expireAfterWrite(Duration.ofSeconds(30))
                    .recordStats()
                    .build());

    manager.registerCustomCache("skuStock",
            Caffeine.newBuilder()
                    .maximumSize(500)
                    .expireAfterWrite(Duration.ofHours(24))
                    .recordStats()
                    .build());
    return manager;
}
```

需要注意以下两点：
- 每个 registerCustomCache 需要自己的 recordStats()，不继承全局 builder。
- 差异化配置是按缓存名称的，不是按条目，Spring 的 @Cacheable 抽象无法表达“这个 value 缓存 5 分钟、那个 value 缓存 1 小时”。


### 按条目设置过期时间（Per-Entry TTL）

上一小节解决的是缓存之间的差异化，在同一份缓存内部，不同条目的合理存活时长也可能相差悬殊：一批 OAuth token 各自带有不同的 `expiresIn`，同一类资源有的 30 秒就应失效、有的可以缓存数小时。这类需求无法通过缓存名或静态 TTL 表达，需要 Caffeine 的 `Expiry` 接口。

### 为什么这条路必须绕开 @Cacheable

`@Cacheable` 是"把方法返回值按 key 存起来"，它没有、也不打算提供让方法在返回结果时附带"该结果应缓存多久"的通道。`Expiry` 的三个回调只能看到 key 和 value，看不到方法执行时的请求参数、上下文或分支状态。因此按条目 TTL 的标准做法是：对这部分数据放弃 @Cacheable，直接持有原生 Cache，把 TTL 推导逻辑内化进 `Expiry`。

两者可以在同一项目中共存——@Cacheable 管理常规缓存，原生 Cache 管理需要条目级 TTL 的缓存，互不干扰。

```java
@Component
public class TokenCacheService {

    private final Cache<String, Token> cache;

    public TokenCacheService() {
        this.cache = Caffeine.newBuilder()
                .maximumSize(10_000)          // 容量上限仍然生效，与 TTL 是两套独立机制
                .recordStats()                 // 观察 EXPIRED 淘汰原因时必须开启
                .expireAfter(new Expiry<String, Token>() {

                    @Override
                    public long expireAfterCreate(String key, Token token, long currentTime) {
                        // token 自带 expiresIn（秒），直接作为该条目的存活时长
                        return TimeUnit.SECONDS.toNanos(token.getExpiresIn());
                    }

                    @Override
                    public long expireAfterUpdate(String key, Token token,
                                                  long currentTime, long currentDuration) {
                        // token 被刷新后，按新的 expiresIn 重新计时
                        return TimeUnit.SECONDS.toNanos(token.getExpiresIn());
                    }

                    @Override
                    public long expireAfterRead(String key, Token token,
                                                long currentTime, long currentDuration) {
                        // 读取不延长：token 的过期时间由签发方决定，与访问频率无关
                        return currentDuration;
                    }
                })
                .build();
    }

    public Token get(String tokenKey, Function<String, Token> loader) {
        return cache.get(tokenKey, loader);   // 未命中时原子加载并写入
    }

    public void evict(String tokenKey) {
        cache.invalidate(tokenKey);
    }

    public CacheStats stats() {
        return cache.stats();
    }
}
```

几个关键点：

- 返回值单位是纳秒。Expiry 三个回调的返回类型都是 long（纳秒），用 TimeUnit.SECONDS.toNanos(...) 换算，不要直接把秒数返回，否则条目会在几十纳秒内过期。
- currentDuration 的语义是"该条目当前剩余存活时长"，而不是"已经存活了多久"。返回它即表示"本次操作不改变过期点"；返回一个新的时长则会覆盖原过期点。
- maximumSize 与条目级 TTL 同时生效，二者互不替代：TTL 到期的条目按 EXPIRED 淘汰，容量压力下被挤出的条目按 SIZE 淘汰。通过 stats().evictionCount() 与 evictionWeight() 可以区分两类压力，判断到底是 TTL 太短还是容量不够。

**需要注意的是**：TTL 信息只能从 value 中推导
expireAfterCreate 只能拿到 key 和 value。如果某个条目的 TTL 依赖于方法参数或请求上下文，而这一信息既不在 key 里、也不在 value 里，那么 Expiry 无法感知。此时可选的两条路：

方案 A：把 TTL 信息编码进 value 或 key。 例如缓存对象本身包含 ttlSeconds 字段，Expiry 从中读取。这是最干净的方案，但需要侵入缓存对象的类型定义。

方案 B：走 cache.put 手动写入，并通过包装类型把 TTL 传给 Expiry。 例如定义一个 record Entry<V>(V value, long ttlNanos)，缓存 value 类型为 Entry<V>，Expiry 从 Entry.ttlNanos() 取时长，读取时业务侧再拆包。相比方案 A，它把 TTL 外挂到缓存值上而不污染业务对象。

需要避免的一种错误直觉是：以为在 cache.get(key, loader) 的 loader 内部可以"临时传一个 TTL 给 Expiry"。Expiry 的回调签名是固定的，loader 与 Expiry 之间没有共享通道，这种设想在当前 API 下行不通。

## 在项目中的使用方式

### 基于注解（Spring Cache 抽象）

```java
@Service
public class ProductService {

    @Cacheable(value = "products", key = "#id", sync = true)
    public Product findById(Long id) {
        return productRepository.findById(id).orElseThrow();
    }

    @CacheEvict(value = "products", key = "#id")
    public void update(Long id, UpdateRequest request) { ... }

    @CacheEvict(value = "products", allEntries = true)
    public void clearAll() { ... }
}
```

两个容易忽略但关键的参数：

- sync = true：当 key 计算代价高且访问集中时，不设 sync 会让热点 key 未命中时所有并发调用者同时穿透到源端（惊群）。设 sync = true 后，一个调用者负责加载，其余等待该结果。

- key 显式声明：不指定 key 时 Spring 使用 SimpleKeyGenerator，不同方法的同形参数可能在共享缓存名下产生键碰撞。跨方法共享缓存时务必用 SpEL 区分。

### 原生 Caffeine API（需要精细控制时）

```java
Cache<Long, User> cache = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofMinutes(10))
        .recordStats()
        .build();

User user = cache.get(userId, id -> userRepository.findById(id));
```

Cache.get(key, mappingFunction) 在未命中时执行加载函数并原子写入，比手动 getIfPresent + put 更安全。

### refreshAfterWrite的“惰性”语义

refreshAfterWrite 是 Caffeine 最有价值也最容易被误用的特性。它的行为不是定时刷新：只有在 key 被访问时才会触发刷新检查，没有任何访问的 key 永远不会刷新。

其运行机制是：命中时若发现距上次写入已超过 refreshAfterWrite 间隔，则返回旧值并异步触发加载函数重新加载；加载失败时保留旧值。刷新期间旧值继续服务，读延迟不因刷新而尖峰。

这带来一个直接后果：冷 key 的数据可能无限期停留在首次加载的状态。如果业务要求数据新鲜度不依赖于访问频率，必须配合 expireAfterWrite：

```java
Caffeine.newBuilder()
    .refreshAfterWrite(Duration.ofMinutes(5))   // 5 分钟后，有访问时异步刷新
    .expireAfterWrite(Duration.ofMinutes(10))   // 10 分钟后强制过期，下次访问同步重载
    .build(key -> load(key));
```

5~10 分钟窗口内：访问返回旧值 + 后台刷新；10 分钟后：真正过期，下次访问阻塞重载。这一组合兼顾了低延迟与数据新鲜度上限。

此外，refreshAfterWrite 需要 CacheLoader（即 LoadingCache），而 Spring 的 @Cacheable 无法直接提供 loader。如果通过 CacheLoader Bean 注入自动配置的 manager，该 loader 会关联到该 manager 下的所有缓存，让一个 loader 靠 instanceof 或 key 前缀分派所有业务类型的加载逻辑，在多数项目中并不现实。如果需要 refreshAfterWrite，更清晰的路径是对少量真正需要的缓存使用 registerCustomCache 配合各自的 loader，接受这些缓存不走 @Cacheable 方法体的事实。

## 最佳实践与避坑建议

### mmaximumSize 不是内存上限

maximumSize(10_000) 限制的是条目数，不是字节数。一万个小 DTO 可能只有几 MB，一万个完整聚合对象可能是数 GB，症状只在负载高时表现为 OutOfMemoryError。当条目大小差异大时，用 maximumWeight + weigher：

```java
Caffeine.newBuilder()
    .maximumWeight(64L * 1024 * 1024)
    .weigher((String k, byte[] v) -> k.length() + v.length);
```

注意：weight 在写入时计算且此后固定，可变对象的后续增长不会被感知；maximumSize 与 maximumWeight 互斥。

### 始终开启 recordStats() 并接入监控

没有统计，缓存配置就是“盲飞”。Caffeine 的命中率、淘汰数、加载耗时等指标只有在 recordStats() 后才可用。在多缓存差异化配置中，每个自定义缓存都需要单独开启。建议通过 Micrometer 将 cache.gets、cache.evictions 等指标暴露到 Actuator，持续观察命中率趋势与淘汰原因分布；若 estimatedSize 持续上涨且无下降拐点，是容量配置不足或内存泄漏的信号。

### 过期检查是“摊销”的，不要依赖精确的即时移除

Caffeine 的过期淘汰发生在写入维护和偶发读取维护中，而不是由定时器逐条扫描。因此一个已过期的条目可能在超过过期时间后仍然占用内存，并继续被 estimatedSize() 计入，直到下一次维护触发。如果业务对“过期即刻不可见”有硬要求，必须配合每次 get 时的过期检查逻辑（Caffeine 命中路径本身会检查过期，不会返回过期值），但如果还需要及时释放内存，可注入 Scheduler.systemScheduler() 以获得更及时的清理。

### 区分 expireAfterWrite 与 expireAfterAccess 的语义

|策略	|时钟起点	|限制陈旧度？	|限制内存？|	典型场景|
|expireAfterWrite|	值创建/替换|	是	|仅间接|	需要新鲜度的业务数据|
|expireAfterAccess|	最后一次读写|	否（持续被读的 key 永不淘汰）|	是|	会话类、低频访问数据|

两者可以且通常应该同时设置：expireAfterWrite 兜底数据新鲜度，expireAfterAccess 淘汰无人问津的条目。

### 单机缓存需要注意多实例部署时的一致性

Caffeine 是进程内缓存。当服务扩展到多个实例，各实例的本地缓存彼此独立，一个实例上的更新不会传播到其他实例。此时 Caffeine 可以作为 L1 与 Redis 等分布式缓存组成两级缓存：Caffeine 承载纳秒级热点读，Redis 承载跨实例共享与一致性。L1 的 TTL 应短于 L2，使 L1 的陈旧窗口有界，L2 在 L1 失效后仍能以较低回源成本兜底。如果业务对跨实例强一致性有要求，单纯依赖 Caffeine 无法满足。

### 不要用 Caffeine 缓存“每次都要最新”的数据

Caffeine 的刷新和过期都是惰性的：没有访问就没有刷新，过期检查也是摊销的。对于价格、库存、权限等要求强实时或接近实时的数据，应当评估可接受的陈旧窗口，通过较短的 expireAfterWrite 或配合分布式缓存的主动失效机制来控制，而不是期望 Caffeine 在后台“自动保持最新”