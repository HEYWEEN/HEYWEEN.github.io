---
title: "并发控制：同步（Synchronization）"
date: 2026-04-22  # 文章发布时间
categories: [操作系统] # 你的分类
tags: [笔记]     # 你的标签
math: true

---

## 1. 回顾：互斥的局限性

### 1.1 我们已经有了什么

在前几讲中，我们学习了：

- **线程创建**：`spawn(fn)` 创建线程，`join()` 等待所有线程完成
- **互斥锁**：`mutex_lock` / `mutex_unlock`，保护共享变量，防止数据竞争

通过互斥锁，我们终于能正确地计算 `1 + 1`：两个线程对共享计数器的并发访问被序列化，不再产生错误结果。

### 1.2 互斥的本质

互斥锁所提供的保证是：**同一时刻，至多一个线程进入临界区**。

用执行顺序来说，互斥保证了：对于任意两个线程 A 和 B，其临界区的执行要么 A 先、要么 B 先——**但具体是谁先，互斥锁没有意见，也无法控制**。

```
互斥的语义：
  A 的临界区 → B 的临界区    （允许）
  B 的临界区 → A 的临界区    （允许）
  A 的临界区 ∥ B 的临界区    （禁止，这正是互斥要阻止的）
```

### 1.3 互斥没有解决的问题

考虑 `join()` 的实现：主线程需要等待所有子线程**都结束**之后才能继续。这不是"互斥访问"的问题，而是"**事件 X 发生了，我才能继续**"的问题——即**建立确定的执行先后顺序**。

更一般地，很多并发场景需要的不是"防止同时"，而是"保证先后"：

| 场景           | 需要的顺序                  |
| -------------- | --------------------------- |
| `join()` 返回  | 所有子线程结束 → 主线程继续 |
| 从缓冲区取数据 | 生产者写入 → 消费者读取     |
| 等待用户输入   | 用户按回车 → 程序继续处理   |
| 乐团演奏       | 指挥挥棒 → 乐手开始演奏     |

这些问题的共同特点是：**存在某个条件，只有当条件满足时，当前线程才能继续执行**。这就是**同步（Synchronization）**要解决的问题。

---

## 2. 什么是同步

### 2.1 定义

> **同步**：两个或两个以上随时间变化的量，在变化过程中保持某种**确定的相对关系**。

在并发编程中，"同步"的含义是：控制多个线程的执行顺序，使得特定的事件 A **一定发生在**事件 B **之前**，即建立 **happens-before** 关系：

```
事件 A  happens-before  事件 B
```

### 2.2 人类世界中的同步

我们在日常生活中其实一直在"做同步"：

- **约好时间见面**："今晚 23:59:59 大活门口，不见不散"  
  → 双方都等到彼此到达（条件满足），然后才开始下一步行动
- **乐团演奏**：所有乐手等指挥挥棒（信号），再同步开始演奏
- **同步电路**：触发器在时钟上升沿到来（条件）后，才将输入锁存到输出

用代码来表示这些直觉：

```c
// 等待时钟上升沿（同步电路）
while (!posedge(clk)) ;  // await posedge(clk)
ff_out = ff_in;

// 等待所有线程完成（thread join）
spawn(T_1); spawn(T_2); ... spawn(T_n);
while (!all_threads_done()) ;  // await all_threads_done()

// 等待朋友到达（约好见面）
study_until(23, 50, 00);
goto("大活门口");
while (!friend_arrived()) ;    // await friend_arrived()
```

三个例子的结构完全相同：**等待某个条件成立，然后继续执行**。

### 2.3 同步点的意义

当"握手"发生的那一刻，系统达到了一个**全局同步点（synchronization point）**——这是一个"全局意义上容易理解的状态"。

同步点的价值在于：

- **建立 happens-before**：同步点之前所有的内存写操作，对同步点之后的所有线程**都可见**
- **消除不确定性**：进入同步点之前，各线程的进度可以任意；过了同步点，我们知道某些事情已经确定发生了

### 2.4 同步 vs. 互斥：对比

|                | 互斥                         | 同步                                     |
| -------------- | ---------------------------- | ---------------------------------------- |
| **解决的问题** | 共享资源的安全访问           | 事件的先后顺序控制                       |
| **语义**       | 同一时刻只有一个线程在临界区 | 事件 A 必须在事件 B 之前发生             |
| **关键操作**   | lock / unlock                | wait（等待条件）/ signal（通知条件满足） |
| **典型工具**   | `mutex_t`                    | 条件变量 `cond_t`，信号量 `sem_t`        |
| **类比**       | 厕所只能一个人用             | 先排队领票，再入场                       |

> **注意**：同步通常需要互斥配合。条件本身是共享状态，读写条件也需要在锁的保护下进行。

---

## 3. 朴素实现：自旋等待

### 3.1 最直接的想法

"等待某个条件成立"，最朴素的实现就是**不断循环检查**，直到条件为真：

```c
// 版本 0：最朴素的自旋（错误示例！）
while (!condition) {
    // 什么都不做，一直检查
}
// 条件成立，继续执行
```

但 `condition` 是共享状态，读取它也需要锁保护。于是：

