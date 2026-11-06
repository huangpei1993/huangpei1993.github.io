---
title: Spring AI 单实例多MCP端点的实现方案
date: 2026-11-05 21:49:28
categories: Spring
tags:
    - Spring AI
    - MCP
---

这个方案可以概括为：

**在同一个 Spring Boot Web 服务中，根据配置为每个业务域注册一组独立的 MCP Transport、RouterFunction 和 Server；HTTP 路由决定进入哪组 Transport，Server 再决定该端点暴露哪些工具。**

例如：

```
同一个 Spring Boot 进程 / 同一个 HTTP 端口

/mcp/A
    └── mcpRouter_A
        └── mcpTransport_A
            └── mcpServer_A
                └── A 包下注册的工具

/mcp/B
    └── mcpRouter_B
        └── mcpTransport_B
            └── mcpServer_B
                └── B 包下注册的工具
```

## 原版 Spring AI 注册单个MCP端点的流程

以 WebMVC + STATELESS + SYNC 为例，原版 Spring AI 默认注册流程如下：

```
引入 spring-ai-starter-mcp-server-webmvc
    ↓
Spring Boot 读取自动配置候选类
    ↓
根据 enabled、protocol、stdio、type 等条件筛选配置
    ↓
注册单个 Transport、RouterFunction、MCP Server 的 BeanDefinition
    ↓
Spring 创建 Bean，Server 绑定 Transport
    ↓
Spring MVC 发现 RouterFunction
    ↓
HTTP 请求进入 MCP Server
```

### Spring Boot 找到自动配置类

`@SpringBootApplication` 包含自动配置入口。Spring Boot 的 `AutoConfigurationImportSelector` 从依赖包的：

```
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

中读取候选类，再处理 `exclude` 和各类条件。Spring AI 的 WebMVC 自动配置清单中包含 SSE、Streamable HTTP 和 Stateless 三种传输配置。这里首先注册的是配置类及其 `@Bean` 方法对应的 **BeanDefinition**，不是立即创建最终对象。

### 根据配置选择无状态实现

在 Spring AI 1.1.2 中，当满足服务器启用、非 STDIO、`protocol=STATELESS` 等条件时：
- `McpServerStatelessWebMvcAutoConfiguration` 负责提供 WebMVC Transport 和 RouterFunction；
- `McpServerStatelessAutoConfiguration` 负责提供无状态 MCP Server；
- type=SYNC 时创建 `McpStatelessSyncServer`，也有对应的异步分支。
原版默认使用一个 McpServerStreamableHttpProperties 中的 mcpEndpoint。在该版本中，相关配置是 spring.ai.mcp.server.streamable-http.mcp-endpoint，默认路径为 /mcp。虽然属性名带 streamable-http，这里的无状态 WebMVC 自动配置同样读取它。

### Spring AI 的核心 Bean 的依赖关系和实例化顺序

在 Spring Boot 启动时，Spring AI 的核心 Bean 的依赖关系如下：

```
McpServerObjectMapperAutoConfiguration
        └─ mcpServerObjectMapper (ObjectMapper, defaultCandidate=false)

McpServerStreamableHttpProperties  ← mcpEndpoint 默认 "/mcp"
        │
        ▼
webMvcStatelessServerTransport ──①构造时内部就 new 出 RouterFunction(GET/POST /mcp)
        │        ▲
        │        │
        ├────────┴─ webMvcStatelessServerRouterFunction = transport.getRouterFunction()
        │
        ▼
mcpStatelessSyncServer
        ├─ 参数：capabilitiesBuilder (McpSchema.ServerCapabilities.Builder，单例)
        ├─ 参数：ObjectProvider<List<SyncToolSpecification>> 等（解析时创建 syncTools）
        └─ build() → new McpStatelessAsyncServer(...)
                        └─ 构造末尾：new DefaultMcpStatelessServerHandler(...)
                                     → transport.setMcpHandler(handler)   ⟲ 反向写回
```

启动时，Spring AI 核心 Bean 的实例化顺序如下：

```
1. mcpServerObjectMapper
2. webMvcStatelessServerTransport          ← 需要 1
3. webMvcStatelessServerRouterFunction     ← 需要 2（拿到的是同一个 RouterFunction 对象）
4. capabilitiesBuilder
5. syncTools（若存在 ToolCallback Bean）    ← 被 6 的 ObjectProvider 触发
6. mcpStatelessSyncServer                  ← 需要 2、4，解析 5
       └─ 此刻 transport.mcpHandler 被赋值，transport 才“可用”
