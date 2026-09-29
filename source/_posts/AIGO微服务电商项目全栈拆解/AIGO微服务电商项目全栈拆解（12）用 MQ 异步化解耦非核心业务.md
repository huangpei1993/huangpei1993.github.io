---
title: AIGO微服务电商项目全栈拆解（12）用 MQ 异步化解耦非核心业务
date: 2026-09-18 16:01:25
categories: AIGO微服务电商项目
category_order: 12
tags:
- 微服务
- 电商系统
- RabbitMQ
- 消息驱动
- 异步化
- 订单状态
- 定时任务
---

这篇主要梳理项目中的异步任务：**主请求先把必须完成的事实写下来，积分、投影、自动收货、超时关单和售后处理再沿着 MQ 或定时任务继续推进**。

## 先看全貌：一条同步主链路，几条异步支线

| 场景 | 当前代码里的路径 | 节奏 | 兜底或边界 |
| --- | --- | --- | --- |
| 注册、登录、浏览、下单、支付同步 | Gateway → Member/Order gRPC | 同步 RPC | 页面等待当前结果 |
| 每日首访积分 | Gateway `FirstAccess` → `gateway.first-access` → Member | 异步 MQ | 网关进程内当日标记；当前不是 Redis |
| 支付成功后的积分、成长值 | Order → `order.status.changed` → Member | 异步 MQ | Member 当前只处理 `pay` 的 `0 → 1`，其他状态先 Ack |
| 后台订单状态投影 | Order 或 Admin → `order.status.changed` → Admin | 异步 MQ | Admin 按版本单调更新；生产失败不回滚本地提交 |
| 未支付超时关单 | `order.expiration` 延迟消息 → Order | 异步 MQ | 每 1 分钟扫描待付款订单 |
| 自动确认收货 | 每小时扫描 → `order.auto-receipt` 延迟消息 → Order | 异步 MQ + 定时补安排 | 消费者仍会再次检查时间和订单状态 |
| 售后审核与退款命令 | Admin → `after-sale.command` → Order | 异步 MQ | 退款还有每 1 分钟扫描任务 |
| 发票邮件 | Gateway → Order `ApplyInvoice`，事务后打印日志 | 同步 RPC | 当前未实现真实邮件发送 |

图中实线是需要等待返回的调用，虚线是消息传播。

![同步主链路与事件广播](<./AIGO微服务电商项目全栈拆解（12）用 MQ 异步化解耦非核心业务/同步主链路与事件广播.svg>)

[下载同步主链路与事件广播 PNG](<./AIGO微服务电商项目全栈拆解（12）用 MQ 异步化解耦非核心业务/同步主链路与事件广播.png>) 

![延迟消息与定时兜底](<./AIGO微服务电商项目全栈拆解（12）用 MQ 异步化解耦非核心业务/延迟消息与定时兜底.svg>)

[下载延迟消息与定时兜底 PNG](<./AIGO微服务电商项目全栈拆解（12）用 MQ 异步化解耦非核心业务/延迟消息与定时兜底.png>)

## 一、每日首访：请求放行后再发消息

### 1. Gateway 只负责触发，不等待积分

网关的 `accesslog.go` 里，`FirstAccess` 依赖前面的认证中间件把用户 ID 放进上下文。它先组装 URL、用户 ID 和访问时间，然后执行 `r.Middleware.Next()` 放行下游请求；下游返回后，才在 goroutine 中调用 `publishFirstAccessLog`。

这条顺序把两个目标拆开了：当前 HTTP 请求负责完成原来的业务，首访奖励只负责把一个事件放进 `gateway.first-access`。网关不会等待 Member 把积分账本写完，MQ 不可用时也只是记录 warning，不把这项非核心副作用升级成请求失败。

```text
Auth 写入 member_id
  → FirstAccess 放行当前请求
  → 请求结束后发布 gateway.first-access
  → Member 消费并发放每日登录积分
```

### 2. 一个容易误读的边界：当前不是 Redis 幂等

还要注意，当前标记是在 goroutine 内、发布消息之前写入的；如果随后 `Publish` 失败，代码只记录日志，没有回滚这个当日标记。这么做的原因是：发放积分的中间件是做到了认证中间件之后的，也就是能走到这个中间件的请求都是已经经过了认证的，也即登陆了系统，可以给该用户发放积分。

真正落到账本的每日幂等在 Member 的 `AwardDailyLoginPoints` 里：它把上海自然日格式化成业务键，在账户事务中写入登录奖励；重复的用户和日期不会再次增加积分。换句话说，当前有两层不同性质的控制：

- Gateway 的进程内标记减少同一实例当天的重复发布；
- Member 的账户事务和业务键保护最终的积分入账不重复。

Member 消费组名是 `member-first-access`。消息解析或用户 ID 非法会 `Reject`；业务处理失败会 `Retry`；发放成功或账本判断为重复则 `Ack`。这能说明消费者对重复处理有边界，但不能推出生产端一定不会丢消息。

## 二、订单状态广播：一个主题，两个消费组

### 1. Order 先提交状态，再尝试发布

Order 的状态变化在本地事务中落库后，调用 `notifyOrderStatusChanged` 发布 `order.status.changed`。消息里带有订单号、会员 ID、旧状态、新状态、事件名、订单版本、现金商品金额和变更时间；消息 ID 使用 `orderSn:version`，消息 Key 使用订单号。

支付回调和支付状态查询把订单从 `0 待付款` 推到 `1 待发货` 时，也会通过 hook 进入发布路径。这样 Member 和 Admin 不需要嵌入支付回调代码，各自消费同一份状态事实。