```c
// 版本 1：加锁保护条件检查
do {
    mutex_lock(&lk);
    can_proceed = check_condition();  // 在锁内安全地读取共享状态
    mutex_unlock(&lk);
} while (!can_proceed);

assert(can_proceed);
```

### 3.2 自旋的正确性分析

乍一看，上面的代码有个问题：**检查条件和后续操作之间有空隙**。

```
线程 A:
    check_condition() → true     ← 此刻条件成立
    mutex_unlock()               ← 释放锁
    [被抢占]                     ← 操作系统切换到线程 B
                                 ← 线程 B 改变了状态，条件不再成立
    assert(can_proceed)          ← 断言失败！
```

因此，正确的做法是把**条件检查**和**后续操作**放在**同一个临界区**内：

```c
// 版本 2：检查条件和后续操作在同一临界区
// （这就是 pc-2.c 的写法）
mutex_lock(&lk);
if (!(depth < n)) {
    mutex_unlock(&lk);
    goto retry;        // 条件不满足，释放锁重试
}
// 此时持有锁，且条件成立——二者缺一不可
assert(depth < n);
printf("(");
depth++;
mutex_unlock(&lk);
```

> **关键洞察**：持有锁的期间，其他线程无法修改共享状态，所以此时断言 `assert(depth < n)` 是安全的。条件检查与操作必须在同一个临界区内。

### 3.3 自旋的根本缺陷

自旋等待（busy waiting / spin waiting）有一个本质性的缺陷：**当条件不满足时，线程仍在运行，白白消耗 CPU 时间**。

```
时间线：
  线程 A（等待条件）：
    [spin] [spin] [spin] [spin] [spin] ... [条件满足] [继续]
    ←——— 这段时间全部浪费在空转上 ———→

  线程 B（可以使条件满足）：
    [等待 CPU 时间片]  ← 可能因为 A 在自旋占用 CPU 而被延迟！
```

在极端情况下，自旋甚至会造成**活锁**：A 在等 B 改变状态，B 在等 A 释放某个资源，但 A 还在自旋……

---

## 4. 条件变量：让操作系统来帮忙

### 4.1 核心思想

自旋的问题在于：线程"自己"去反复检查条件。更好的方式是：

1. 条件不满足时，线程**主动告诉操作系统**："我要等这个条件，先让我睡着"
2. 当某个线程**改变了可能使条件成立的状态**后，通知操作系统："去唤醒那些等待的线程"
3. 被唤醒的线程重新检查条件，若满足则继续执行

这就是**条件变量（Condition Variable）**的设计思路。

### 4.2 API 详解

```c
// 声明与初始化
cond_t cv = COND_INIT();

// 等待
void cond_wait(cond_t *cv, mutex_t *lk);

// 唤醒
void cond_signal(cond_t *cv);     // 唤醒一个等待者
void cond_broadcast(cond_t *cv);  // 唤醒所有等待者
```

**`cond_wait` 的精确语义**（这是最容易误解的地方）：

```
cond_wait(&cv, &lk) 做了以下三件事（原子地完成前两件）：
  1. 释放互斥锁 lk          ← 允许其他线程进入临界区
  2. 使当前线程进入睡眠      ← 不再占用 CPU
  （以上两步是原子的，不可分割）
  3. 被唤醒后，重新持有 lk   ← 线程继续运行前先拿到锁
```

> **为什么步骤 1 和 2 必须是原子的？**  
> 假设不是原子的：线程 A 释放了锁（步骤 1），还没睡着（步骤 2），此时线程 B 获取锁，修改状态，调用 `cond_signal`。由于 A 还没睡，这个信号就**丢失**了。A 随后进入睡眠，永远不会被唤醒——这是一种经典的**唤醒丢失（lost wakeup）**问题。  
> 操作系统通过将"释放锁"与"进入等待队列"设计为原子操作来避免这一问题。

### 4.3 万能同步模板

掌握条件变量的使用，只需记住这一个代码模板。所有同步问题，最终都是这个结构的变体：

```c
// ============================================================
// 角色 1：修改状态的线程（"通知者"）
// ============================================================
mutex_lock(&lk);

// 修改可能使 sync_cond() 成立的共享状态
// ...

cond_broadcast(&cv);    // 告知所有等待者：状态已改变，请重新检查条件
mutex_unlock(&lk);


// ============================================================
// 角色 2：等待条件的线程（"等待者"）
// ============================================================
mutex_lock(&lk);

while (!sync_cond()) {          // ⚠️ 必须是 while，不能是 if（原因见下文）
    cond_wait(&cv, &lk);        // 原子地：释放 lk，进入睡眠
                                // 被唤醒后：重新持有 lk，继续循环检查
}

// 到达此处：sync_cond() 为真，且持有锁 lk
// 可以安全地操作共享状态
assert(sync_cond());
// ...

mutex_unlock(&lk);
```

### 4.4 为什么等待条件必须用 `while` 而不是 `if`？

这是使用条件变量**最常见的错误**，必须彻底理解。

**原因一：虚假唤醒（Spurious Wakeup）**

POSIX 标准允许 `cond_wait` 在没有任何 `signal`/`broadcast` 的情况下返回。这不是 bug，而是允许操作系统内部优化的设计妥协。如果使用 `if`，虚假唤醒后会直接跳过检查，执行本不该执行的代码。

