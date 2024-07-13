---
title: 堆排序(Heap Sort)
date: 2024-04-09 12:19:39
tags: 排序算法
categories: 小小算法
mathjax: true
---
## 介绍
> 堆排序是利用堆这种数据结构而设计的一种排序算法，是一种选择排序。
> 二叉堆是一个完全二叉树，即除了最后一层外，其余层都是满的，且最后一层是从左向右填充的。若用数组A[0..A.length-1]表示堆，则节点A[i]的左节点为A[2i+1]，右节点为A[2i+2]，父节点为$\lfloor (i-1)/2 \rfloor$
> 二叉堆有两种：最大堆和最小堆。对于最大堆：A[i]>=A[2i+1]且A[i]>=A[2i+2]；对于最小堆:A[i]<=A[2i+1]且A[i]<=A[2i+2]；

## 算法步骤（升序）
1. 构造初始堆。将给定的无序序列构造成一个大顶堆（升序用大顶，降序用小顶堆）
2. 将堆顶元素与末尾元素进行交换，使末尾元素最大。然后继续调整堆，再将堆顶元素与末尾元素交换，得到第二大元素
3. 重新调整结构，使其满足堆定义，然后继续交换堆顶元素与当前末尾元素（保持当前末尾元素及之后的元素有序）
4. 如此反复，直到整个序列有序

## Python代码实现
```python
def heapify(arr,root,end):
    while True:
        child = 2*root+1 # 左节点的位置
        if child>end: # 左节点在末尾节点之外
            break
        if child+1<=end and arr[child+1]>arr[child]: # 右节点在末尾节点之内，选择左右节点较大者的索引
            child+=1
        if arr[child]>arr[root]: # 三个节点的最大值放在根节点
            arr[child],arr[root] = arr[root],arr[child]
            root = child   # 因为孩子节点的值改变了，所以需要调整该节点往下的堆
        else: # 根节点已经是最大值，即已经满足最大堆性质
            break

def heap_sort(arr):
    n = len(arr)
    first_root = n//2-1 # 找到最深最后的那个根节点的位置
    for root in range(first_root,-1,-1):
        heapify(arr,root,n-1)
    
    for end in range(n-1,0,-1):
        arr[0],arr[end] = arr[end],arr[0]
        heapify(arr,0,end-1)

```

## 应用
### TopK问题（找出前K小的数）
维护一个大小为K的大顶堆，依次将数据放入堆中，当堆满了之后，只需要将堆顶的元素与下一个数比较：
- 如果大于堆顶元素，则直接忽略，比较下一个元素
- 如果小于堆顶元素，将该元素与堆顶元素交换，然后重新建立最大堆
- 重复上面步骤直到全部元素遍历完

```python
def topk(a,k):
    heap = []
    for item in a[:k]:
        heap.append(item)
    if len(heap)<=k:
        return heap
    heapify(heap,0,k-1)
    for item in a[k:]:
        if item>heap[0]:
            continue
        heap[0] = item
        heapify(heap,0,k-1)

    return heap



```