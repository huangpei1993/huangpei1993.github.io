---
title: Spring之Bean的生命周期
date: 2024-09-06 11:04:08
categories: Spring
tags:
- Spring
- Spring Bean
---
Spring最重要的功能就是帮助程序员创建对象（也就是IOC），而启动Spring就是为创建Bean对象做准备，所以我们先明白Spring到底是怎么去创建Bean的，也就是先弄明白Bean的生命周期。

Bean的生命周期就是指：在Spring中，一个Bean是如何生成的，如何销毁的

## Bean的生成过程
Spring启动的时候会进行扫描，会先调用`org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider#scanCandidateComponents(String basePackage)`
扫描某个包路径，并得到BeanDefinition的Set集合。

Spring扫描的过程：
1. 首先，通过ResourcePatternResolver获得指定包路径下的所有.class文件（Spring源码中将此文件包装成了Resource对象）
2. 遍历每个Resource对象
3. 利用MetadataReaderFactory解析Resource对象得到MetadataReader（在Spring源码中MetadataReaderFactory具体的实现类为CachingMetadataReaderFactory，MetadataReader的具体实现类为SimpleMetadataReader）
4. 利用MetadataReader进行excludeFilters和includeFilters，以及条件注解@Conditional的筛选（条件注解并不能理解：某个类上是否存在@Conditional注解，如果存在则调用注解中所指定的类的match方法进行匹配，匹配成功则通过筛选，匹配失败则pass掉。）
5. 筛选通过后，基于metadataReader生成ScannedGenericBeanDefinition
6. 再基于metadataReader判断是不是对应的类是不是接口或抽象类
7. 如果筛选通过，那么就表示扫描到了一个Bean，将ScannedGenericBeanDefinition加入结果集

MetadataReader表示类的元数据读取器，主要包含了一个AnnotationMetadata，功能有：
1. 获取类的名字
2. 获取父类的名字
3. 获取所实现的所有接口名
4. 获取所有内部类的名字
5. 判断是不是抽象类
6. 判断是不是接口
7. 判断是不是一个注解
8. 获取拥有某个注解的方法集合
9. 获取类上添加的所有注解信息
10. 获取类上添加的所有注解类型集合

值得注意的是，`CachingMetadataReaderFactory`解析某个`.class`文件得到`MetadataReader`对象是利用的ASM技术，并没有加载这个类到JVM。并且，最终得到的`ScannedGenericBeanDefinition`对象，`beanClass`属性存储的是当前类的名字，而不是class对象。（`beanClass`属性的类型是Object，它即可以存储类的名字，也可以存储class对象）

最后，上面是说的通过扫描得到`BeanDefinition`对象，我们还可以通过直接定义`BeanDefinition`，或解析`spring.xml`文件的`<bean/>`，或者@Bean注解得到`BeanDefinition`对象。（后续课程会分析@Bean注解是怎么生成`BeanDefinition`的）。

## 合并BeanDefinition
通过扫描得到所有`BeanDefinition`之后，就可以根据`BeanDefinition`创建Bean对象了，但是在Spring中支持父子`BeanDefinition`，和Java父子类类似，但是完全不是一回事。

父子BeanDefinition实际用的比较少，使用是这样的，比如：
```xml
<bean id="parent" class="com.example.basic.toyspring.bean.Parent" scope="prototype"/>
<bean id="child" class="com.example.basic.toyspring.bean.Child"/>
```

这么定义的情况下，child是单例Bean。

```xml
<bean id="parent" class="com.example.basic.toyspring.bean.Parent" scope="prototype"/>
<bean id="child" class="com.example.basic.toyspring.bean.Child" parent="parent"/>
```

但是这么定义的情况下，child就是原型Bean了。

因为child的父BeanDefinition是parent，所以会继承parent上所定义的scope属性。
而在根据child来生成Bean对象之前，需要进行BeanDefinition的合并，得到完整的child的BeanDefinition。

## 加载类
BeanDefinition合并之后，就可以去创建Bean对象了，而创建Bean就必须实例化对象，而实例化就必须先加载当前BeanDefinition所对应的class，在AbstractAutowireCapableBeanFactory类的createBean()方法中，一开始就会调用：