**原因二：竞争窗口（Race after Wakeup）**

更常见的情况：`broadcast` 唤醒了**多个**等待线程，它们**逐个**竞争锁。

```
场景：n=1，depth=0，有 2 个 producer 线程 P1、P2

初始：depth=0，P1 和 P2 都在等待 depth < 1（即 depth == 0）

步骤 1：consumer 将 depth 从 1 变回 0，调用 broadcast
步骤 2：P1 和 P2 都被唤醒，开始竞争锁
步骤 3：P1 先拿到锁，检查 depth < 1 ✓，执行 depth++，depth=1，释放锁
步骤 4：P2 拿到锁：
  - 如果用 if：直接向下执行，不再检查！此时 depth=1，不满足 depth < 1，
    执行 depth++ 后 depth=2 → ❌ 破坏了缓冲区大小限制！
  - 如果用 while：重新检查 depth < 1，发现 depth=1 不满足，继续等待 ✓
```

**结论**：`while` 确保每次从 `cond_wait` 返回后都重新检查条件，无论是被正常唤醒还是虚假唤醒。这是正确性保证的基石。

### 4.5 `signal` vs `broadcast`：如何选择

|            | `cond_signal`                                        | `cond_broadcast`                      |
| ---------- | ---------------------------------------------------- | ------------------------------------- |
| **行为**   | 唤醒等待队列中的**一个**线程（通常是等待时间最长的） | 唤醒**所有**等待的线程                |
| **性能**   | 更高效，减少不必要的上下文切换                       | 可能有"惊群效应"（thundering herd）   |
| **安全性** | 只在**能精确保证唤醒正确线程**时使用                 | 保守但正确，配合 `while` 使用始终安全 |

**何时可以用 `signal`**：当你能保证"被唤醒的任意一个线程"都能正确处理当前状态。例如：

- 计算图中，节点 u 完成后通知特定后继节点 v（只有一个等待者）
- 为 producer 和 consumer 各维护一个独立的 cv（`signal` 的目标类型明确）

**何时必须用 `broadcast`**：当所有等待线程共享同一个 cv，且不同线程在等待不同的条件时。如果此时用 `signal`，可能唤醒的是一个"条件仍不满足"的线程，而真正满足条件的线程继续睡眠——造成**活锁**或**程序停滞**。

> **工程建议**：新手在不确定时，始终使用 `broadcast`。配合 `while` 循环，`broadcast` 保证正确；性能优化可以在确定正确后再做。

---

## 5. 案例一：乐团同步

### 5.1 问题描述

乐团有 4 个乐手线程（`T_player`）和 1 个指挥线程（`T_conductor`）。规则：

- 每个乐手必须**等到指挥的信号**后，才能演奏当前拍子
- 指挥每次输入一行，释放一拍信号
- 确保同步：第 i 拍的演奏必须 happens-after 第 i 次指挥信号

### 5.2 共享状态

```c
int conductor_beat = 0;  // 指挥已经发出的拍子数（由指挥修改）
```

每个乐手维护自己的 `current_beat`（当前要演奏的拍子编号），当 `current_beat < conductor_beat` 时，说明指挥已经发出了这一拍的信号，可以继续演奏。

### 5.3 实现演进

**版本一：自旋等待（orchestra.c）**

```c
// orchestra.c
static mutex_t lk = MUTEX_INIT();
extern int conductor_beat;

void wait_for_beat(int current_beat) {
retry:
    mutex_lock(&lk);
    int conductor_beat_ = conductor_beat;  // 在锁内读取共享变量
    mutex_unlock(&lk);
    if (current_beat >= conductor_beat_) {
        goto retry;  // 条件不满足，释放锁后立即重试（自旋）
    }
    // current_beat < conductor_beat，可以演奏
}

void release_beat() {
    mutex_lock(&lk);
    conductor_beat++;
    mutex_unlock(&lk);
}
```

**问题**：4 个乐手线程在等待期间持续占用 CPU，做无效的循环。如果乐手很多（想象 100 人交响乐团），CPU 全被自旋占满，指挥线程可能根本抢不到 CPU 来发送信号。

**版本二：条件变量（orchestra-cv.c）**

```c
// orchestra-cv.c
static mutex_t lk = MUTEX_INIT();
cond_t cv = COND_INIT();
extern int conductor_beat;

void wait_for_beat(int current_beat) {
    mutex_lock(&lk);
    while (!(current_beat < conductor_beat)) {  // while 循环
        cond_wait(&cv, &lk);  // 睡眠，等待指挥的信号
    }
    // 条件满足：current_beat < conductor_beat
    mutex_unlock(&lk);
}

void release_beat() {
    mutex_lock(&lk);
    conductor_beat++;
    cond_broadcast(&cv);  // 唤醒所有正在等待的乐手
    mutex_unlock(&lk);
}
```

**改进**：

- 等待的乐手线程**不再占用 CPU**，操作系统将它们放入等待队列
- `release_beat` 调用 `cond_broadcast` 后，操作系统将所有乐手唤醒，各自检查条件，满足后继续演奏

### 5.4 乐手和主函数