7. RouterFunctionMapping.afterPropertiesSet()
       └─ getBeanProvider(RouterFunction.class).orderedStream() 把 3 收进 HandlerMapping
```

需要说明的是：

- syncTools 是在 server 创建过程中被拉的，不是容器启动开头。所以原版工具是 .tools(specs) 一次性塞进 build，之后不再变化；这正是自定义方案必须改用 CommandLineRunner + addTool 才能实现"按 endpoint 分别扫描"的原因。

- transport 一旦创建就暴露了 RouterFunction，此时 mcpHandler 还是 null。如果此时有请求进来，handlePost 里的 this.mcpHandler.handleRequest(...) 会 NPE，被外层 catch (Exception) 兜住返回 500 "Unexpected error"（transport 自己没有判空）。原版靠"server 在 refresh 内一并创建完 + Tomcat 尚未开始接请求"来回避，属于隐式约定。

### RouterFunction、Transport 和 McpStatelessSyncServer 的职责

|对象|	本质|	职责|	生命周期里它关心什么|
|---|---|---|---|
|RouterFunction（router）|	Spring MVC 的"路由声明"|把 /mcp/A 的 GET/POST 映射到 transport 的方法引用，让 `DispatcherServlet` 能找到这个 transport|就是一个函数式 Bean，本身无状态（transport.getRouterFunction() 返回的是同一个对象，不是新对象）|
|WebMvcStatelessServerTransport（transport）|协议适配层（HTTP ⇄ JSON-RPC）|	用 messageEndpoint 建出 GET/POST 两条路由；收到 POST 后：校验 Accept → 把 HTTP body 反序列化成 JSONRPCRequest → 交给 mcpHandler → 把返回的 JSONRPCResponse 写回 HTTP。GET 直接 405|只认 URL 和 JSON，不认识任何工具；它持有的 mcpHandler 是 Server 反向塞进来的|
|McpStatelessSyncServer（server，内含 McpStatelessAsyncServer）|MCP 协议语义层|构造时建立 method → handler 表（initialize/ping/tools/list/tools/call/resources/*/prompts/*），持有该端点自己的工具清单，并把 handler 回写给 transport|关心"我这个端点暴露哪些工具、能力集是什么"|

原版自动配置创建一个 `WebMvcStatelessServerTransport`，把配置的 MCP 路径交给 Transport。然后，通过 `transport.getRouterFunction()` 将路由作为一个 Spring Bean 暴露。

在 MCP Java SDK 0.17.0 中，Transport 内部为该路径构造 GET 和 POST 路由：POST 处理 MCP JSON-RPC 请求；GET 返回 405。**Transport 负责 HTTP 与 MCP 消息的转换，RouterFunction 负责让 Spring MVC 能把请求路由到 Transport**。

### 请求处理链路

一次工具调用会经过以下链路：
**HTTP → router → transport → mcpHandler → server 的 handler 表 → 具体工具**

具体的逐层调用链路如下：

```
Tomcat（Servlet 线程）
 │
 ▼
