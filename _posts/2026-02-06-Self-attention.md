---
title: "Self-attention"
date: 2026-04-12  # 文章发布时间
categories: [机器学习] # 你的分类
tags: [笔记]     # 你的标签
math: true
---

解决的问题：network的input一直是一个向量，输出可能是一个数值(regression)或者一个类别(classification)，那么，如果输入长度是一个sequence，而且长度不一样呢

## 为什么需要 Self-Attention？

### 输入是一个向量序列

现实中很多任务的输入不是单一向量，而是**长度可变的向量序列**：

- NLP：句子 → 每个词是一个向量（one-hot 或 word embedding）
- 语音：每 10ms 一帧 → 1秒 = 100个向量
- 图：每个节点是一个向量

> One-hot Encoding：开一个很长很长的向量，向量的长度和世界上存在的词汇的数目是一样多的，但是它假设所有的词汇之间是没有关系的，这个向量就失去了语义信息
>
> Word Embedding：给每一个词汇一个向量，包含语义资讯

这类任务统称为 **Sequence Labeling**：输入 N 个向量，输出 N 个标签（如 POS tagging：`I saw a saw` → `N V DET N`）

### 朴素解法的失败

**最简单的做法**：对每个向量独立接一个 FC 层，各自预测标签。

**问题**：FC 是逐元素独立处理的，它不知道当前向量的“上下文”。

`saw` 在 `I saw a saw` 中出现两次，一次是动词、一次是名词。如果每个位置独立处理，FC 永远无法区分这两个 `saw`。

### 扩展思路：用窗口引入上下文

可以让 FC 看一个固定大小的窗口（当前词 ± k 个邻居）。

**但这仍然失败于**：窗口大小固定，无法覆盖长程依赖（如主语和谓语距离很远时）。

> **这就是 Self-Attention 要解决的核心问题：让每个位置都能看到整个序列，且这个"看"是动态的、内容感知的。**



## Self-Attention 的核心思想