```c
// main.c（被 orchestra.c / orchestra-cv.c include）
int conductor_beat = 0;

// Canon in D 的音符表（4 个声部 × 8 拍）
const char *Canon_in_D[4][8] = {
    {"D4", "A3", "B3", "F#3", "G3", "D3", "G3", "A3"},
    {"A3", "E3", "F#3", "C#3", "D3", "A2", "D3", "E3"},
    {"F#3", "C#3", "D3", "A3", "B2", "F#2", "B2", "C#3"},
    {"D3", "A2", "B2", "F#2", "G2", "D2", "G2", "A2"},
};

void T_player(int id) {
    for (int i = 0; i < 8; i++) {
        wait_for_beat(i);  // 等待指挥发出第 i 拍信号
        const char *note = Canon_in_D[id - 1][i];
        char cmd[128];
        sprintf(cmd, "ffplay -nodisp -autoexit -loglevel quiet notes/%s.wav > /dev/null &", note);
        system(cmd);  // 播放音符
    }
}

void T_conductor() {
    char buf[32];
    while (1) {
        printf("(conductor) > ");
        if (!fgets(buf, sizeof(buf), stdin)) exit(0);
        release_beat();  // 每次回车，发出一拍信号
    }
}

int main() {
    for (int i = 0; i < 4; i++) spawn(T_player);
    spawn(T_conductor);
}
```

这个例子展示了条件变量最核心的应用场景：**一个线程等待另一个线程产生某个事件**。

---

## 6. 经典问题：生产者-消费者

### 6.1 为什么这个问题重要

> **99% 的实际并发问题都可以用生产者-消费者建模。**

在真实系统中，几乎随处可见这种模式：

- **Web 服务器**：主线程接收请求（生产者），工作线程处理请求（消费者），请求队列是缓冲区
- **编译器流水线**：词法分析器产生 token（生产者），语法分析器消费 token（消费者）
- **日志系统**：业务线程写日志（生产者），日志写入线程刷盘（消费者）
- **Master-Worker 模式**：主线程分发任务（生产者），工作线程执行任务（消费者）

### 6.2 问题定义

- 一个**有界缓冲区**（Bounded Buffer），容量为 `n`
- **Producer 线程**：缓冲区未满（`depth < n`）时放入数据；否则等待
- **Consumer 线程**：缓冲区非空（`depth > 0`）时取走数据；否则等待
- **同步约束**：对同一个对象，生产 happens-before 消费

### 6.3 等价的括号序列表述

为了便于验证输出的正确性，可以将问题等价转化为：

```c
void T_produce() { printf("("); }  // 生产 = 打印左括号
void T_consume() { printf(")"); }  // 消费 = 打印右括号
```

**正确性条件**（等价于缓冲区语义）：

1. **合法括号序列**：任意前缀中，左括号数 ≥ 右括号数（不能先消费再生产）
2. **嵌套深度 ≤ n**：任意时刻，未匹配的左括号数 ≤ n（缓冲区容量限制）

```
n=3 时的合法输出：
  ((()))      ✅  深度峰值 = 3
  (()())      ✅  深度峰值 = 2
  ((())())((( ✅  未完成，但合法

n=3 时的非法输出：
  (((())      ❌  深度 = 4 > n
  ())         ❌  前缀 () 后第 3 字符 ) 使深度变 -1
```

通过观察程序的括号输出，可以立即判断同步是否正确实现。

### 6.4 实现演进：从错误到正确

#### 阶段一：两次加锁的自旋（pc-1.c）——错误！

```c
// pc-1.c：存在竞态条件的错误实现
mutex_t lk = MUTEX_INIT();
int n, depth = 0;

void T_produce() {
    while (1) {
    retry:
        mutex_lock(&lk);
        int ready = (depth < n);   // 检查条件
        mutex_unlock(&lk);         // ← 释放锁！
        if (!ready) goto retry;

        // ⚠️ 危险区：此时没有持有锁！
        // 其他线程可能在这里修改 depth
        mutex_lock(&lk);
        printf("(");
        depth++;                   // 基于刚才读到的条件操作，但条件可能已变！
        mutex_unlock(&lk);
    }
}
```

**Bug 分析**：

```
时间线（n=1）：
  P1: depth=0, ready=true, 释放锁 ← 条件满足
  P2: depth=0, ready=true, 释放锁 ← 条件满足（P1 还没写入！）
  P1: 获取锁，depth++=1，释放锁
  P2: 获取锁，depth++=2 ← depth 超过了 n=1！❌
```

问题在于：**条件检查与后续操作之间的空隙**（经典的 check-then-act 竞态条件）。

#### 阶段二：单次加锁的自旋（pc-2.c）——正确但低效

```c
// pc-2.c：正确的自旋实现
void T_produce() {
    while (1) {
    retry:
        mutex_lock(&lk);
        if (!(depth < n)) {
            mutex_unlock(&lk);
            goto retry;   // 条件不满足，释放锁重试
        }
        // 此时持有锁，且 depth < n 成立
        // 因为持有锁，其他线程无法修改 depth，断言安全
        assert(depth < n);
        printf("(");
        depth++;
        mutex_unlock(&lk);
    }
}

void T_consume() {
    while (1) {
    retry:
        mutex_lock(&lk);
        if (!(depth > 0)) {
            mutex_unlock(&lk);
            goto retry;
        }
        assert(depth > 0);
        printf(")");
        depth--;
        mutex_unlock(&lk);
    }
}
```