DispatcherServlet.doDispatch()
 │  ① getHandler(request)
 ├──▶ HandlerMapping 链（按 order 排序）
 │      RouterFunctionMapping（order = -1，排在 RequestMappingHandlerMapping 之前）
 │        └─ getBeanProvider(RouterFunction.class).orderedStream()
 │            → 拿到 webMvcStatelessServerRouterFunction
 │            → 用 RequestPredicates 匹配 "POST /mcp"
 │            → 命中，返回 HandlerFunction（即 transport::handlePost）
 │
 │  ② getHandlerAdapter(handler) → HandlerFunctionAdapter
 ├──▶ HandlerFunctionAdapter.handle(serverRequest, handlerFunction)
 │
 │  ③ 调用 HandlerFunction
 ├──▶ WebMvcStatelessServerTransport#handlePost(ServerRequest)
 │      ├─ isClosing ? 503
 │      ├─ transportContext = contextExtractor.extract(request)   ← 默认 EMPTY，可放鉴权上下文
 │      ├─ Accept 必须同时含 application/json 与 text/event-stream，否则 400
 │      ├─ body = request.body(String.class)
 │      ├─ McpSchema.deserializeJsonRpcMessage(jsonMapper, body)  ← McpJsonMapper
 │      └─ mcpHandler.handleRequest(transportContext, jsonrpcRequest).block()
 │
 │  ④ mcpHandler 路由到方法
 ├──▶ DefaultMcpStatelessServerHandler#handleRequest
 │      └─ requestHandlers.get("tools/call")
 │
 │  ⑤ 反序列化 + 找工具
 ├──▶ McpStatelessAsyncServer#toolsCallRequestHandler
 │      ├─ jsonMapper.convertValue(params, CallToolRequest)
 │      ├─ this.tools 里按 name 找 AsyncToolSpecification
 │      │     └─ 找不到 → McpError(INVALID_PARAMS, "Unknown tool: invalid_tool_name")
 │      └─ specification.callHandler().apply(ctx, request)
 │
 │  ⑥ 执行工具（线程切换点）
 ├──▶ AsyncToolSpecification.callHandler
 │      └─ Mono.fromCallable(() -> syncHandler.apply(ctx, req))
 │            immediateExecution=true  → 就在当前 Tomcat 线程
 │            immediateExecution=false → subscribeOn(boundedElastic)
 │
 │  ⑦ 真正落到业务代码
 ├──▶ McpToolUtils 生成的 callHandler
 │      └─ toolCallback.call(json(args), new ToolContext(...))
 │            └─ SwaggerMethodToolCallback：反序列化 → 反射调用 Controller 方法
 │      └─ new CallToolResult(List.of(new TextContent(json)), false)
 │            异常 → new CallToolResult(List.of(new TextContent(e.getMessage())), true)
 │
 │  ⑧ 组装 JSON-RPC 响应
 ├──▶ .map(result -> new JSONRPCResponse("2.0", request.id(), result, null))
 │      异常 → JSONRPCResponse(..., null, JSONRPCError(code, message, data))
 │
 │  ⑨ 写回 HTTP
 └──▶ ServerResponse.ok().contentType(application/json).body(jsonrpcResponse)
```

## 实现多MCP端点的注册

核心是“按配置动态注册多个 MCP Server、RouterFunction和Transport bean”。

实现思路是：同一个 Spring Boot 进程（同一个 HTTP 端口）里，为每个 endpoint 动态注册一套 transport + router + server，每套对应不同 URL（例如 /mcp/A、/mcp/B）.

### 增加多端点配置
在`application.yml`中添加如下配置

```yaml
spring:
  ai:
    mcp:
      server:
        protocol: STATELESS
        type: SYNC
        endpoint-prefix: /mcp
        endpoints:
          - name: A
            scan-package: com.xxx.modules.A
          - name: B
            scan-package: com.xxx.modules.B
```

其中：
- `endpoint-prefix + name` 决定 MCP HTTP 路径；
- `scan-package` 决定后续向该 Server 注册哪些业务工具；

以两项配置为例，Spring Boot 会向容器注册六个 BeanDefinition：

| 端点 | Transport Bean | Router Bean | Server Bean |
|---|---|---|---|
| `/mcp/A` | `mcpTransport_A` | `mcpRouter_A` | `mcpServer_A` |
| `/mcp/B` | `mcpTransport_B` | `mcpRouter_B` | `mcpServer_B` |

因此，新增一个业务端点主要是新增一项配置；注册器按相同规则生成另一套定义。

### 排除 Spring AI 原版的相关自动配置类
YAML 配置只告诉自定义注册器要创建哪些端点，不会自动阻止 Spring AI 注册默认的 MCP Bean，因此还需要排除掉相关自动配置类：
```java
@SpringBootApplication(
    scanBasePackages = "com.xxx",
    exclude = {
        McpServerStreamableHttpWebMvcAutoConfiguration.class,
        McpServerSseWebMvcAutoConfiguration.class,
        McpServerStatelessWebMvcAutoConfiguration.class,
        McpServerAutoConfiguration.class,
        McpServerStatelessAutoConfiguration.class
    }
)
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

### 定义多MCP端点的 BeanDefinitionRegistrar

