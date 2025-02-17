---
title: Tensorflow踩坑记
categories: Tensorflow
tags:
- Tensorflow
---
## 2022-11-15
### 1. Windows下出现 Multiprocessing error without if-clause protection
#### 该问题是怎么引起的？
在Windows操作系统下测试Keras [Question Answering with Hugging Face Transformers](https://keras.io/examples/nlp/question_answering/)的时候，在运行如下代码时程序无法继续运行
```python
tokenized_datasets = datasets.map(
    prepare_train_features,
    batched=True,
    remove_columns=datasets["train"].column_names,
    num_proc=3,
)
```
#### 报错信息
通过查看VSCode的OUTPUT输出信息后，出现如下报错信息
```
RuntimeError:
       An attempt has been made to start a new process before the
       current process has finished its bootstrapping phase.

   This probably means that you are not using fork to start your
   child processes and you have forgotten to use the proper idiom
   in the main module:

       if __name__ == '__main__':
           freeze_support()
           ...

   The "freeze_support()" line can be omitted if the program
   is not going to be frozen to produce an executable.
```
#### 解决方法
该问题和Windows下multiprocessing的实现有关，根据这篇[文档](https://pytorch.org/docs/stable/notes/windows.html#multiprocessing-error-without-if-clause-protection)，我们需要将包含
`
tokenized_datasets = datasets.map(
    prepare_train_features,
    batched=True,
    remove_columns=datasets["train"].column_names,
    num_proc=3,
)
`
的代码封装成一个函数，具体如下
```python
def main()
    #前面的代码
    tokenized_datasets = datasets.map(
        prepare_train_features,
        batched=True,
        remove_columns=datasets["train"].column_names,
        num_proc=3,
    )
    #后面的代码

if __name__ == '__main__':
    main()
```
