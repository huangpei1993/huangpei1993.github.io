---
title: ConcurrentHashMap 源码分析
date: 2024-07-26 20:37:57
categories: Java
tags:
- ConcurrentHashMap
- 源码
---

作为```HashMap```的线程安全的版本，```ConcurrentHashMap```的使用频率是非常高的，本文将通过其源码来分析它的存储结构和实现原理。

## JDK1.7 中的ConcurrentHashMap

### 存储结构
<center>
    <img src="./ConcurrentHashMap-源码分析/JDK7 ConcurrentHashMap存储结构.png"/>
    <p>JDK7 ConcurrentHashMap存储结构</p>
</center>

JDK7中```ConcurrentHashMap```的存储结构如上图，```ConcurrnetHashMap```由很多个 ```Segment``` 组合，而每一个 ```Segment``` 是一个类似于 HashMap 的结构，所以每一个 ```HashMap``` 的内部可以进行扩容。但是 ```Segment``` 的个数一旦初始化就不能改变，默认 ```Segment``` 的个数是**16**个，也可以认为 ```ConcurrentHashMap``` 默认支持最多**16** 个线程并发。

### 初始化

我们先从```ConcurrentHashMap```的无参构造方法来连接它的初始化流程。

```java
    /**
     * 默认初始化容量
     */
    static final int DEFAULT_INITIAL_CAPACITY = 16;

    /**
     * 默认负载因子
     */
    static final float DEFAULT_LOAD_FACTOR = 0.75f;

    /**
     * 默认并发级别
     */
    static final int DEFAULT_CONCURRENCY_LEVEL = 16;


    /**
     * Creates a new, empty map with a default initial capacity (16),
     * load factor (0.75) and concurrencyLevel (16).
     */
    public ConcurrentHashMap() {
        this(DEFAULT_INITIAL_CAPACITY, DEFAULT_LOAD_FACTOR, DEFAULT_CONCURRENCY_LEVEL);
    }

```

可以看出，无参构造函数是通过调用有三个参数的构造函数，并传入了三个默认值。再来看下有三个参数的构造函数

```java
@SuppressWarnings("unchecked")
public ConcurrentHashMap(int initialCapacity,float loadFactor, int concurrencyLevel) {
    // 参数校验
    if (!(loadFactor > 0) || initialCapacity < 0 || concurrencyLevel <= 0)
        throw new IllegalArgumentException();
    // 校验并发级别大小，大于 1<<16，重置为 65536
    if (concurrencyLevel > MAX_SEGMENTS)
        concurrencyLevel = MAX_SEGMENTS;
    // Find power-of-two sizes best matching arguments
    // 2的多少次方
    int sshift = 0;
    int ssize = 1;
    // 这个循环可以找到首个大于 concurrencyLevel 的2的次方值
    while (ssize < concurrencyLevel) {
        ++sshift;
        ssize <<= 1;
    }
    // 记录段偏移量
    this.segmentShift = 32 - sshift;
    // 记录段掩码
    this.segmentMask = ssize - 1;
    // 设置容量
    if (initialCapacity > MAXIMUM_CAPACITY)
        initialCapacity = MAXIMUM_CAPACITY;
    // c = 容量 / ssize ，默认 16 / 16 = 1，这里是计算每个 Segment 中的类似于 HashMap 的容量
    int c = initialCapacity / ssize;
    if (c * ssize < initialCapacity)
        ++c;
    int cap = MIN_SEGMENT_TABLE_CAPACITY;
    //Segment 中的类似于 HashMap 的容量至少是2或者2的倍数
    while (cap < c)
        cap <<= 1;
    // create segments and segments[0]
    // 创建 Segment 数组，设置 segments[0]
    Segment<K,V> s0 = new Segment<K,V>(loadFactor, (int)(cap * loadFactor),
                         (HashEntry<K,V>[])new HashEntry[cap]);
    Segment<K,V>[] ss = (Segment<K,V>[])new Segment[ssize];
    UNSAFE.putOrderedObject(ss, SBASE, s0); // ordered write of segments[0]
    this.segments = ss;
}

```