```java
/**
 * 多 MCP 端点 BeanDefinition 注册器。
 * 在 Spring 初始化早期注册 transport、router 和 server 的 BeanDefinition，
 * 确保 RouterFunction 能被 WebMvc 的 HandlerMapping 识别。
 */
@Slf4j
@Component
public class MultiMcpServerBeanDefinitionRegistrar implements BeanDefinitionRegistryPostProcessor, EnvironmentAware {

    private Environment environment;

    /**
     * 设置 Spring Environment。
     *
     * @param environment Spring 环境
     */
    @Override
    public void setEnvironment(Environment environment) {
        this.environment = environment;
    }

    /**
     * 在 BeanDefinition 阶段注册多 MCP 端点相关 BeanDefinition。
     *
     * @param registry BeanDefinitionRegistry
     * @throws BeansException 当注册失败时抛出
     */
    @Override
    public void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) throws BeansException {
        MultiMcpProperties properties = Binder.get(environment)
                .bind("spring.ai.mcp.server", Bindable.of(MultiMcpProperties.class))
                .orElse(null);
        if (properties == null || properties.getEndpoints() == null || properties.getEndpoints().isEmpty()) {
            log.warn("没有配置 MCP 端点，跳过 BeanDefinition 注册");
            return;
        }

        String endpointPrefix = properties.getEndpointPrefix();
        if (!StringUtils.hasText(endpointPrefix)) {
            log.warn("MCP 端点前缀未配置，跳过 BeanDefinition 注册");
            return;
        }

        List<MultiMcpProperties.Endpoint> endpoints = properties.getEndpoints();
        log.info("准备注册 MCP 端点 BeanDefinition，数量: {}, endpointPrefix: {}", endpoints.size(), endpointPrefix);

        for (MultiMcpProperties.Endpoint endpoint : endpoints) {
            if (!StringUtils.hasText(endpoint.getName())) {
                log.warn("跳过无效的端点配置：名称为空");
                continue;
            }

            String endpointName = endpoint.getName();
            String messageEndpoint = buildMessageEndpoint(endpointPrefix, endpointName);

            String transportBeanName = "mcpTransport_" + endpointName;
            String routerBeanName = "mcpRouter_" + endpointName;
            String serverBeanName = "mcpServer_" + endpointName;

            registerTransportDefinition(registry, transportBeanName, messageEndpoint);
            registerRouterDefinition(registry, routerBeanName, transportBeanName);
            registerServerDefinition(registry, serverBeanName, transportBeanName);
        }
    }
    private void registerTransportDefinition(BeanDefinitionRegistry registry, String beanName,
            String messageEndpoint) {
        if (registry.containsBeanDefinition(beanName)) {
            log.info("transport BeanDefinition 已存在，跳过注册: {}", beanName);
            return;
        }
        BeanDefinitionBuilder builder = BeanDefinitionBuilder
                .genericBeanDefinition(WebMvcStatelessServerTransport.class);
        builder.getRawBeanDefinition().setFactoryBeanName("multiMcpServerRegistrar");
        builder.getRawBeanDefinition().setFactoryMethodName("createTransport");
        builder.addConstructorArgValue(messageEndpoint);
        registry.registerBeanDefinition(beanName, builder.getBeanDefinition());
        log.info("注册 transport BeanDefinition: {}, messageEndpoint: {}", beanName, messageEndpoint);
    }

    private void registerRouterDefinition(BeanDefinitionRegistry registry, String beanName,
            String transportBeanName) {
        if (registry.containsBeanDefinition(beanName)) {
            log.info("router BeanDefinition 已存在，跳过注册: {}", beanName);
            return;
        }
        BeanDefinitionBuilder builder = BeanDefinitionBuilder
                .genericBeanDefinition(RouterFunction.class);
        BeanDefinition definition = builder.getRawBeanDefinition();
        definition.setFactoryBeanName("multiMcpServerRegistrar");
        definition.setFactoryMethodName("createRouter");
        definition.setDependsOn(new String[] { transportBeanName });
        builder.addConstructorArgValue(new RuntimeBeanReference(transportBeanName));
        registry.registerBeanDefinition(beanName, builder.getBeanDefinition());
        log.info("注册 router BeanDefinition: {}", beanName);
    }

    private void registerServerDefinition(BeanDefinitionRegistry registry, String beanName,
            String transportBeanName) {
        if (registry.containsBeanDefinition(beanName)) {
            log.info("server BeanDefinition 已存在，跳过注册: {}", beanName);
            return;
        }
        BeanDefinitionBuilder builder = BeanDefinitionBuilder
                .genericBeanDefinition(McpStatelessSyncServer.class);
        BeanDefinition definition = builder.getRawBeanDefinition();
        definition.setFactoryBeanName("multiMcpServerRegistrar");
        definition.setFactoryMethodName("createServer");
        definition.setDependsOn(new String[] { transportBeanName });
        builder.addConstructorArgValue(new RuntimeBeanReference(transportBeanName));
        registry.registerBeanDefinition(beanName, builder.getBeanDefinition());
        log.info("注册 server BeanDefinition: {}", beanName);
    }

    private String buildMessageEndpoint(String endpointPrefix, String endpointName) {
        String prefix = endpointPrefix.startsWith("/") ? endpointPrefix : "/" + endpointPrefix;
        String name = endpointName.startsWith("/") ? endpointName.substring(1) : endpointName;
        return prefix + "/" + name;
    }
}
```