```java
Class<?> resolvedClass = resolveBeanClass(mbd, beanName);
```

这行代码就是去加载类，该方法是这么实现的：

```java
if (mbd.hasBeanClass()) {
 return mbd.getBeanClass();
}
if (System.getSecurityManager() != null) {
 return AccessController.doPrivileged((PrivilegedExceptionAction<Class<?>>) () ->
  doResolveBeanClass(mbd, typesToMatch), getAccessControlContext());
 }
else {
 return doResolveBeanClass(mbd, typesToMatch);
}
```

```java
public boolean hasBeanClass() {
 return (this.beanClass instanceof Class);
}
```
如果beanClass属性的类型是Class，那么就直接返回，如果不是，则会根据类名进行加载（doResolveBeanClass方法所做的事情）
会利用BeanFactory所设置的类加载器来加载类，如果没有设置，则默认使用**ClassUtils.getDefaultClassLoader()**所返回的类加载器来加载。

其中`ClassUtils.getDefaultClassLoader()`的获取类加载器的过程如下：
1. 优先返回当前线程中的ClassLoader
2. 线程中类加载器为null的情况下，返回ClassUtils类的类加载器
3. 如果ClassUtils类的类加载器为空，那么则表示是Bootstrap类加载器加载的ClassUtils类，那么则返回系统类加载器

## 实例化前
当前BeanDefinition对应的类成功加载后，就可以实例化对象了，但是在Spring中，实例化对象之前，Spring提供了一个扩展点，允许用户来控制是否在某个或某些Bean实例化之前做一些启动动作。这个扩展点叫`InstantiationAwareBeanPostProcessor.postProcessBeforeInstantiation()`。比如：
```java
@Component
public class MyBeanPostProcessor implements InstantiationAwareBeanPostProcessor {

 @Override
 public Object postProcessBeforeInstantiation(Class<?> beanClass, String beanName) throws BeansException {
  if ("myBean".equals(beanName)) {
   System.out.println("myBean的实例化前");
  }
  return null;
 }
}
```

如上代码会导致，在myBean这个Bean实例化前，会进行打印`myBean的实例化前`。

值得注意的是，`postProcessBeforeInstantiation()`是有返回值的，如果这么实现：
postProcessBeforeInstantiation()`。比如：
```java
@Component
public class MyBeanPostProcessor implements InstantiationAwareBeanPostProcessor {

 @Override
 public Object postProcessBeforeInstantiation(Class<?> beanClass, String beanName) throws BeansException {
  if ("myBean".equals(beanName)) {
   System.out.println("myBean的实例化前");
   return new MyBean();
  }
  return null;
 }
}
```

`myBean`这个Bean，在实例化前会直接返回一个由我们所定义的`MyBean`对象。如果是这样，表示不需要Spring来实例化了，并且后续的Spring依赖注入也不会进行了，会跳过一些步骤，直接执行初始化后这一步。

## 实例化
在这个步骤中就会根据`BeanDefinition`去创建一个对象了。Spring可以通过一下三种方式进行实例化一个Bean.

### Supplier创建对象
首先判断`BeanDefinition`中是否设置了`Supplier`，如果设置了则调用`Supplier`的`get()`得到对象。

我们可以直接使用`BeanDefinition`对象来设置`Supplier`，比如：
```java
AbstractBeanDefinition beanDefinition = BeanDefinitionBuilder.genericBeanDefinition().getBeanDefinition();
beanDefinition.setInstanceSupplier(new Supplier<Object>() {
 @Override
 public Object get() {
  return new MyBean();
 }
});
context.registerBeanDefinition("myBean", beanDefinition);
```

### 工厂方法创建

如果没有设置`Supplier`，则检查`BeanDefinition`中是否设置了`factoryMethod`，也就是工厂方法，有两种方式可以设置`factoryMethod`:

方式一
```java
<bean id="myBean" class="com.example.basic.toyspring.bean.MyBean" factory-method="createMyBean" />

```

对应的`MyBean`类为
```java
public class MyBean {

