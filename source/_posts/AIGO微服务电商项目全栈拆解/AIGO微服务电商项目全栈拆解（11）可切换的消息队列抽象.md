---
title: AIGO微服务电商项目全栈拆解（11）可切换的消息队列抽象
date: 2026-09-18 16:01:10
categories: AIGO微服务电商项目
category_order: 11
tags:
- 微服务
- 电商系统
- 消息队列
- MQ 抽象
- RabbitMQ
- Go
- 适配器模式
---

## 写在前面

这一篇我们讲讲：**消息队列客户端到底应该依赖什么**。

在C端和B端中，订单状态、每日首访、超时关单、自动收货以及售后命令，都需要发布或消费消息。如果业务代码直接拿 RabbitMQ 的 `Publisher`、`Consumer` 和 AMQP 消息结构，今后换 broker 时就会把改动扩散到每个服务。因此项目在两个仓库里都放了一份 `pkg/mq`，试图把业务需要的最小消息能力收敛成一组 Go 接口。

这套抽象的**接口层和 RabbitMQ 适配器已经可以工作**，如果想接入其它的消息队列，如：`RocketMQ`、`kafka`，还需要专门的适配与调试。

![MQ 抽象层与适配器关系](./AIGO微服务电商项目全栈拆解（11）可切换的消息队列抽象/MQ抽象层与适配器关系.svg)

## 一、公共 API 只描述业务需要的消息能力

### 1. `Client` 负责资源创建和生命周期

`Client` 是入口，提供三类资源：普通生产者、延迟生产者、按 `topic + group` 创建的消费者；同时提供关闭客户端、关闭某个 topic 的生产者和关闭某个消费组的接口。业务服务可以把一个 `mq.Client` 注入 service，而不用知道底层连接对象是什么。

核心接口可以压缩成下面这样：

```go
type Client interface {
    NewProducer(ctx context.Context, topic string) (Producer, error)
    NewDelayedProducer(ctx context.Context, topic string) (DelayedProducer, error)
    NewConsumer(ctx context.Context, topic, group string) (Consumer, error)
    Close(ctx context.Context) error
}
```

### 2. `Message` 不携带 RabbitMQ 类型

公共消息模型只有项目业务真正用到的字段：

| 字段 | 作用 | RabbitMQ 适配器映射 |
| --- | --- | --- |
| `ID` | 消息稳定标识；也是重试计数和幂等约定的重要输入 | RabbitMQ `MessageID` |
| `Key` | 业务路由或分区键语义 | RabbitMQ `Subject` |
| `Body` | 业务载荷 | AMQP data |
| `Headers` | 字符串元数据 | AMQP application properties |
| `Timestamp` | 创建时间 | RabbitMQ creation time |

`Delivery` 在消息之外增加 `Topic`、`Group` 和 `Attempt`，让 handler 可以知道自己消费的是哪个主题、哪个消费组以及第几次尝试。`ConsumeResult` 只有 `Action` 和可选的 `Err`：`Err` 方便日志诊断，真正决定消息如何结算的是 `Action`。

这种设计的价值不在于“把 SDK 类型换个名字”，而在于公共包根本不需要导入 RabbitMQ SDK。RabbitMQ 的 `amqp.Message`、`rmq.Publisher`、`rmq.Consumer` 只出现在 `rabbitmq.go` 适配器内部；适配器负责完成 `Message` 与 AMQP 消息之间的转换。

## 二、Ack、Retry、Reject：把消费结果压缩成三种业务决策

消费者 handler 返回三种结果：

- `Ack`：业务已经处理成功，确认这次投递；零值 `ConsumeResult{}` 也按 Ack 处理。
- `Retry`：暂时性失败，请实现重新投递；可以配合最大尝试次数和延迟重试。
- `Reject`：消息格式错误、业务不允许处理或无法恢复，直接丢弃，不再重投。

RabbitMQ 适配器的映射关系是：Ack 调用 `Accept`，Retry 在达到上限时 `Discard`，否则按 `RetryDelay` 选择延迟重投或立即 `Requeue`；Reject 直接 `Discard`。