JDK7的ConcurrentHashMap的初始化过程总结如下：
1. 必要参数校验
2. 校验并发级别```concurrencyLevel```的大小，如果大于预设的最大值，重置位该最大值。无参构造函数中默认为6.
3. 寻找并发级别 ```concurrencyLevel```之上最近的2的幂次方值，作为初始化容量大小，默认是16。
4. 记录```segmentShift```偏移量，这个值为【容量 = 2 的 N 次方】中的 N，在后面 Put 时计算位置时会用到。默认是 32 - sshift = 28.
5. 记录```segmentMask```，默认是 ssize - 1 = 16 -1 = 15.
6. 初始化 ```segments[0]```，默认大小为 2，负载因子 0.75，扩容阀值是 2*0.75=1.5，插入第二个值时才会进行扩容。

### put方法

put方法的主要流程为：
1. 计算要 ```put``` 的 ```key``` 的位置，获取指定位置的```Segment```。
2. 如果指定位置的 ```Segment``` 为空，则初始化这个 ```Segment```.
> 初始化 ```Segment``` 流程：
> 1. 检查计算得到的位置的 ```Segment``` 是否为 ```null```.
> 2. 为 ```null``` 继续初始化，使用 ```Segment[0]``` 的容量和负载因子创建一个 ```HashEntry``` 数组。
> 3. 再次检查计算得到的指定位置的 ```Segment``` 是否为 ```null```.使用创建的 HashEntry 数组初始化这个 ```Segment```.
> 4. 自旋判断计算得到的指定位置的 ```Segment``` 是否为 ```null```，使用 CAS 在这个位置赋值为 ```Segment```.

```java
/**
 * Maps the specified key to the specified value in this table.
 * Neither the key nor the value can be null.
 *
 * <p> The value can be retrieved by calling the <tt>get</tt> method
 * with a key that is equal to the original key.
 *
 * @param key key with which the specified value is to be associated
 * @param value value to be associated with the specified key
 * @return the previous value associated with <tt>key</tt>, or
 *         <tt>null</tt> if there was no mapping for <tt>key</tt>
 * @throws NullPointerException if the specified key or value is null
 */
public V put(K key, V value) {
    Segment<K,V> s;
    if (value == null)
        throw new NullPointerException();
    int hash = hash(key);
    // hash 值无符号右移 28位（初始化时获得），然后与 segmentMask=15 做与运算
    // 其实也就是把高4位与segmentMask（1111）做与运算
    int j = (hash >>> segmentShift) & segmentMask;
    if ((s = (Segment<K,V>)UNSAFE.getObject          // nonvolatile; recheck
         (segments, (j << SSHIFT) + SBASE)) == null) //  in ensureSegment
        // 如果查找到的 Segment 为空，初始化
        s = ensureSegment(j);
    return s.put(key, hash, value, false);
}

/**
 * Returns the segment for the given index, creating it and
 * recording in segment table (via CAS) if not already present.
 *
 * @param k the index
 * @return the segment
 */
@SuppressWarnings("unchecked")
private Segment<K,V> ensureSegment(int k) {
    final Segment<K,V>[] ss = this.segments;
    long u = (k << SSHIFT) + SBASE; // raw offset
    Segment<K,V> seg;
    // 判断 u 位置的 Segment 是否为null
    if ((seg = (Segment<K,V>)UNSAFE.getObjectVolatile(ss, u)) == null) {
        Segment<K,V> proto = ss[0]; // use segment 0 as prototype
        // 获取0号 segment 里的 HashEntry<K,V> 初始化长度
        int cap = proto.table.length;
        // 获取0号 segment 里的 hash 表里的扩容负载因子，所有的 segment 的 loadFactor 是相同的
        float lf = proto.loadFactor;
        // 计算扩容阀值
        int threshold = (int)(cap * lf);
        // 创建一个 cap 容量的 HashEntry 数组
        HashEntry<K,V>[] tab = (HashEntry<K,V>[])new HashEntry[cap];
        if ((seg = (Segment<K,V>)UNSAFE.getObjectVolatile(ss, u)) == null) { // recheck
            // 再次检查 u 位置的 Segment 是否为null，因为这时可能有其他线程进行了操作
            Segment<K,V> s = new Segment<K,V>(lf, threshold, tab);
            // 自旋检查 u 位置的 Segment 是否为null
            while ((seg = (Segment<K,V>)UNSAFE.getObjectVolatile(ss, u))
                   == null) {
                // 使用CAS 赋值，只会成功一次
                if (UNSAFE.compareAndSwapObject(ss, u, null, seg = s))
                    break;
            }
        }
    }
    return seg;
}

```