 public static MyBean createMyBean() {
  System.out.println("执行createMyBean()");
  MyBean myBean = new MyBean();
  return myBean;
 }

 public void test() {
  System.out.println("test");
 }

}
```

方式二
```xml
<bean id="commonBean" class="com.example.basic.toyspring.bean.CommonBean"/>
<bean id="myBean" factory-bean="commonService" factory-method="createMyBean"/>
```

对应的`CommonBean`类为
```java
public class CommonService {

 public MyBean createMyBean() {
  return new MyBean();
 }
}
```

Spring发现当前`BeanDefinition`方法设置了工厂方法后，就会区分这两种方式，然后调用工厂方法得到对象。

值得注意的是，我们通过`@Bean`所定义的`BeanDefinition`，是存在`factoryMethod`和`factoryBean`的，也就是和上面的方式二非常类似，`@Bean`所注解的方法就是`factoryMethod`，`AppConfig`对象就是`factoryBean`。如果`@Bean`所所注解的方法是static的，那么对应的就是方式一。

### 推断构造方法

如果以上两种方式都没有提供的话，Spring需要利用该类的构造方法来实例化得到一个对象，如果一个类存在多个构造方法，Spring通过一下步骤选择一个构造方法：
1. 如果一个类只存在一个构造方法，不管该构造方法是无参构造方法，还是有参构造方法，Spring都会用这个构造方法
2. 如果一个类存在多个构造方法
    2.1 这些构造方法中，存在一个无参的构造方法，那么Spring就会用这个无参的构造方法
    2.1 这些构造方法中，不存在一个无参的构造方法，那么Spring就会报错

Spring的设计思想是这样的：
1. 如果一个类只有一个构造方法，那么没得选择，只能用这个构造方法
2. 如果一个类存在多个构造方法，Spring不知道如何选择，就会看是否有无参的构造方法，因为无参构造方法本身表示了一种默认的意义
3. 不过如果某个构造方法上加了`@Autowired`注解，那就表示程序员告诉Spring就用这个加了注解的方法，那Spring就会用这个加了`@Autowired`注解构造方法了

需要重视的是，如果Spring选择了一个有参的构造方法，Spring在调用这个有参构造方法时，需要传入参数，那这个参数是怎么来的呢？
Spring会根据入参的类型和入参的名字去Spring中找Bean对象（以单例Bean为例，Spring会从单例池那个Map中去找）：
1. 先根据入参类型找，如果只找到一个，那就直接用来作为入参
2. 如果根据类型找到多个，则再根据入参名字来确定唯一一个
3. 最终如果没有找到，则会报错，无法创建当前Bean对象

## BeanDefinition的后置处理
Bean对象实例化出来之后，接下来就应该给对象的属性赋值了。在真正给属性赋值之前，Spring又提供了一个扩展点`MergedBeanDefinitionPostProcessor.postProcessMergedBeanDefinition()`，可以对此时的`BeanDefinition`进行加工，比如：
```java
@Component
public class MyMergedBeanDefinitionPostProcessor implements MergedBeanDefinitionPostProcessor{
    @Override
    public void postProcessMergedBeanDefinition(RootBeanDefinition beanDefinition,Class<?> beanType, String beanName){
        if("myBean".equals(beanName)){
            beanDefinition.getPropertyValues().add("toyBean",new ToyBean());
        }
    }
}
```

在Spring源码中，`AutowiredAnnotationBeanPostProcessor`就是一个`MergedBeanDefinitionPostProcessor`，它的`postProcessMergedBeanDefinition()中`会去查找注入点，并缓存在A`utowiredAnnotationBeanPostProcessor`对象的一个`Map`中（`injectionMetadataCache`）。

## 实例化后

在处理完BeanDefinition后，Spring又设计了一个扩展点：`InstantiationAwareBeanPostProcessor.postProcessAfterInstantiation()`，比如：

```java
@Component
public class MyInstantiationAwareBeanPostProcessor implements InstantiationAwareBeanPostProcessor {