正确性：检查条件与操作在**同一个临界区**内，持有锁期间无人能修改 `depth`，断言安全。

缺陷：仍然是自旋，条件不满足时反复获取/释放锁，浪费 CPU。

#### 阶段三：条件变量（pc-cv.c）——❌ 还是有 bug！

这是一个刻意构造的**有 bug 的版本**，用于教学：

```c
// pc-cv.c：使用 if 而非 while，存在 bug！
int n, depth = 0;
mutex_t lk = MUTEX_INIT();
cond_t cv = COND_INIT();

#define CAN_PRODUCE (depth < n)
#define CAN_CONSUME (depth > 0)

void T_produce() {
    while (1) {
        mutex_lock(&lk);
        if (!CAN_PRODUCE) {          // ⚠️ 用了 if！
            cond_wait(&cv, &lk);
            // 被唤醒后直接向下，不重新检查！
        }
        printf("(");
        depth++;
        cond_signal(&cv);            // ⚠️ 用了 signal！
        mutex_unlock(&lk);
    }
}

void T_consume() {
    while (1) {
        mutex_lock(&lk);
        if (!CAN_CONSUME) {          // ⚠️ 用了 if！
            cond_wait(&cv, &lk);
        }
        printf(")");
        depth--;
        cond_signal(&cv);            // ⚠️ 用了 signal！
        mutex_unlock(&lk);
    }
}
```

**两个 Bug**：

**Bug 1：`if` 而非 `while`**（前面已分析）

被唤醒后不重新检查，可能在条件不满足的情况下继续执行。

**Bug 2：`signal` 而非 `broadcast`**

```
场景：n=1，1 个 producer P，2 个 consumer C1、C2

初始状态：depth=1，P 等待（缓冲区满），C1 和 C2 都在等待（似乎奇怪，但可能发生）
  
步骤：
  某人消费，depth=0，调用 signal
  唤醒了 P（而非 C1 或 C2）
  P 生产，depth=1，调用 signal
  唤醒了 C1
  C1 消费，depth=0，调用 signal
  这次唤醒了 C2（而非 P）
  C2 检查 depth > 0 → false（因为用了 if，跳过检查）
  C2 执行 depth--，depth=-1 ❌
```

`signal` 的问题：当 producer 和 consumer 共用同一个 cv 时，producer 可能唤醒的是另一个 producer，consumer 可能唤醒的是另一个 consumer，从而形成连锁错误。

#### 阶段四：正确实现（pc-cv-broadcast.c）——✅ 正确且高效

```c
// pc-cv-broadcast.c：正确的条件变量实现
int n, depth = 0;
mutex_t lk = MUTEX_INIT();
cond_t cv = COND_INIT();

#define CAN_PRODUCE (depth < n)
#define CAN_CONSUME (depth > 0)

void T_produce() {
    while (1) {
        mutex_lock(&lk);
        while (!CAN_PRODUCE) {       // ✅ while 循环
            cond_wait(&cv, &lk);
            // 被唤醒后，重新检查 CAN_PRODUCE
        }
        // 到此：持有锁，且 CAN_PRODUCE 成立
        assert(CAN_PRODUCE);
        printf("(");
        depth++;
        cond_broadcast(&cv);         // ✅ broadcast，唤醒所有等待者
        mutex_unlock(&lk);
    }
}

void T_consume() {
    while (1) {
        mutex_lock(&lk);
        while (!CAN_CONSUME) {       // ✅ while 循环
            cond_wait(&cv, &lk);
        }
        printf(")");
        depth--;
        cond_broadcast(&cv);         // ✅ broadcast
        mutex_unlock(&lk);
    }
}
```

**正确性保证**：

- `while` 确保每次被唤醒后都重新检查条件，即使是虚假唤醒或竞争后条件已变
- `broadcast` 确保所有可能满足条件的线程都被唤醒，不会有线程"错过"自己的唤醒信号
- `assert(CAN_PRODUCE)` 在持有锁且通过 `while` 检查后执行，100% 安全

### 6.5 四个版本的演进总结

| 版本                   | 文件              | 条件检查       | 同步机制    | 问题                         |
| ---------------------- | ----------------- | -------------- | ----------- | ---------------------------- |
| 两次加锁自旋           | pc-1.c            | 检查与操作分离 | 自旋        | **竞态条件**，check-then-act |
| 单次加锁自旋           | pc-2.c            | 同一临界区     | 自旋        | 正确，但**浪费 CPU**         |
| cv + if + signal       | pc-cv.c           | `if`           | `signal`    | **可能 depth<0 或 depth>n**  |
| cv + while + broadcast | pc-cv-broadcast.c | `while`        | `broadcast` | ✅ 正确且高效                 |

---

## 7. 案例二：奇怪的同步问题（鱼骨打印）

### 7.1 问题描述

有三种线程，每种若干个：

- `T_a`：死循环打印 `<`
- `T_b`：死循环打印 `>`
- `T_c`：死循环打印 `_`