需要特别注意发布边界：消息发布失败只记录 warning，已经提交的订单状态不会回滚。当前没有把事件先写入 Outbox 再补发，也没有针对这个 Topic 的对账补发任务。所以这里可以说“状态变更后尝试广播”，不能承诺“每一次状态都可靠送达”或“所有消费者最终一定收敛”（急需解决）。

### 2. Member 消费了全部消息，但当前只实现支付成功副作用

Member 使用消费组 `member-order-status` 订阅该主题。处理函数先解析事件，再判断是否是 `event=pay` 且 `fromStatus=0`、`toStatus=1`。只有这个迁移进入 `SettleOrder`，结算现金商品对应的积分和成长值；账户账本以订单业务键做幂等，重复投递不会重复发放。

### 3. Admin 用自己的消费组维护订单投影

Admin 使用不同的 `admin-order-status` 消费组，因此不会与 Member 抢同一条消息。它会校验消息体、消息 ID、Key、订单和会员身份，再用 `WHERE version < event.version` 更新自己的订单状态投影：

```text
低版本或同版本同状态 → Ack
高版本 → 条件更新 status/version
格式、身份或迁移不合法 → Reject
临时数据库错误 → Retry
```

Admin 既是消费者也是生产者。管理端关闭待付款订单或填写物流并发货时，先在自己的事务中完成操作，提交后再发布 `order.status.changed`。因此 Admin 的 HTTP 请求等待的是管理端本地操作结果，Member 或其他投影何时收到消息不属于这个请求的同步返回值。

## 三、延迟消息不是“直接改状态”：自动收货的两层检查

### 1. 自动收货：小时扫描只负责补安排

订单服务启动时订阅 `order.auto-receipt`，消费组为 `order-auto-receipt-confirm`。另外注册了每小时执行的 `ScheduleTodayAutoReceiptOrders`：它查询当前本地日内可能到期的已发货订单，为每一单计算自动收货时间，再调用 `NewDelayedProducer` 发布延迟消息。

因此定时任务并不是每小时把所有订单直接改成完成，而是把“当天需要检查的订单”重新安排进延迟队列。真正到点后，消费者还要做三次确认：

1. 如果消息提前到达，按剩余时间重新发布；
2. 如果订单已经不是已发货，说明用户确认收货或其他状态迁移已经赢了，直接幂等确认；
3. 只有仍处于已发货状态时，才用状态机和条件更新执行 `2 → 3`，随后发布 `auto_confirm_receipt` 状态事件。

这个结构把“时间触发”和“状态变更”分开了。延迟消息负责尽量靠近到期点，消费者负责防止提前处理和重复处理，小时扫描负责在进程重启或单次安排失败后再次暴露待处理订单。

## 四、订单超时关单：延迟消费者

待付款订单生成成功后，Order 根据普通订单或秒杀订单的超时配置，发布一条 `order.expiration` 延迟消息。消息携带订单 ID、订单号、会员 ID 和 `expiresAt`。

到期消费者收到消息后，先检查是否提前到达；如果提前，就按原到期时间重排。到期后重新读取订单，只有仍是 `0 待付款` 才执行关闭。关闭成功后，代码还会释放积分预占、库存和优惠券等资源，并通过 `order.status.changed` 广播 `timeout_close`。

```text
创建订单
  └─ order.expiration 延迟消息 → 到期消费者 → 检查 + CAS 关单
```

## 五、售后命令：后台操作异步进入 Order

Admin 的售后接口接收 `APPROVE`、`REJECT`、`CONFIRM_RECEIVE`、`RETRY_REFUND` 四类命令，生成命令 ID 后发布 `after-sale.command`。Order 启动时订阅消费组 `order-after-sale-command`，按命令调用对应的审核、收货确认或退款重试逻辑。

所以售后审核不是 Admin 直接同步调用 Order 的 RPC，而是：

```text
Admin HTTP 接收命令
  → after-sale.command
  → Order 消费
  → 更新售后单 / 执行退款
```

消费者对格式错误和不支持的命令 `Reject`，业务失败 `Retry`，处理成功 `Ack`。Order 进程还注册了每 1 分钟的售后退款扫描任务，用于处理处于退款处理中、需要再次执行的记录。

## 六、发票邮件：同步开票

发票流程很适合用来说明“看起来像异步，实际不是”的反例。Gateway 的发票控制器通过 gRPC 调用 Order 的 `ApplyInvoice`。Order 校验订单状态和开票条件，在事务中写入发票与订单关联，然后返回发票 ID 和发票号码。

如果交付方式是邮件或“下载+邮件”，`invoice.go` 会在事务成功后调用 `logEmailDelivery`。这个函数只打印收件人、主题、关联订单和 PDF 文件名等日志。因此当前链路是：

```text
Gateway → Order：同步 ApplyInvoice
Order：事务写发票
Order：打印 [EMAIL-DELIVERY] 模拟日志
```

## 七、从这些实现能提炼出的设计边界

### 1. 把“用户必须马上看到的事实”和“稍后可完成的副作用”分开

用户要拿到 Token、订单号、应付金额和发票号，所以这些结果走同步 RPC；每日奖励、后台投影、自动收货、超时关单和售后命令可以在请求返回后继续处理，所以用消息或任务解耦。

### 2. 消费者的 Ack/Retry/Reject 不是可靠投递证明（急需优化）

当前消费者普遍使用“格式错误 Reject、暂时失败 Retry、成功 Ack”的结果模型，也使用消费组隔离不同下游。但生产端发布失败后，核心事务不会回滚，且没有统一 Outbox。正确的表述是：**消费者具备重试和部分幂等保护，生产端仍是提交后的尽力发布**。