 @Override
 public boolean postProcessAfterInstantiation(Object bean, String beanName) throws BeansException {

  if ("myBean".equals(beanName)) {
   MyBean myBean = (MyBean) bean;
   myBean.test();
  }

  return true;
 }
}

```

上述代码就是对`myBean`所实例化出来的对象进行处理。但是这个扩展点在Spring源码中基本没有怎么使用。

## 自动注入

## 处理属性
这个步骤中，就会处理`@Autowired`、`@Resource`、`@Value`等注解，也是通过`InstantiationAwareBeanPostProcessor.postProcessProperties()`扩展点来实现的，比如我们甚至可以实现一个自己的自动注入功能，比如：
```java
@Component
public class MyInstantiationAwareBeanPostProcessor implements InstantiationAwareBeanPostProcessor {

 @Override
 public PropertyValues postProcessProperties(PropertyValues pvs, Object bean, String beanName) throws BeansException {
  if ("myBean".equals(beanName)) {
   for (Field field : bean.getClass().getFields()) {
    if (field.isAnnotationPresent(MyInject.class)) {
     field.setAccessible(true);
     try {
      field.set(bean, "123");
     } catch (IllegalAccessException e) {
      e.printStackTrace();
     }
    }
   }
  }

  return pvs;
 }
}
```

## 执行Aware

完成了属性赋值之后，Spring会执行一些回调，包括：
1. BeanNameAware：回传beanName给bean对象。
2. BeanClassLoaderAware：回传classLoader给bean对象。
3. BeanFactoryAware：回传beanFactory给对象。

## 初始化前
初始化前，也是Spring提供的一个扩展点：`BeanPostProcessor.postProcessBeforeInitialization()`，比如
```java
@Component
public class MyBeanPostProcessor implements BeanPostProcessor {

 @Override
 public Object postProcessBeforeInitialization(Object bean, String beanName) throws BeansException {
  if ("myBean".equals(beanName)) {
   System.out.println("myBean的初始化前");
  }

  return bean;
 }
}
```

利用初始化前，可以对**进行了依赖注入的Bean**进行处理。

在Spring源码中：
1. `InitDestroyAnnotationBeanPostProcessor`会在初始化前这个步骤中执行`@PostConstruct`的方法，
2. `ApplicationContextAwareProcessor`会在初始化前这个步骤中进行其他`Aware`的回调：
    2.1 `EnvironmentAware`：回传环境变量
    2.2 `EmbeddedValueResolverAware`：回传占位符解析器
    2.3 `ResourceLoaderAware`：回传资源加载器
    2.4 `ApplicationEventPublisherAware`：回传事件发布器
    2.5 `MessageSourceAware`：回传国际化资源
    2.6 `ApplicationStartupAware`：回传应用其他监听对象，可忽略
    2.7 `ApplicationContextAware`：回传Spring容器`ApplicationContext`

## 初始化
1. 查看当前Bean对象是否实现了`InitializingBean`接口，如果实现了就调用其`afterPropertiesSet()`方法
2. 执行`BeanDefinition`中指定的初始化方法

## 初始化后
这是Bean创建生命周期中的最后一个步骤，也是Spring提供的一个扩展点：`BeanPostProcessor.postProcessAfterInitialization()`，比如：

```java
@Component
public class MyBeanPostProcessor implements BeanPostProcessor {

 @Override
 public Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
  if ("myBean".equals(beanName)) {
   System.out.println("myBean初始化后");
  }

  return bean;
 }
}
```

可以在这个步骤中，对Bean最终进行处理，**Spring中的AOP就是基于初始化后实现的**，初始化后返回的对象才是最终的Bean对象。

## 总结
1. InstantiationAwareBeanPostProcessor.postProcessBeforeInstantiation()
2. 实例化
3. MergedBeanDefinitionPostProcessor.postProcessMergedBeanDefinition()
4. InstantiationAwareBeanPostProcessor.postProcessAfterInstantiation()
5. 自动注入
6. InstantiationAwareBeanPostProcessor.postProcessProperties()
7. Aware对象
8. BeanPostProcessor.postProcessBeforeInitialization()
9. 初始化
10. BeanPostProcessor.postProcessAfterInitialization()