目标：同步这些线程，使得屏幕输出**只能是** `<><_` 和 `><>_` 的不断重复。

```
合法输出：<><_><>_<><_><>_...
非法输出：<<><_  或  <>>_  或  <><><_  等
```

这个问题乍看很奇怪，但它完美地展示了**条件变量的通用性**：只要能形式化描述"什么时候可以打印某个字符"，就能用条件变量解决任意同步问题。

### 7.2 建模：有限状态机

将合法序列的生成规则建模为**状态机**：

```
状态：A → B → C → D → A → ...（循环）

转移规则：
  A --'<'--> B
  B --'>'--> C
  C --'<'--> D
  D --'_'--> A   （第一条路径：<><_）

  A --'>'--> E
  E --'<'--> F
  F --'>'--> D
  D --'_'--> A   （第二条路径：><>_）
```

用代码表示：

```c
enum { A = 1, B, C, D, E, F };

struct rule {
    int from, ch, to;
} rules[] = {
    {A, '<', B},
    {B, '>', C},
    {C, '<', D},
    {A, '>', E},
    {E, '<', F},
    {F, '>', D},
    {D, '_', A},
};
```

### 7.3 同步条件的形式化

> 线程可以打印字符 `ch` 的条件：  
> **存在一条规则，其 `from` == 当前状态 `current` 且 `ch` == 该规则的字符**

```c
int current = A, quota = 1;  // current: 当前状态；quota: 允许同时打印的线程数

int next(char ch) {
    for (int i = 0; i < LENGTH(rules); i++) {
        if (rules[i].from == current && rules[i].ch == ch)
            return rules[i].to;
    }
    return 0;  // 无匹配规则，不能打印
}

static int can_print(char ch) {
    return next(ch) != 0 && quota > 0;
    // next(ch) != 0：当前状态允许打印 ch
    // quota > 0：当前没有其他线程正在打印（互斥地打印）
}
```

### 7.4 完整实现（fish.c）

```c
mutex_t lk = MUTEX_INIT();
cond_t cv = COND_INIT();

// 打印前：等待条件满足，然后"预订"配额
void fish_before(char ch) {
    mutex_lock(&lk);
    while (!can_print(ch)) {         // 等待：当前状态允许打印 ch
        cond_wait(&cv, &lk);
    }
    quota--;                         // 占用配额，防止其他线程同时打印
    mutex_unlock(&lk);
}

// 打印后：更新状态，通知其他线程
void fish_after(char ch) {
    mutex_lock(&lk);
    quota++;                         // 释放配额
    current = next(ch);              // 推进状态机
    assert(current);
    cond_broadcast(&cv);             // 唤醒所有等待者，让他们重新检查条件
    mutex_unlock(&lk);
}

const char roles[] = ".<<<<<>>>>___";  // 各线程的角色（'.' 是主线程占位）

void fish_thread(int id) {
    char role = roles[id];
    while (1) {
        fish_before(role);
        putchar(role);               // 实际打印（不在锁内）
        fish_after(role);
    }
}

int main() {
    setbuf(stdout, NULL);            // 关闭缓冲，立即输出
    for (int i = 0; i < strlen(roles); i++)
        spawn(fish_thread);
}
```

### 7.5 这个案例的深刻含义

**思考**：为什么 `putchar(role)` 不在锁内执行？

因为 `quota` 的设计保证了：在任意时刻，只有一个线程持有非零 quota 并在 `fish_before` 和 `fish_after` 之间运行。`fish_before` 将 `quota--` 设为 0，其他线程的 `can_print` 就会返回 false（因为 `quota > 0` 不满足）。所以 `putchar` 虽然不在锁内，但通过 `quota` 机制实现了互斥。

这展示了一种更精细的并发设计：**锁保护条件的检查和状态转移，但不必覆盖整个操作**。

**核心方法论**：

> 解决同步问题的步骤：
>
> 1. **建模**：将问题的合法状态序列表示为状态机（或其他形式化模型）
> 2. **推导条件**：从状态机中提取"何时可以执行某操作"的谓词
> 3. **套用模板**：直接使用条件变量的万能模板实现

---

## 8. 计算图模型：将同步推广到并行计算

### 8.1 模型定义

将任意并行计算任务抽象为**有向无环图（DAG）**：

```
G = (V, E)

节点 V：每个节点代表一个计算任务（可以读写共享内存）
有向边 E：边 (u, v) 表示 v 依赖 u 的计算结果
          即 u happens-before v
```

图形示意：

```
节点 0 ──┬──> 节点 1 ──┐
         ├──> 节点 2 ──┤──> 节点 4 ──> 节点 5
         └──> 节点 3 ──┘
                                    （节点 3 无后继）
```

在这个图中：

- 节点 0 可以立即执行（没有前驱）
- 节点 1、2、3 必须等节点 0 完成后才能执行
- 节点 4 必须等节点 1 和节点 2 都完成后才能执行
- 节点 5 必须等节点 4 完成后才能执行
- 节点 3 可以与 1、2、4、5 完全并行

### 8.2 为什么这是通用模型

几乎所有并行计算问题都能用 DAG 表达：

