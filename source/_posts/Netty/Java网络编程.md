---
title: Java 网络编程
date: 2024-07-22 20:42:45
catagories: Netty
tags:
- Java
- BIO
---

## Java原生网络编程-BIO

### 原生JDK网络编程BIO
BIO：即Blocking I/O，即阻塞I/O

BIO的使用步骤：
1. ServerSocket负责绑定IP地址，启动监听端口，等待客户连接；
2. 客户端Socket类的实例发起连接操作；
3. ServerSocket接受连接后产生一个新的服务端Socket实例负责和客户端Socket实例通过输入和输出流进行通信。

```java
public class BIOSocketServer {
    public static void main(String[] args) throws IOException {
        int port = 1993;
        //实例化ServerSocket并绑定端口
        ServerSocket serverSocket = new ServerSocket(port);
        System.out.println("Start Server at "+port);
        try{
            while(true){
                //serverSocket.accept()会一直阻塞，直到有客户端连接
                new Thread(new ServerTask(serverSocket.accept())).start();
            }
        }finally {
        serverSocket.close();
        }
    }

    static class ServerTask implements Runnable{
        private Socket socket;


        public ServerTask(Socket socket){
            this.socket = socket;
        }

        @Override
        public void run() {
            try{
                //获取与客户端通信的输入输出流
                ObjectInputStream inputStream = new ObjectInputStream(socket.getInputStream());
                ObjectOutputStream outputStream = new ObjectOutputStream(socket.getOutputStream());
                //在这里阻塞
                String message = inputStream.readUTF();
                System.out.println("Accept client message:"+message);

                outputStream.writeUTF("Hello!");
                outputStream.flush();

            }catch (Exception e){
                e.printStackTrace();
            }finally {
                try {
                    socket.close();
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
    }
}
```

```java
public class BIOSocketClient {

    public static void main(String[] args) throws IOException {
        String host = "127.0.0.1";
        int port = 1993;
        Socket socket = null;
        ObjectOutputStream outputStream = null;
        ObjectInputStream inputStream = null;

        InetSocketAddress addr = new InetSocketAddress(host, port);
        try {
            socket = new Socket();
            socket.connect(addr);
            System.out.println("Successfully Connected to Server: " + host + ":" + port);

            outputStream = new ObjectOutputStream(socket.getOutputStream());
            inputStream = new ObjectInputStream(socket.getInputStream());

            System.out.println("Ready to send message....");

            outputStream.writeUTF("Hello Server!");
            outputStream.flush();

            System.out.println(inputStream.readUTF());
        }finally {
            if(socket!=null) socket.close();
            if(outputStream!=null) outputStream.close();
            if(inputStream!=null) inputStream.close();
        }
    }
}
```

BIO的阻塞主要体现在两个地方：
1. 若一个服务器启动就绪，那么主线程就一直在等待着客户端的连接，这个等待过程中主线程就一直阻塞。
2. 在连接建立之后，在读取到Socket信息之前，线程也是一直在等待，一直处于阻塞状态。

### 原生JDK网络编程-NIO

**什么是NIO？**
NIO库是在JDK1.4中引入的，用于弥补原来的BIO的不足，它在标准Java代码中提供了高速的、面向块的I/O。NIO被称为no-blocking io或者new io。

#### NIO与BIO的主要区别

**面向流与面向缓冲**

**阻塞与非阻塞IO**

#### NIO之Reactor模式

#### NIO三大核心组件

1. Selector选择器
2. Channel管道
3. Buffer缓冲区