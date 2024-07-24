---
title: Java IO 设计模式
date: 2024-07-24 20:06:09
catagories: Java
tags:
- 设计模式
- Java IO
---

## 装饰器模式

**装饰器（Decorator）模式**可以在不改变原有对象的情况下扩展其功能。

装饰器模式通过组合替代继承来扩展原始类的功能，在一些继承关系比较复杂的场景（IO这一场景中各种类的继承关系就比较复杂）更加实用。

对于字节流来说，```FilterInputStream```（对应输入流）和```FilterOutputStream```（对应输出流）是装饰器模式的核心，分别用于增强```InputStream```和```OutputStream```子类的功能。

我们常见的```BufferedInputStream```（字节缓冲输入流）、```DataInputStream```等等都是```FilterInputStream```的子类，```BufferedOutputStream```（字节缓冲输出流）、```DataOutputStream```等等都是```FilterOutputStream```的子类。

举个例子，我们可以通过```BufferedInputStream```（字节缓冲输入流）来增强```FileInputStream```的功能。

```BufferedInputStream```构造函数如下：
```java
public BufferedInputStream(InputStream in) {
    this(in, DEFAULT_BUFFER_SIZE);
}
public BufferedInputStream(InputStream in, int size) {
    super(in);
    if (size <= 0) {
        throw new IllegalArgumentException("Buffer size <= 0");
    }
    buf = new byte[size];
}
```

可以看出，```BufferedInputStream```的构造函数的其中一个参数就是```InputStream```。

```BufferedInputStream```的使用实例：
```java
try(BufferedInputStream bis = new BufferedInputStream(new FileInputStream("input.txt"))){
    int content;
    long skip = bis.skip(2);
    while((content=bis.read())!=-1){
        System.out.print((char) content);
    }
}catch(IOException e){
    e.printStackTrace();
}

```

为什么不直接弄一个```BufferedFileInputStream```呢？
```java
BufferedFileInputStream bfis = new BufferedFileInputStream("input.txt");
```

如果```InputStream```的子类比较少的话，这样做是没有问题的。不过，```InputStream```的子类实在太多，继承关系也复杂了。如果我们为每一个子类都定制一个对应的缓冲输入流，那就太麻烦了。

同时，```ZipInputStream```和```ZipOutputStream```分别增强了```BufferedInputStream```和```BufferedOutputStream```的能力。
```java
BufferedInputStream bis = new BufferedInputStream(new FileInputStream(fileName));
ZipInputStream zis = new ZipInputStream(bis);

BufferedOutputStream bos = new BufferedOutputStream(new FileOutputStream(fileName));
ZipOutputStream zipOut = new ZipOutputStream(bos);
```

值得一提的是，装饰器模式有一个很重要的特征，那就是可以对原始类嵌套使用多个装饰器。

为了实现这一效果，装饰器类需要跟原始类继承相同的抽象类或者实现相同的接口。上面介绍到的这些IO相关的装饰类和原始类共同的父类是```InputStream```和```OutputStream```。