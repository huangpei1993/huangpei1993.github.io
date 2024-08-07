---
title: Redis 5种基本数据类型
date: 2024-08-04 20:10:42
tags:
---

Redis 共有 5 种基本数据类型：String（字符串）、List（列表）、Set（集合）、Hash（散列）、Zset（有序集合）。

## String(字符串)

String 是 Redis 中最简单同时也是最常用的一个数据类型。

String 是一种二进制安全的数据类型，可以用来存储任何类型的数据比如字符串、整数、浮点数、图片（图片的 base64 编码或者解码或者图片的路径）、序列化后的对象。

### 应用场景

**需要存储常规数据的场景：** 缓存 Session、Token、图片地址、序列化后的对象(相比较于 Hash 存储更节省内存)。

**需要计数的场景：** 用户单位时间的请求数（简单限流可以用到）、页面单位时间的访问数。

**分布式锁：** 具体实现请参考这篇文章《Redis实现分布式锁》

## List（列表）

### 应用场景

**信息流展示：** 最新文章、最新动态。

**消息队列：** ```List``` 可以用来做消息队列，只是功能过于简单且存在很多缺陷，不建议这样做。

## Hash（哈希）

Redis 中的 Hash 是一个 String 类型的 field-value（键值对） 的映射表，特别适合用于存储对象，后续操作的时候，你可以直接修改这个对象中的某些字段的值。这种数据结构类似于 JDK1.8 前的 ```HashMap```，内部实现也差不多(数组 + 链表)。不过，Redis 的 Hash 做了更多优化。

### 应用场景

**对象数据存储场景：** 用户信息、商品信息、文章信息、购物车信息。

## Set（集合）

Redis 中的 Set 类型是一种无序集合，集合中的元素没有先后顺序但都唯一，有点类似于 Java 中的 ```HashSet``` 。当你需要存储一个列表数据，又不希望出现重复数据时，Set 是一个很好的选择，并且 Set 提供了判断某个元素是否在一个 Set 集合内的重要接口，这个也是 List 所不能提供的。

你可以基于 Set 轻易实现交集、并集、差集的操作，比如你可以将一个用户所有的关注人存在一个集合中，将其所有粉丝存在一个集合。这样的话，Set 可以非常方便的实现如共同关注、共同粉丝、共同喜好等功能。这个过程也就是求交集的过程。

### 应用场景

**需要存放的数据不能重复的场景：** 网站 UV 统计（数据量巨大的场景还是 HyperLogLog更适合一些）、文章点赞、动态点赞等场景。

**需要获取多个数据源交集、并集和差集的场景：** 共同好友(交集)、共同粉丝(交集)、共同关注(交集)、好友推荐（差集）、音乐推荐（差集）、订阅号推荐（差集+交集） 等场景。

**需要随机获取数据源中的元素的场景：** 抽奖系统、随机点名等场景。