### 定义多MCP端点对象工厂

这些工厂方法都是参照原版 Spring AI 实现的。

```java
/**
 * 多 MCP 端点对象工厂。
 * MultiMcpServerBeanDefinitionRegistrar 注册的 transport/router/server 三类 BeanDefinition
 * 都指向本类的 factoryMethod，由本类完成“按端点创建实例”的工作。
 */
@Slf4j
@Component("multiMcpServerRegistrar")
public class MultiMcpServerRegistrar implements EnvironmentAware {

    private Environment environment;

    /** 多端点配置（endpoint-prefix + endpoints[]，同时承载 spring.ai.mcp.server 公共配置） */
    private final MultiMcpProperties properties;

    /** MCP 专用 ObjectMapper，由 McpServerObjectMapperAutoConfiguration 提供（defaultCandidate=false，必须按名注入） */
    private final ObjectMapper mcpServerObjectMapper;

    public MultiMcpServerRegistrar(MultiMcpProperties properties,
            @Qualifier("mcpServerObjectMapper") ObjectMapper mcpServerObjectMapper) {
        this.properties = properties;
        this.mcpServerObjectMapper = mcpServerObjectMapper;
    }

    @Override
    public void setEnvironment(Environment environment) {
        this.environment = environment;
    }

    /**
     * 创建某个 MCP 端点的 transport。
     * 对应 Spring AI: McpServerStatelessWebMvcAutoConfiguration#webMvcStatelessServerTransport
     *
     * @param messageEndpoint 该端点的完整 URL，例如 /mcp/A
     */
    public WebMvcStatelessServerTransport createTransport(String messageEndpoint) {
        log.info("创建 MCP Transport，messageEndpoint: {}", messageEndpoint);
        // SDK 里构造函数是 private，只能走 builder；jsonMapper 必须用 MCP 专用 ObjectMapper，
        // 否则 McpSchema 的多态反序列化（Content/Resource 等）会失败
        return WebMvcStatelessServerTransport.builder()
                .jsonMapper(new JacksonMcpJsonMapper(mcpServerObjectMapper))
                .messageEndpoint(messageEndpoint)
                // 默认是 McpTransportContext.EMPTY；需要从请求头透传 token/租户时在这里提取
                .contextExtractor(request -> McpTransportContext.EMPTY)
                .build();
    }

    /**
     * 把 transport 内置的 RouterFunction 暴露成独立 Bean。
     * RouterFunctionMapping 会把它当成 HandlerMapping，一个 RouterFunction 就是一套 URL 规则。
     * 对应 Spring AI: McpServerStatelessWebMvcAutoConfiguration#webMvcStatelessServerRouterFunction
     *
     * @param transport 该端点的 transport（由 BeanDefinition 的 dependsOn 保证先创建）
     */
    public RouterFunction<ServerResponse> createRouter(WebMvcStatelessServerTransport transport) {
        return transport.getRouterFunction();
    }

    /**
     * 创建某个端点的 MCP Server（stateless + sync）。
     * 对应 Spring AI: McpServerStatelessAutoConfiguration#mcpStatelessSyncServer
     *
     * @param transport 该端点的 transport
     */
    public McpStatelessSyncServer createServer(WebMvcStatelessServerTransport transport) {
        McpSchema.Implementation serverInfo =
                new McpSchema.Implementation(properties.getName(), properties.getVersion());

        // 每个端点必须独立的 capabilities Builder：原生实现里它是单例 Bean，
        // 多端点共用同一个会互相覆盖（Builder 内部是可变状态）
        McpSchema.ServerCapabilities.Builder capabilities = McpSchema.ServerCapabilities.builder();
        if (properties.getCapabilities().isTool()) {
            capabilities.tools(properties.isToolChangeNotification());
        }
        if (properties.getCapabilities().isResource()) {
            capabilities.resources(false, properties.isResourceChangeNotification());
        }
        if (properties.getCapabilities().isPrompt()) {
            capabilities.prompts(properties.isPromptChangeNotification());
        }

        McpServer.StatelessSyncSpecification spec = McpServer.sync(transport)
                .serverInfo(serverInfo)
                .capabilities(capabilities.build())
                .instructions(properties.getInstructions())
                .requestTimeout(properties.getRequestTimeout())
                // WebMvc 是阻塞式 transport，必须立即执行；只有 WebFlux 才用默认的异步 offload
                .immediateExecution(this.environment instanceof StandardServletEnvironment);

        McpStatelessSyncServer server = spec.build();
        // 注意：这里不注册工具，工具由 MultiMcpToolRegistrar 在 CommandLineRunner 阶段 addTool 注入
        log.info("创建 MCP Server 完成，serverInfo: {}, endpoint 数: {}",
                serverInfo, properties.getEndpoints().size());
        return server;
    }
}
```