| 系统                      | 节点                           | 边的含义                          |
| ------------------------- | ------------------------------ | --------------------------------- |
| **GNU Makefile**          | 编译目标文件                   | 源文件依赖                        |
| **PyTorch autograd**      | 张量运算（如矩阵乘、激活函数） | 数据流向（反向传播路径）          |
| **LCS 动态规划**          | `dp[i][j]` 的计算              | `dp[i-1][j]` 和 `dp[i][j-1]` 先算 |
| **电路仿真（Verilator）** | 组合逻辑块                     | 信号线传递                        |

**并行效率的关键**：

- 如果 DAG 中存在很多**可并行的节点**（即互相没有依赖关系），算法就是高效可并行的
- **关键路径（Critical Path）**决定了并行的极限：即使有无限多的 CPU，执行时间也不能低于关键路径的长度

> **注意**：如果为每个 `dp[i][j]` 都创建一个线程，线程创建/销毁的开销远大于计算本身，得不偿失。需要合理划分计算粒度（Granularity）。

### 8.3 实现方法一：每节点一个线程（cgraph.c）

```c
// cgraph.c：为每个节点分配一个线程和一个条件变量
#define NTASKS 6

struct edge { int src, dst; } edges[] = {
    {0, 1}, {0, 2}, {0, 3},
    {1, 4}, {2, 4},
    {4, 5},
};

struct task {
    int pending_deps;  // 还有几个前驱未完成
    cond_t cv;         // 等待前驱完成的条件变量
} tasks[NTASKS];

mutex_t mutex = MUTEX_INIT();  // 所有任务共享一把大锁

void T_worker(int tid) {
    tid--;  // 线程编号从 1 开始，任务编号从 0 开始

    // 阶段 1：等待所有前驱任务完成
    mutex_lock(&mutex);
    while (!(tasks[tid].pending_deps == 0)) {
        cond_wait(&tasks[tid].cv, &mutex);
    }
    mutex_unlock(&mutex);

    // 阶段 2：执行本节点的计算（不持有锁）
    printf("Computing node #%d...\n", tid);
    sleep(1);  // 模拟计算

    // 阶段 3：通知后继节点（减少它们的 pending_deps）
    mutex_lock(&mutex);
    for (int i = 0; i < LENGTH(edges); i++) {
        if (edges[i].src == tid) {
            struct task *t = &tasks[edges[i].dst];
            t->pending_deps--;
            if (t->pending_deps == 0) {
                cond_broadcast(&t->cv);  // 后继节点的所有前驱都完成了
            }
        }
    }
    mutex_unlock(&mutex);
}

int main() {
    // 初始化：计算每个节点的前驱数量
    for (int i = 0; i < NTASKS; i++) {
        tasks[i].pending_deps = 0;
        cond_init(&tasks[i].cv);
    }
    for (int i = 0; i < LENGTH(edges); i++) {
        tasks[edges[i].dst].pending_deps++;
    }
    // 每个节点一个线程
    for (int i = 0; i < NTASKS; i++) spawn(T_worker);
    join();
    printf("Execution completed.\n");
}
```

**执行过程分析**（对照上面的边 `{0,1},{0,2},{0,3},{1,4},{2,4},{4,5}`）：

```
初始 pending_deps：
  节点 0: 0（无前驱，可立即执行）
  节点 1: 1（前驱：0）
  节点 2: 1（前驱：0）
  节点 3: 1（前驱：0）
  节点 4: 2（前驱：1,2）
  节点 5: 1（前驱：4）

执行顺序：
  t=0: 节点 0 开始计算（pending_deps=0，立即通过）
  t=1: 节点 0 完成，通知节点 1、2、3
       → 节点 1,2,3 的 pending_deps 均变为 0，同时开始计算
  t=2: 节点 1、2、3 完成（可能同时）
       节点 1、2 完成后，节点 4 的 pending_deps 变为 0
       节点 3 完成后无后继
  t=3: 节点 4 开始计算
  t=4: 节点 4 完成，通知节点 5
  t=5: 节点 5 计算完成，整体结束
```

**此方法中，为什么可以用 `cond_broadcast` 而不怕惊群效应？**

因为每个节点有**独立的 cv**：`cond_broadcast(&t->cv)` 只唤醒等待 `t->cv` 的线程，即只有节点 `t` 对应的那一个线程。实际上此处 `broadcast` 和 `signal` 效果相同（每个 cv 至多一个等待者），但 `broadcast` 更安全。

### 8.4 实现方法二：Executor Pool（调度器 + 工作线程池）

每节点一线程的方法当节点数量很大时（如神经网络有数百万节点）会产生巨大开销。实际工程中使用**线程池（Thread Pool）+ 调度器**：

```
架构：
  1 个 Scheduler（调度器）
    - 维护 DAG 状态：哪些节点的 pending_deps == 0（就绪队列）
    - 分发就绪任务给空闲 Worker

  N 个 Worker（工作线程，N 通常等于 CPU 核心数）
    - 循环：等待任务 → 执行 → 通知完成
```

