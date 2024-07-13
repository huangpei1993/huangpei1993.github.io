---
title: 1094. Car Pooling
date: 2024-07-10 10:42:16
categories: 小小算法
mathjax: true
tags:
- 差分数组
---
## [Car Pooling](https://leetcode.cn/problems/car-pooling/solutions/2550264/suan-fa-xiao-ke-tang-chai-fen-shu-zu-fu-9d4ra/)

### 题解
记$ trip_k $
为 $ (z_k,s_k,t_k) $，
构造数组$x[0...n-1],y[0...n-1]$，
使得$x_{s_k}=z_k,y_{t_k}=z_k$

设在位置$p$时，车里的乘客的数量是$c_p$，则
$$
    c_p=\sum_{i \le p} (x_i-y_i)
$$
其中$x_i,y_i$分别为在位置$i$上车和下车的乘客数。


于是问题转化为，根据差分数组$x[0...n-1],y[0...n-1]$，恢复数组$c[0...n-1]$。

### Java实现
```java
class Solution{
    public boolean carPooling(int[][] trips,int capacity){
        int[] diff = new int[1001];
        for(int[] t:trips){
            diff[t[1]]+=t[0];
            diff[t[2]]-=t[0];
        }
        int total = 0;
        for(int c:diff){
            total+=c;
            if(total>capacity){
                return false;
            }
        }
        return true;
    }
}
```