### 三个 BeanDefinition 分别记录了什么

注册器此时并没有直接创建三个业务对象。它给 Spring 登记的是“如何创建对象”的信息：Bean 类型、工厂 Bean、工厂方法、参数及依赖。

**Transport** 定义记录端点地址，例如：
```
Bean 名称：mcpTransport_A
产品类型：WebMvcStatelessServerTransport
工厂 Bean：multiMcpServerRegistrar
工厂方法：createTransport
方法参数：/mcp/A
```
等 Spring 真正创建该 Bean 时，才调用工厂方法构造 Transport。路径最终进入 Transport 的 HTTP 路由配置。

**Router 定义**使用 `RouterFunction` 作为产品类型，工厂方法为 `createRouter`，并将 `mcpTransport_A` 作为运行时 Bean 引用传入：

```
mcpRouter_A
    └── createRouter(mcpTransport_A)
```

**Server 定义**同样引用对应 Transport：

```
mcpServer_A
    └── createServer(mcpTransport_A)
```

因此，两个端点各自拥有独立的 Transport 和 Server；不会只因为它们位于同一进程，就自动共用一份 MCP 工具注册表。

### 扫描 Swagger 注解注册工具 + 解析注解生成工具描述

核心是 @McpOperation + SwaggerMethodToolCallback。

主要思路是：MultiMcpToolRegistrar：按 endpoint 的 scan-package 扫描 @RestController 方法，找到 @McpOperation 后生成 Tool 并注册到对应 mcpServer\_{name}。

**扫描包并生成工具描述**

```java
/**
 * 多 MCP 工具注册器。
 * 按 endpoint 的 scan-package 扫描工具、资源、提示词与补全，并注册到对应的 MCP server。
 */
@Slf4j
@Component
public class MultiMcpToolRegistrar implements CommandLineRunner {
  private void registerToolsForEndpoint(McpStatelessSyncServer server, Map<String, Object> controllers,
        String scanPackage) {
    List<ToolCallback> swaggerTools = new ArrayList<>();

    for (Object bean : controllers.values()) {
        if (!isPackageScanned(bean.getClass(), scanPackage)) {
            continue;
        }
        if (AnnotatedElementUtils.hasAnnotation(bean.getClass(), Hidden.class)) {
            continue;
        }

        Method[] methods = ReflectionUtils.getUniqueDeclaredMethods(bean.getClass());
        for (Method method : methods) {
            if (AnnotatedElementUtils.hasAnnotation(method, Hidden.class)) {
                continue;
            }

            McpOperation mcpOperation = AnnotatedElementUtils.findMergedAnnotation(method, McpOperation.class);
            if (mcpOperation == null || !mcpOperation.enabled() || mcpOperation.hidden()) {
                continue;
            }

            swaggerTools.add(new SwaggerMethodToolCallback(bean, method, mcpOperation, objectMapper));
        }
    }

    List<SyncToolSpecification> specs = new ArrayList<>();
    for (ToolCallback toolCallback : swaggerTools) {
        specs.add(McpToolUtils.toStatelessSyncToolSpecification(toolCallback, MimeTypeUtils.APPLICATION_JSON));
    }
    for (Object spec : specs) {
        invokeServerMethod(server, "addTool", spec);
    }
}
}
```

**注解解析与描述生成**

SwaggerMethodToolCallback 里完成了 Tool name/description/inputSchema/outputSchema 的构建：