### 重试上限不是 handler 自己维护的循环

订阅参数通过 `SubscribeOptions` 传入：

```go
mq.SubscribeOptions{
    Concurrency: 8,
    MaxAttempts: 5,
    RetryDelay:  time.Second,
}
```

在 RabbitMQ 适配器中，`MaxAttempts` 大于 0 时才启用上限判断；当 `Attempt >= MaxAttempts` 且 handler 返回 Retry，就放弃这条消息，避免永久重投。`RetryDelay` 大于 0 时调用延迟重试，否则立即重新入队。

## 三、`DelayedMessage`：抽象表达延迟，RabbitMQ 负责调度

延迟消息不是另一个业务消息结构，而是把 `Message` 内嵌后增加一个 `Delay`：

```go
type DelayedMessage struct {
    Message
    Delay time.Duration
}
```

RabbitMQ 适配器把 `Delay` 转成毫秒写入 `x-delay`，投递到独立的 `<topic>.delayed.exchange`。普通消息使用 `<topic>.exchange`，这样普通生产不依赖 `x-delayed-message` 插件；消费者创建时，如果 broker 支持延迟交换机，再把同一消费组的队列绑定过去。

抽象层应该做的事：业务只表达“延迟多久”，厂商差异由适配器解释；但抽象层不能凭空保证所有 broker 都有同样的延迟能力。

## 四、RabbitMQ 适配器怎样实现同一组接口

### 1. 按 topic 和消费组缓存资源

`RabbitMQClient` 用三个 `sync.Map` 缓存普通生产者、延迟生产者和消费者。普通生产者按 topic 复用；消费者按 `(topic, group)` 复用。创建消费者时会声明：

```text
topic.exchange
topic.group.queue
topic.delayed.exchange（插件可用时）
```

同一个消费组共享队列并竞争消费；不同消费组使用不同队列，所以可以分别收到同一个 topic 的消息。

### 2. 适配器内部做 AMQP 转换

发布前，`newRabbitMQMessage` 把 `ID`、`Key`、`Timestamp`、`Headers` 映射到 AMQP 属性；消费后，`rabbitMQMessage` 再转换回公共 `Message`。业务服务看不到 `amqp.Message`，也不需要依赖 `rabbitmq-amqp-go-client` 的类型。

RabbitMQ 适配器底部还放了 5 条编译期接口断言：`RabbitMQSubscription` 满足 `Subscription`，`RabbitMQConsumer` 满足 `Consumer`，`RabbitMQProducer` 满足 `Producer`，`RabbitMQDelayedProducer` 满足 `DelayedProducer`，`RabbitMQClient` 满足 `Client`。这类断言没有运行时成本，却能在接口变更后立刻让编译失败，避免“以为实现了，实际方法签名已经漂移”。

### 3. 生命周期关闭是显式的

`Subscription.Close` 使用 `sync.Once`，重复关闭不会重复调用取消函数。客户端还提供按 topic、按 topic + group 的关闭方法。应用启动代码负责持有 client 和 subscription，在退出时调用 Close；这也是为什么公共 `Client` 需要包含生命周期方法，而不只是 Publish / Subscribe。

## 六、`GetClient` 的前缀选型和懒初始化

`micro-mall/backend/pkg/mq/factory.go` 的 `GetClient(ctx, link)` 用 `strings.SplitN(link, ":", 2)` 拆分配置，将前半段作为类型，后半段作为连接串：

```text
rabbitmq:amqp://admin:***@localhost:5672/
   │                 │
   └─ mqType         └─ mqLink
```

空配置返回 `ErrConfigEmpty`，没有冒号的配置返回格式错误，未知前缀返回“不支持”。第一次成功创建后，包级 `mqClient` 被复用；创建失败时仍保持 nil，后续调用可以再次尝试。这就是当前工厂的懒初始化语义。

## 五、批量发布为什么不承诺事务

公共接口定义了 `BatchResult`：它报告已经发布的数量，以及失败消息在原数组中的 `Index` 和 `Err`。

