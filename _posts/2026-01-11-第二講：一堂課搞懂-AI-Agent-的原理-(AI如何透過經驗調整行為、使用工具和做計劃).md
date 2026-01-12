---
title: "第二講：一堂課搞懂 AI Agent 的原理 (AI如何透過經驗調整行為、使用工具和做計劃)"
date: 2026-01-11  # 文章发布时间
categories: [机器学习] # 你的分类
tags: [笔记]     # 你的标签
math: true
---

## 如何打造AI Agent

![截屏2026-01-12 18.54.10](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-01-12%2018.54.10.png)

当我们把LLM当作AI Agent来使用的时候，其实做的事情没有任何不同，归根到底，就是：
$$
goal\rightarrow obs1\rightarrow action1 \rightarrow obs2 \rightarrow action2 \rightarrow  ... \rightarrow result
$$


如何把LLM当成一个AI Agent？

以Alpha Go为例，对于Typical Agent，就是在`19 * 19`个选择题中，找到一个可能；但是LLM Agent可能会有近乎无限的可能

![截屏2026-01-12 19.10.01](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-01-12%2019.10.01.png)

## AI如何根据经验调整行为

> 在这节课，没有任何模型被训练

![截屏2026-01-12 19.22.29](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-01-12%2019.22.29.png)

内容不包含错误信息 --- 获得错误结果

内容包含错误信息 --- 可能获得正确结果！

把过去所有的经验存起来，并且回顾一生的经验，可能就太长了！

![截屏2026-01-12 19.27.28](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-01-12%2019.27.28.png)

解决方法：给AI一个Memory，通过READ模组选择和当前问题有关的经验，再把这些经验和当前的内容拼接

可以把READ模组想象成一个检索系统，obs 10000就是问题，Memory的长期记忆就是资料库，那就拿着问题从资料库里检索相关信息，这和RAG几乎一样，差别仅仅在于资料库内容的来源

> 与其告诉模型怎么样会做错，不如告诉它怎么做是对的，“不要写太多”不如说“少写一点”

![截屏2026-01-12 20.11.10](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-01-12%2020.11.10.png)

把所有的经验存起来，可能大部分只是无用信息，那也太低效了！

解决方法：加一个WRITE模组，决定什么样的资讯长期放进记忆库，什么额资讯不管他就好了---自己问自己一个问题：“（根据之前的经验），这个问题值得被记下来吗？”并且解答，就好了

除了READ和WRITE，我们还可以有一个REFLECTION模组，对记忆中的资讯进行更抽象、更high-level的重新整理，（比方就利用语言模型本身）得到一些新的sort，或者建立经验和经验之间的关系，生成Knowledge Graph

> 在ChatGPT的个性化界面里有一个记忆界面，会存放“永远不会忘记的事情”

## AI如何使用工具

工具：只要知道怎么使用就好，不需要知道内部运作原理

工具可以看成function，使用工具就是在调用function，也叫“function call”

![截屏2026-01-12 20.45.15](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-01-12%2020.45.15.png)

System Prompt：Agent开发者自己设定，每次使用时会放在最前面，当和User Prompt和它冲突的时候 会优先遵守System Prompt

![截屏2026-01-12 20.47.02](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-01-12%2020.47.02.png)

然而工具很多，该怎么办？

![截屏2026-01-12 20.53.41](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-01-12%2020.53.41.png)

把工具的说明存在Memory里，打造一个Tool Selection的模组，从工具包里选择合适的工具，LLM根据被选择的攻击说明去决定怎么做；语言模型甚至可以自己写一个工具——本质上就是写一个function

当语言模型在做RAG时，会出现internal knowledge和external knowledge互相拉扯的情况

## AI能不能做计划？

会不会AI在做计划的时候根本不知道自己在干嘛？可能只是在网上有相关的资料？

Tree Search方法？通过和现实互动来减少不必要的路径

也有问题：有些动作无法回溯

于是...脑内剧场！

![截屏2026-01-12 21.55.29](https://cdn.jsdelivr.net/gh/HEYWEEN/images@main/images%E6%88%AA%E5%B1%8F2026-01-12%2021.55.29.png)