ref：[Attention Is All You Need](https://arxiv.org/abs/1706.03762)



![截屏2026-04-12 14.34.55](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2014.34.55.png)

**目标**：对序列中的每个位置 $i$，输出一个新向量 $b^i$，它是整个序列所有位置信息的**加权聚合**，权重由内容相关性决定

本质：**对于输入序列中的每个元素，计算它与序列中所有元素的相关性，然后基于这些相关性加权聚合所有元素的信息**

运作方式：吃一整个sequence的资讯，我input几个vector，就output几个vector，而这几个vector都是考虑整个sequence才输出的，再把这几个资讯丢进fully connected的network，再来决定说他应该是什么样的东西，当然，self-attention可以叠加很多次

形式化表达：


$$
b^i = \sum_j \alpha'_{i,j} \cdot v^j
$$


其中 $\alpha'_{i,j}$ 是位置 $i$ 对位置 $j$ 的注意力权重（即：$i$ 觉得 $j$ 有多重要）。



## 机制


$$
\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V
$$
​					

![截屏2026-04-12 14.52.51](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2014.52.51.png)

input：一串vector，可能是整个network的input，也可能是某个hidden layer的output

coutput：一串vector，数量和input的vector一样

![截屏2026-04-12 15.54.45](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2015.54.45.png)

Self-Attention 的每个输入向量 $a^i$ 会被投影成三个角色的向量，对应三种不同的语义职责：

| 向量            | 公式          | 含义                   |
| --------------- | ------------- | ---------------------- |
| **Query** $q^i$ | $q^i=W_q a^i$ | “我想找什么样的信息”   |
| **Key** $k^i$   | $k^i=W_k a^i$ | “我能提供什么样的信息” |
| **Value** $v^i$ | $v^i=W_v a^i$ | “我实际携带的信息内容” |

$W_q, W_k, W_v$ 是可学习的参数矩阵，整个模型只有这三组参数（加上最后的输出变换）



### Step 1：计算注意力分数（Attention Score）

![截屏2026-04-12 15.07.39](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2015.07.39.png)

对位置 i（query $q^i$）和每个位置 $j$（key $k^j$）做点积：



$$
\alpha_{i,j} = q^i \cdot k^j
$$



**直觉**：点积衡量两个向量的"方向相似性"。如果 $q^i$ 和 $k^j$ 方向接近，说明位置 i 认为位置 $j$ 和自己相关。

> ⚠️ **注意**：位置 i 也会和自己（$k^i$）计算分数，自注意是允许的！



> 为了防止点积数值过大导致梯度消失，我们会除以一个缩放(scaling)因子（通常是 $\sqrt{d_k}$，即 Key 向量维度的平方根）

### Step 2：Softmax 归一化

<img src="https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2016.13.56.png" alt="截屏2026-04-12 16.13.56" style="zoom:33%;" />



$$
\alpha'*{1,j} = \frac{\exp(\alpha*{1,j})}{\sum_k \exp(\alpha_{1,k})}
$$



将原始分数转换为概率分布（和为 1），便于后续加权求和。

### Step 3：加权聚合 Value

<img src="https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2016.14.50.png" alt="截屏2026-04-12 16.14.50" style="zoom:33%;" />


$$
b^1 = \sum_j \alpha'_{1,j} \cdot v^j
$$


用注意力权重对所有位置的 value 做加权求和，得到位置 1 的输出向量。

### 关键点：所有位置并行计算

$b^1, b^2, b^3, b^4$ 可以**同时计算**，不存在序列依赖！这是 Self-Attention 相比 RNN 的核心工程优势。



## 矩阵化表达（真实实现）

把所有输入向量拼成矩阵 $I$，整个流程变成：


$$
Q = W_q I, \quad K = W_k I, \quad V = W_v I
$$

$$
A = K^T Q \quad \text{（所有 query-key 点积，一次矩阵乘法）}
$$

$$
A' = \text{softmax}(A) \quad \text{（按列做 softmax）}
$$

$$
O = V A' \quad \text{（输出矩阵）}
$$


**整个 Self-Attention 是两次矩阵乘法 + 一次 softmax**，可以被硬件（GPU/TPU）极度并行化。



## Multi-Head Self-Attention

**问题**：单组 Q/K/V 只能捕捉一种类型的相关性。但"相关"可以有多种含义（语法依存、语义相似、指代关系……）。

**解法**：用多组 $W_{q,h}, W_{k,h}, W_{v,h}$ 独立计算多个注意力头，每个头关注不同类型的关系：


$$
q^{i,h} = W_{q,h} q^i, \quad k^{i,h} = W_{k,h} k^i
$$


每个头独立产生 $b^{i,h}$，最后拼接后经过 $W_O$ 投影合并：


$$
b^i = W_O [b^{i,1}; b^{i,2}; \ldots]
$$


## Positional Encoding：一个关键缺陷的修补

<img src="https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2016.39.10.png" alt="截屏2026-04-12 16.39.10" style="zoom:25%;" />

Self-Attention 的计算是**置换不变的（permutation invariant）**：调换输入序列的顺序，每个位置的输出不变（只是输出顺序也随之改变）。

这意味着它天然**没有位置信息**——`saw` 在位置 2 还是位置 4 对模型来说没有区别。

**解法**：为每个位置 $i$ 添加一个位置向量 $e^i$，与输入相加后再送入 Self-Attention：


$$
\tilde{a}^i = a^i + e^i
$$


$e^i$ 有两种实现方式：

- **手工设计**（Sinusoidal，原始 Transformer）：用不同频率的正余弦函数构造，具有外推性
- **从数据学习**（Learned Positional Embedding，BERT）：直接学习每个位置的向量，更灵活但无法外推到训练时未见过的长度

> 这是一个**工程补丁**，Self-Attention 本身对顺序无感，Positional Encoding 是强行注入位置信息的手段。



## Self-Attention 的位置与连接

Self-Attention 层不是单独使用的，而是与 FC 层交错堆叠：

```
Input
  ↓
[Self-Attention]  ← 负责"整合上下文"
  ↓
[FC]              ← 负责"基于上下文做预测/变换"
  ↓
[Self-Attention]
  ↓
[FC]
  ↓
Output
```

Self-Attention 的输入可以是原始 embedding，也可以是某个隐层的输出。



## Self-Attention vs. RNN vs. CNN 的对比

![截屏2026-04-12 16.52.02](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2016.52.02.png)

| 维度       | RNN                            | CNN                    | Self-Attention               |
| ---------- | ------------------------------ | ---------------------- | ---------------------------- |
| 长程依赖   | 难（信息需逐步传递，容易遗忘） | 难（受限于感受野大小） | 容易（任意两位置直接计算）   |
| 并行化     | ❌ 必须逐步计算                 | ✅                      | ✅                            |
| 归纳偏置   | 局部顺序                       | 局部空间               | 无（更灵活，但需要更多数据） |
| 计算复杂度 | O(L)                           | O(L)                   | O(L²)（注意力矩阵）          |

**关键洞见**：

- **CNN 是 Self-Attention 的受限版本**：CNN 只在固定感受野内做注意力，Self-Attention 是“感受野大小可学习”的 CNN
- **数据量影响选择**：少数据时 CNN 因其归纳偏置（局部平移不变性）更占优；大数据时 Self-Attention 的灵活性更能发挥（ViT vs ResNet 的实验验证了这点）

> ### Self-attention for Image
>
> ![截屏2026-04-12 16.43.25](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2016.43.25.png)
>
> ![截屏2026-04-12 16.43.40](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2016.43.40.png)



> ### Self-attention for Graph
>
> <img src="https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2016.55.40.png" alt="截屏2026-04-12 16.55.40" style="zoom:67%;" />

## 局限性与工程实际

- **O(L²) 的注意力矩阵**：序列很长时（如语音，1秒=100帧）计算和存储代价极高
  - **工程解法**：Truncated Self-Attention（只在局部窗口内计算注意力）
  - ref：[Transformer-Transducer: End-to-End Speech Recognition with Self-Attention](https://arxiv.org/abs/1910.12977)
  - <img src="https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-04-12%2016.39.39.png" alt="截屏2026-04-12 16.39.39" style="zoom: 33%;" />
  - **理论解法**：Linformer、Performer 等近似方法（Linear Attention）
- **无法处理带结构约束的图**：标准 Self-Attention 对所有节点对都计算注意力，图结构中可以限制只关注边相连的节点 → 这就是 Graph Attention Network (GAT)
- **Positional Encoding 的外推问题**：学习到的位置编码在推理时遇到超过训练长度的序列会退化



## 总结

Self-Attention 是一个**动态的、内容感知的、全局的特征聚合机制**。它解决了 FC 无法感知上下文、RNN 无法并行、CNN 感受野固定这三个问题，代价是 O(L²) 的计算复杂度和需要 Positional Encoding 来补充位置信息。