```java
private ToolDefinition createToolDefinition(Map<String, Object> outputSchema) {
    String baseName = (mcpOperation != null && StringUtils.hasText(mcpOperation.toolName()))
            ? mcpOperation.toolName()
            : method.getName();

    String tagPrefix = null;
    Tag tagAnnotation = AnnotatedElementUtils.findMergedAnnotation(bean.getClass(), Tag.class);
    if (tagAnnotation != null && StringUtils.hasText(tagAnnotation.name())) {
        tagPrefix = tagAnnotation.name();
    }

    String name = (tagPrefix != null) ? tagPrefix + "-" + baseName : baseName;

    StringBuilder descriptionBuilder = new StringBuilder();
    String description = mcpOperation != null && StringUtils.hasText(mcpOperation.description())
            ? mcpOperation.description()
            : "";
    String summary = mcpOperation != null && StringUtils.hasText(mcpOperation.summary())
            ? mcpOperation.summary()
            : "";
```

该方法具体做了这些事：

*   工具名：`@Tag(name)` + `@McpOperation.toolName()/methodName` 组合。
    
*   工具描述：拼接 `description/summary/workflow/version/category/dependencies`。
    
*   入参 Schema：递归解析参数类型，并融合 `@Parameter`、`@Schema`、`@Hidden`。
    
*   出参 Schema：解析返回类型（支持泛型、继承、多层对象、枚举、`Object anyOf`）。
    
*   调用执行：JSON 入参反序列化后反射调用 Controller 方法，结果转 JSON 返回。


### 一次完整的工具调用链路

```
① 客户端 POST /mcp/A
   Accept: application/json, text/event-stream
        ↓
② DispatcherServlet → HandlerMapping 链
   RouterFunctionMapping（order = -1，排在 RequestMappingHandlerMapping 之前）
   把所有 RouterFunction Bean 按 orderedStream() 排序后逐个匹配
        ↓  命中 mcpRouter_A（只有它匹配 /mcp/A；/mcp/B 那条不匹配）
③ 调用它的 HandlerFunction = transport::handlePost
        ↓
④ transport.handlePost
   - Accept 不含 application/json 或 text/event-stream → 400
   - request.body(String) → McpSchema.deserializeJsonRpcMessage(jsonMapper, body)
        ↓  得到 JSONRPCRequest(method="tools/call", id=1)
⑤ mcpHandler.handleRequest(transportContext, request)
   （mcpHandler 就是 mcpServer_A 构造时写回来的 DefaultMcpStatelessServerHandler）
        ↓
⑥ DefaultMcpStatelessServerHandler 按 method 查 requestHandlers 表
   → "tools/call" → McpStatelessAsyncServer#toolsCallRequestHandler
        ↓
⑦ toolsCallRequestHandler
   - jsonMapper.convertValue(params) → CallToolRequest
   - 在 this.tools 里按 name 匹配 AsyncToolSpecification
     找不到 → JSONRPCError(INVALID_PARAMS, "Unknown tool")
        ↓
⑧ callHandler.apply(ctx, request)
   - immediateExecution == false → Mono.fromCallable(...).subscribeOn(boundedElastic)
   - immediateExecution == true  → 直接在当前（Servlet）线程执行
        ↓
⑨ McpToolUtils 生成的 handler
   toolCallback.call(json(arguments), new ToolContext(...))
        ↓
⑩ SwaggerMethodToolCallback
   反序列化 JSON → 反射调用 Controller 方法 → Result → JSON 字符串
        ↓
⑪ new CallToolResult([TextContent(json)], isError=false)
   异常则 [TextContent(e.getMessage())], isError=true
        ↓
⑫ .map(result -> new JSONRPCResponse("2.0", id, result, null))，异常转 JSONRPCError
        ↓
⑬ transport：ServerResponse.ok().contentType(application/json).body(jsonrpcResponse)
        ↓
⑭ HTTP 响应回到客户端
```

## 优点和缺点
### 优点
这一套方案的最大的优点就是能够灵活的配置端点和工具集合：
1. 可以按照业务模块暴露MCP端点和工具集合；
2. 也可以按照具体的Agent暴露MCP端点和组合不同业务模块的工具；

### 缺点

只适合所有业务模块单体部署的场景。
如果业务模块拆成微服务的形式部署，可以在网关层提供MCP端点，把Agent的工具调用转成对微服务的接口调用。