这么做的原因是：不同消息系统对批量发送、确认、事务和部分失败的语义不同；如果公共 API 宣称“批量一定原子提交”，最弱的适配器就只能伪造承诺。`BatchResult` 选择暴露“可能部分成功”，让调用方知道需要记录、补偿或重试哪些位置。

## 六、为什么公共 API 不暴露厂商 SDK 类型

这条规则本质上是在保护依赖方向：

```text
业务 service → pkg/mq 的 Message / Client / Handler
                     ↓
              RabbitMQ adapter → AMQP / rmq SDK
```

如果 `Producer.Publish` 参数是 `*amqp.Message`，业务层就被迫知道 RabbitMQ 的属性、确认状态和连接生命周期；未来换成 Kafka 时，接口、测试和大量业务代码都要一起改。现在业务只需要构造 `mq.Message`，适配器负责把它翻译成具体协议。

这并不是追求“完全隐藏所有差异”。例如 RabbitMQ 的延迟插件、delivery-count、requeue 和 Kafka 的 retry topic 并不等价。正确做法是把业务确实需要的语义放进公共模型，把厂商专有的实现手段留在适配器中，并在适配器测试里验证映射是否成立。

## 七、未来替换 Kafka 的边界：能加适配器，但不是无条件一键替换

从依赖方向看，Kafka 适配器可以实现同一组 `Client`、`Producer`、`DelayedProducer`、`Consumer`、`Subscription` 接口，业务层理论上不需要改。这是抽象带来的主要收益。

但“只新增一个适配器”成立的前提，是新适配器能够明确实现当前接口的语义：

- `topic + group` 如何映射到 Kafka topic 和 consumer group；
- `Ack`、`Retry`、`Reject` 如何对应 offset 提交、重试 topic 或死信 topic；
- `MaxAttempts` 和 `RetryDelay` 如何保存并推进尝试次数；
- `Key`、`Headers`、`Timestamp` 如何映射到 Kafka record；
- `DelayedMessage` 如何实现。Kafka 本身没有 RabbitMQ `x-delayed-message` 这样的交换机插件，可能需要延迟 topic、调度器或外部时间轮；
- `PublishBatch` 是逐条确认、Kafka producer batch，还是额外的事务语义。公共接口不能替 Kafka 自动获得 RabbitMQ 的行为。

因此，当前项目真正需要的工作边界应是：新增 Kafka adapter、补齐适配器级测试、定义延迟与重试语义，并把 `GetClient` 的前缀分支扩展为 `kafka`。如果 Kafka 无法提供某个能力，就应在接口或配置层明确限制，而不是让业务以为所有 provider 的语义完全一致。Kafka 适配器目前只是未来方向，项目中尚未实现。

## 八、这套抽象目前适合怎样使用

在已经实现的 RabbitMQ 路径上，业务侧的依赖可以保持很小：

```go
producer, err := client.NewProducer(ctx, "order.status.changed")
if err != nil {
    return err
}
return producer.Publish(ctx, mq.Message{
    ID: orderID + ":" + version,
    Key: orderID,
    Body: payload,
})
```

消费者只返回业务结果：格式错误通常 Reject，临时数据库或下游错误 Retry，处理成功 Ack。消息 ID 要稳定，消费方才能在重投时实现自己的幂等；MQ 抽象只负责把 `Attempt` 和结算动作传给适配器，不替业务完成幂等。

对于延迟关单、自动收货等场景，可以使用 `DelayedProducer` 表达延迟，但还要结合项目已有的扫描兜底和状态机校验。延迟消息不是数据库定时器，也不是状态变更的唯一事实来源。

## 结尾：当前项目真正拥有的“可切换性”

从真实代码看，`pkg/mq` 已经把可替换消息系统所需的最小公共面收拢起来：接口不依赖 GoFrame，不暴露 RabbitMQ SDK；消息字段、消费组、确认动作、重试上限、延迟消息和生命周期都有明确模型；RabbitMQ 适配器通过编译期断言守住接口一致性；商城和管理后台也采用了同构的公共包。

这也是抽象层最有价值的地方：它没有消灭基础设施差异，而是把差异放在一个可以被审查、被测试、被替换的边界里。