```c
// Worker 线程的核心逻辑
void T_worker(int tid) {
    while (1) {
        // 等待调度器分配任务
        mutex_lock(&lk);
        while (!(all_done || has_job(tid))) {
            cond_wait(&worker_cv[tid], &lk);
        }
        mutex_unlock(&lk);

        if (all_done) break;

        // 执行任务
        process_job(tid);

        // 通知调度器：我完成了，可以处理后继节点
        cond_signal(&sched_cv);
    }
}

// 调度器的核心逻辑
void T_scheduler() {
    while (!all_tasks_done()) {
        mutex_lock(&lk);

        // 等待某个 worker 完成
        cond_wait(&sched_cv, &lk);

        // 处理完成的任务：减少后继节点的 pending_deps，将新就绪的任务入队
        update_dag_state();

        // 将就绪任务分配给空闲 worker
        dispatch_ready_tasks();

        mutex_unlock(&lk);
    }
    all_done = true;
    cond_broadcast(&worker_cv_all);  // 通知所有 worker 退出
}
```

这个模式仍然是**生产者-消费者**的变体：

```
T_worker  → 生产"完成通知"  → T_scheduler 消费
T_scheduler → 生产"就绪任务" → T_worker 消费
```

### 8.5 两种方法对比

|                    | 每节点一线程                | Executor Pool                                     |
| ------------------ | --------------------------- | ------------------------------------------------- |
| **线程数量**       | = 节点数（可能数百万）      | = CPU 核心数（通常 4~128）                        |
| **上下文切换开销** | 极高（大量线程竞争）        | 低（线程数 ≤ CPU 数）                             |
| **适用场景**       | 小规模静态 DAG（教学/原型） | 所有生产环境                                      |
| **调度灵活性**     | 无（OS 完全控制）           | 高（可实现优先级、负载均衡等）                    |
| **实现复杂度**     | 低                          | 中等                                              |
| **实际例子**       | 无                          | Python asyncio、Java ForkJoin、PyTorch DataLoader |

### 8.6 动态计算图

上面讨论的是**静态** DAG（节点和边在开始前确定）。实际系统中，计算图可以是**动态的**：

- 一边执行计算，一边根据结果产生新节点（如 Lisp 的求值过程）
- 计算图本身是存储在共享内存中的数据结构，多个线程并发地读写和扩展它

动态计算图的同步更复杂，但核心原则不变：每次状态改变后，`broadcast` 通知可能变为就绪的任务。

---

## 9. 总结与方法论

### 9.1 知识结构全图

```
并发控制
├── 互斥（Mutex）                          [前几讲]
│   ├── 问题：防止数据竞争
│   ├── 工具：mutex_lock / mutex_unlock
│   └── 局限：只能保证"不同时"，无法保证"先后"
│
└── 同步（Synchronization）                [本讲]
    ├── 问题：建立 happens-before 关系
    ├── 核心工具：条件变量（Condition Variable）
    │   ├── cond_wait(&cv, &lk)    — 原子：释放锁 + 进入睡眠
    │   ├── cond_signal(&cv)       — 唤醒一个等待者
    │   └── cond_broadcast(&cv)    — 唤醒所有等待者
    │
    ├── 万能模板：
    │   ├── 等待者：mutex_lock → while(!cond) { cond_wait } → ... → mutex_unlock
    │   └── 通知者：mutex_lock → 改变状态 → cond_broadcast → mutex_unlock
    │
    ├── 经典问题：生产者-消费者
    │   └── 推广：99% 的并发问题均可建模为此
    │
    ├── 通用化：状态机 + 条件变量（鱼骨打印）
    │   └── 推广：任意同步条件均可用此方法实现
    │
    └── 计算图模型（DAG）
        ├── 每节点一线程：直接映射，适合小规模
        └── Executor Pool：线程池 + 调度器，适合生产环境
```

### 9.2 解决同步问题的通用步骤

1. **识别共享状态**：哪些变量被多个线程共享？
2. **形式化同步条件**：每个线程"可以继续执行"的条件是什么？写成谓词 `cond()`
3. **套用万能模板**：
   - 等待者：`while (!cond()) cond_wait(&cv, &lk);`
   - 通知者：修改状态后 `cond_broadcast(&cv)`
4. **选择 signal 还是 broadcast**：不确定时用 `broadcast`
5. **验证**：检查是否可能出现 check-then-act 竞态、死锁、活锁

### 9.3 常见错误一览

| 错误                                    | 症状                     | 修复                             |
| --------------------------------------- | ------------------------ | -------------------------------- |
| `if` 替代 `while`                       | 偶发性断言失败、数据损坏 | 改为 `while`                     |
| `signal` 替代 `broadcast`（共享 cv 时） | 程序停滞（线程永远睡眠） | 改为 `broadcast` 或分开 cv       |
| 条件检查与操作分离（两次加锁）          | 竞态条件，保护不足       | 将检查与操作放入同一临界区       |
| 忘记在修改状态后 broadcast              | 某些线程永远不被唤醒     | 每次可能使条件成立时都 broadcast |
| broadcast 在锁外                        | 可能丢失唤醒             | broadcast 必须在锁内调用         |

### 9.4 推荐阅读

- **OSTEP 第 30 章**：Condition Variables  
  — 包含详细的代码示例（包括错误示例），与本讲高度对应，建议对照阅读
- **POSIX Threads Programming**（Blaise Barney, LLNL）  
  — 工程实践角度的详细指南