---
title: "CampusHub 后端架构设计笔记"
date: 2026-04-30  # 文章发布时间
categories: [软件工程与计算ⅠⅠ] # 你的分类
tags: [笔记]     # 你的标签
math: true
---

## 阅读指南

### 知识依赖链

```
第1章（为什么需要架构）
    └─► 第2章（模块化单体 vs 微服务）
            └─► 第3章（模块边界三要素）
                    └─► 第4章（代码结构：目录到每行）
                                └─► 第5章（完整接单链路）
                                        └─► 第6章（架构铁律）
                                                └─► 第7章（加入Agent的扩展分析）
                                                        └─► 附录
```

### 阅读建议

- 第 1–3 章是**概念层**，建立直觉。不要跳过。
- 第 4–5 章是**代码层**，结合目录结构一起看。
- 第 6 章是**规则层**，每条都有反例代码，对照看效果最好。
- 附录的练习题建议**合上笔记独立完成**，再对答案。

------

## 1. 为什么需要架构设计？

### 1.1 问题动机：没有规则会发生什么？

想象4个人一起开发 CampusHub，没有任何约定：

```
第1周：小明写了 task（跑腿）模块，为了方便直接查了 credit 表
第2周：小红修改了 credit 表，加了一个字段，把旧字段重命名了
第3周：小明的代码在运行时崩了，但他完全不知道为什么
```

这就是**耦合**（Coupling）：A 的改动悄悄破坏了 B，而 B 毫不知情。

在小项目里，耦合只是麻烦。在中大型项目里，耦合会让代码变成**"大泥球"（Big Ball of Mud）**——没有人敢改任何东西，因为不知道会牵动什么。

### 1.2 朴素方案：完全不管（大泥球单体）

最简单的做法是"不管"，所有代码放一起，随便互相调用。

**为什么这不够好：**

| 问题               | 后果                             |
| ------------------ | -------------------------------- |
| 任何人都能改任何表 | 数据一致性无法保证               |
| 模块间随意调用     | 改一处，全局可能崩溃             |
| 没有边界           | 新人无法快速定位"这个功能在哪"   |
| 无法独立测试       | 测试 task 模块时必须启动整个项目 |

### 1.3 解决思路：引入模块边界

> **核心思想**：在代码层面用规则模拟"部门边界"——每个模块是一个独立的"部门"，部门之间有官方沟通渠道，不允许私下翻别人的抽屉。

这就是本笔记要讲的**模块化架构**。

------

## 2. 模块化单体 vs 微服务

### 2.1 它们的根本区别：进程边界在哪里？

**进程（Process）** 是操作系统资源分配的基本单位。两个进程之间不共享内存，通信必须走网络。

```
模块化单体：
┌─────────────────────────────────┐
│  同一个 JVM 进程                 │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │ auth │ │ task │ │credit│    │  ← 模块间：直接函数调用（纳秒）
│  └──────┘ └──────┘ └──────┘    │
│          共享 MySQL              │
└─────────────────────────────────┘

微服务：
┌──────────┐   HTTP/RPC   ┌──────────┐   HTTP/RPC   ┌──────────┐
│auth-svc  │ ──────────►  │task-svc  │ ──────────►  │credit-svc│
│(进程A)   │              │(进程B)   │              │(进程C)   │
│[auth DB] │              │[task DB] │              │[credit DB│
└──────────┘              └──────────┘              └──────────┘
       服务间：网络调用（毫秒）+ 各自独立数据库
```

### 2.2 微服务的真实代价

微服务不是"更先进"，它是一种**用运维复杂度换取独立扩展能力**的交易。

#### 最致命的问题：分布式事务

CampusHub 的核心规则：**接单 + 冻结积分，必须同时成功或同时失败。**

```java
// 模块化单体：一行注解搞定
@Transactional
public void acceptTask(Long taskId, Long userId) {
    taskRepository.tryAccept(taskId, userId);  // 修改 task 表
    creditService.freeze(userId, 10);          // 修改 credit 表
    // 任何一步失败 → 数据库自动回滚两个操作
}
微服务：这是一场噩梦
task-service 调用 credit-service（HTTP 请求）
         ↓
网络抖动，credit-service 的请求丢了
         ↓
task 状态 = IN_PROGRESS  ✓
credit 积分未冻结         ✗
         ↓
数据不一致！
需要引入 Seata / TCC / Saga 等分布式事务框架
复杂度指数级上升，4人团队根本驾驭不了
```

#### 微服务还需要额外运维的组件

| 组件        | 作用               | 是否引入            |
| ----------- | ------------------ | ------------------- |
| Nacos       | 服务注册与发现     | ✗ 不引入            |
| API Gateway | 统一入口、限流路由 | ✗ 用 Nginx 代替     |
| Seata       | 分布式事务         | ✗ 不引入            |
| Kafka       | 消息队列           | ✗ 不引入（见铁律6） |
| Zipkin      | 分布式链路追踪     | ✗ 不引入            |
| 各自独立 DB | 数据隔离           | ✗ 共享 MySQL        |

### 2.3 CampusHub 的选择：模块化单体

| 约束条件       | 对架构的要求 | 模块化单体 | 微服务           |
| -------------- | ------------ | ---------- | ---------------- |
| 4人 / 10周     | 零运维带宽   | ✓ 一键部署 | ✗ 维护10+组件    |
| 信用分实时生效 | 强一致事务   | ✓ 本地事务 | ✗ 分布式事务     |
| 2000并发       | 单机能扛     | ✓ 够用     | ✗ 过度设计       |
| Java 技术栈    | 团队已掌握   | ✓ 直接用   | ✗ 需学微服务生态 |

> **关键洞察**：架构选型的本质不是"用最新的"，而是"用与团队能力和业务规模匹配的最简单方案"。

### 2.4 模块化单体 ≠ 普通单体

| 对比维度   | 普通单体（大泥球）        | 模块化单体                 |
| ---------- | ------------------------- | -------------------------- |
| 模块间访问 | 随意，Repository 直接注入 | 只走 `XxxApi` 接口或事件   |
| 数据访问   | 任意代码查任意表          | 每张表只归属一个模块       |
| 测试       | 无法隔离                  | 每个模块可独立测试         |
| 未来演进   | 无法拆分                  | 边界清晰，可逐步拆出微服务 |
| 部署       | 简单                      | 同样简单                   |
| 事务       | 本地事务                  | 同样是本地事务             |

------

## 3. 模块边界的三要素

### 3.1 定义一个模块需要回答三个问题

```
① 它负责什么？      → 职责（越窄越好）
② 哪些表只有它写？  → 数据主权
③ 它对外暴露什么？  → 契约（XxxApi 接口）
```

缺少任何一个，边界就是模糊的。

### 3.2 具体例子：credit 模块的完整边界定义

```
┌─────────────────────────────────────────────────────┐
│ credit 模块                                          │
│                                                     │
│ 职责：信用分计算、积分账户管理、冻结/结算/解冻        │
│                                                     │
│ 数据主权：                                           │
│   credit_account   （账户余额）                      │
│   credit_log       （变动记录）                      │
│   credit_freeze    （冻结记录）                      │
│   ↑ 只有 credit 模块的代码能写这三张表               │
│                                                     │
│ 对外契约（CreditApi）：                              │
│   getScoreOf(userId)       → 查信用分                │
│   freeze(userId, points)   → 冻结积分               │
│   settle(userId, points)   → 结算（消费冻结的积分）  │
│   deduct(userId, delta)    → 扣信用分               │
│                                                     │
│ 明确不负责：仲裁裁决（report 的事）                  │
│            举报处理（report 的事）                   │
└─────────────────────────────────────────────────────┘
```

> **"明确不负责什么"和"负责什么"同等重要。** 如果 credit 模块悄悄开始处理举报逻辑，就会产生功能蔓延（Feature Creep）——这是模块腐化最常见的起点。

### 3.3 三层依赖结构

```
L3 横切域（依赖所有人，没人依赖它）
┌──────────┬──────────┬──────────┬──────────┐
│  notify  │  report  │  admin   │  search  │
└──────────┴──────────┴──────────┴──────────┘
                        │ 依赖（只能向下）
                        ▼
L2 业务域（依赖 L1，被 L3 依赖）
┌────────┬────────┬────────┬────────┬────────┐
│  task  │ trade  │  edu   │  team  │   im   │
└────────┴────────┴────────┴────────┴────────┘
                        │ 依赖（只能向下）
                        ▼
L1 基础域（不依赖任何人，被所有人依赖）
┌──────────────┬──────────────┬──────────────┐
│     auth     │     user     │    credit    │
└──────────────┴──────────────┴──────────────┘
```

**铁律：依赖方向只能向下，绝不能反转。**

L1 依赖 L2 会发生什么？

```java
// ❌ 错误：credit（L1）依赖了 task（L2）
@Service
public class CreditService {
    @Autowired TaskRepository taskRepo; // 这行代码会导致：
    // task 依赖 credit，credit 又依赖 task
    // → 循环依赖 → Spring 启动报错：
    // "The dependencies of some of the beans in the application
    //  context form a cycle"
}
```

### 3.4 12 个模块边界速查

| 模块     | 层级 | 职责（一句话）                  | 明确不负责                  |
| -------- | ---- | ------------------------------- | --------------------------- |
| `auth`   | L1   | 登录、JWT签发、学生证审核状态机 | 不碰用户资料，不做RBAC      |
| `user`   | L1   | 昵称、头像、隐私开关            | 不做认证，不做信用          |
| `credit` | L1   | 信用分+积分账户的唯一权威       | 不做仲裁，不做举报          |
| `task`   | L2   | 跑腿任务全生命周期              | 不做内容审核，不做仲裁      |
| `trade`  | L2   | 二手商品上架与库存              | 不做资金，不做物流          |
| `edu`    | L2   | 课程评价、学习资料、辅导任务    | 不做学籍，不做成绩          |
| `team`   | L2   | 组队招募与技能匹配              | 不做即时通讯（走 im）       |
| `im`     | L2   | 站内私信与未读计数              | 不做系统通知（走 notify）   |
| `notify` | L3   | 系统通知与站内信推送            | 不做IM长会话                |
| `report` | L3   | 举报受理、申诉、仲裁裁决执行    | 不直接改积分（委托 credit） |
| `admin`  | L3   | 后台操作触发器                  | 不做业务逻辑，只触发        |
| `search` | L3   | 多维筛选与关键词检索            | 不做推荐算法，不做画像      |

------

## 4. 代码结构：从目录到每行代码

### 4.1 项目目录结构

```
campushub/
├── pom.xml                          # Maven 依赖声明
└── src/main/java/com/campushub/
    │
    ├── CampusHubApplication.java    # 程序启动入口
    │
    ├── config/                      # 全局配置
    │   ├── SecurityConfig.java      # Spring Security 鉴权配置
    │   └── JwtFilter.java           # JWT 拦截器
    │
    ├── common/                      # 公共工具
    │   ├── BizException.java        # 自定义业务异常
    │   └── GlobalExceptionHandler.java  # 全局异常处理
    │
    ├── credit/                      # ← L1 基础域
    │   ├── api/
    │   │   ├── CreditApi.java       # 对外接口（唯一合法入口）
    │   │   └── CreditApiImpl.java   # 接口实现
    │   ├── controller/
    │   │   └── CreditController.java
    │   ├── service/
    │   │   ├── CreditService.java   # 业务逻辑
    │   │   └── CreditEventListener.java  # 事件监听
    │   ├── repository/
    │   │   └── CreditAccountRepository.java
    │   ├── entity/
    │   │   └── CreditAccount.java   # 数据库表映射
    │   └── dto/
    │       └── CreditInfoVO.java    # 对外返回的数据结构
    │
    └── task/                        # ← L2 业务域
        ├── api/
        │   └── TaskApi.java
        ├── event/
        │   ├── TaskAcceptedEvent.java    # 接单事件
        │   └── TaskCompletedEvent.java   # 完成事件
        ├── controller/
        │   └── TaskController.java
        ├── service/
        │   └── TaskService.java
        ├── repository/
        │   └── TaskRepository.java
        ├── entity/
        │   └── Task.java
        └── dto/
            └── TaskVO.java
```

### 4.2 第一层：Entity（数据库表映射）

**作用**：告诉 Spring "数据库里有一张表，长这个样子"。

```java
// 文件：credit/entity/CreditAccount.java

package com.campushub.credit.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Entity                          // 告诉 JPA：这是一个数据库实体类
@Table(name = "credit_account")  // 对应数据库中名为 credit_account 的表
@Getter                          // Lombok：自动生成所有 getXxx() 方法
@Setter                          // Lombok：自动生成所有 setXxx() 方法
public class CreditAccount {

    @Id                                                    // 声明主键
    @GeneratedValue(strategy = GenerationType.IDENTITY)    // 数据库自增（AUTO_INCREMENT）
    private Long id;

    @Column(nullable = false, unique = true)
    private Long userId;          // 关联哪个用户，只存 ID，不存 User 对象（见下方说明）

    @Column(nullable = false)
    private Integer creditScore;  // 信用分，初始 100

    @Column(nullable = false)
    private Integer points;       // 积分余额（可用）

    @Column(nullable = false)
    private Integer frozenPoints; // 被冻结的积分（接单押金）

    @Version                      // 这一个注解，自动开启乐观锁
    private Long version;         // 每次 UPDATE 自动 +1，并发冲突时检测
}
```

**❓为什么 `userId` 是 `Long`，而不是 `@ManyToOne User user`？**

```java
// ❌ 错误写法（跨模块引用 Entity）
@ManyToOne
@JoinColumn(name = "user_id")
private User user;   // User 是 user 模块的 Entity，credit 模块不能引用它！
                     // 这会让两个模块的代码强耦合在一起

// ✓ 正确写法（只存 ID 数字）
private Long userId; // 想要用户昵称？调 userApi.getNickname(userId)
```

**对应的数据库表（`credit_account`）：**

```sql
CREATE TABLE credit_account (
    id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT       NOT NULL UNIQUE,
    credit_score  INT          NOT NULL DEFAULT 100,
    points        INT          NOT NULL DEFAULT 0,
    frozen_points INT          NOT NULL DEFAULT 0,
    version       BIGINT       NOT NULL DEFAULT 0    -- 乐观锁字段
);
```

------

**Task Entity 补充（含状态枚举和乐观锁）：**

```java
// 文件：task/entity/Task.java

package com.campushub.task.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "task")
@Getter @Setter
public class Task {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long publisherUserId;  // 发单人（只存 ID）
    private Long acceptorUserId;   // 接单人（只存 ID，接单前为 null）

    // 枚举类型字段：存储枚举的字符串名称，而不是数字
    // 存 "PENDING_ACCEPT" 比存 0 可读性强得多
    @Enumerated(EnumType.STRING)
    private TaskStatus status;

    private Integer depositPoints; // 接单押金

    @Version
    private Long version;          // 乐观锁

    // 状态枚举：任务的完整生命周期
    public enum TaskStatus {
        PENDING_ACCEPT,   // 待接单
        IN_PROGRESS,      // 进行中
        COMPLETED,        // 已完成
        CANCELLED,        // 已取消
        DISPUTED          // 仲裁中
    }
}
```

### 4.3 第二层：Repository（数据库操作）

**作用**：声明"我需要对这张表做哪些操作"。Spring Data JPA 自动实现基础 CRUD。

```java
// 文件：credit/repository/CreditAccountRepository.java

package com.campushub.credit.repository;

import com.campushub.credit.entity.CreditAccount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

// 继承 JpaRepository<实体类型, 主键类型>
// Spring 自动提供：save() findById() findAll() delete() 等基础操作
public interface CreditAccountRepository extends JpaRepository<CreditAccount, Long> {

    // 方法名即查询语句，Spring 解析方法名自动生成 SQL：
    // SELECT * FROM credit_account WHERE user_id = ?
    Optional<CreditAccount> findByUserId(Long userId);
    // Optional<T>：表示结果可能为空，强迫调用方处理"找不到"的情况

    // @Modifying：这是写操作（UPDATE/DELETE），不是 SELECT
    // @Query 里写 JPQL（Java Persistence Query Language）
    // 注意：CreditAccount 是 Java 类名，不是数据库表名
    @Modifying
    @Query("UPDATE CreditAccount c " +
           "SET c.points = c.points - :amount, " +
           "    c.frozenPoints = c.frozenPoints + :amount " +
           "WHERE c.userId = :userId AND c.points >= :amount")
    int freezePoints(@Param("userId") Long userId, @Param("amount") int amount);
    // 返回 int = 影响的行数
    // 0 → 积分不足（SQL 里 AND c.points >= :amount 条件不满足）
    // 1 → 成功
}
// 文件：task/repository/TaskRepository.java

package com.campushub.task.repository;

import com.campushub.task.entity.Task;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TaskRepository extends JpaRepository<Task, Long> {

    // 乐观锁抢单的核心 SQL
    // 条件：status 必须是 PENDING_ACCEPT（防止重复接单）
    // 更新：status 改为 IN_PROGRESS，记录接单人
    @Modifying
    @Query("UPDATE Task t " +
           "SET t.status = 'IN_PROGRESS', t.acceptorUserId = :userId " +
           "WHERE t.id = :taskId AND t.status = 'PENDING_ACCEPT'")
    int tryAccept(@Param("taskId") Long taskId, @Param("userId") Long userId);
    // 500人同时调用：数据库行锁保证只有 1 个 UPDATE 成功（返回 1）
    // 其余 499 个返回 0（条件不满足，status 已不是 PENDING_ACCEPT）
}
```

**❓Spring Data JPA 帮我们做了什么？**

```java
// 你写的：
Optional<CreditAccount> findByUserId(Long userId);

// Spring 自动生成等价于：
// SELECT * FROM credit_account WHERE user_id = ?
// 并把结果映射成 CreditAccount 对象
// 如果没找到，返回 Optional.empty()，而不是 null
```

### 4.4 第三层：Service（业务逻辑）

**作用**：业务规则的唯一实现处。"能不能做"、"怎么做"都在这里。

```java
// 文件：credit/service/CreditService.java

package com.campushub.credit.service;

import com.campushub.common.exception.BizException;
import com.campushub.credit.entity.CreditAccount;
import com.campushub.credit.repository.CreditAccountRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service              // 告诉 Spring：这是业务逻辑类，放入容器管理
@RequiredArgsConstructor  // Lombok：自动生成构造函数注入（推荐方式）
public class CreditService {

    // Spring 自动注入，不需要写 new CreditAccountRepository()
    private final CreditAccountRepository creditAccountRepository;

    // 查信用分（只读操作，不需要事务）
    public int getScoreOf(Long userId) {
        return creditAccountRepository.findByUserId(userId)
            .map(CreditAccount::getCreditScore)
            // 找不到账户：抛出业务异常，而不是返回 0 或 null
            // 返回 0 会被误认为是"信用分为0"，语义错误
            .orElseThrow(() -> new BizException("ACCOUNT_NOT_FOUND"));
    }

    // 冻结积分（有写操作，必须加事务）
    @Transactional  // 这个方法里所有数据库操作：要么全成功，要么全回滚
    public void freeze(Long userId, int amount) {
        int affected = creditAccountRepository.freezePoints(userId, amount);
        if (affected == 0) {
            // 影响行数为 0 = 积分不足（SQL WHERE 条件不满足）
            throw new BizException("POINTS_NOT_ENOUGH");
            // 抛出异常 → @Transactional 自动触发回滚
        }
    }

    // 扣信用分（仲裁惩罚）
    @Transactional
    public void deduct(Long userId, int delta, String reasonCode) {
        CreditAccount account = creditAccountRepository.findByUserId(userId)
            .orElseThrow(() -> new BizException("ACCOUNT_NOT_FOUND"));

        int newScore = account.getCreditScore() - delta;
        account.setCreditScore(Math.max(0, newScore)); // 最低 0 分，不能为负
        creditAccountRepository.save(account);
        // save() 检测到 account 已存在（有 id），自动生成 UPDATE 语句
        // 因为有 @Version，UPDATE 会附带版本检查，防止并发覆盖
    }
}
```

**❓`@Transactional` 具体做了什么？**

```
调用 freeze(userId, amount) 时：
    1. Spring 开启数据库事务（BEGIN TRANSACTION）
    2. 执行 freezePoints SQL（修改数据库）
    3. 如果方法正常返回 → COMMIT（提交，数据永久写入）
    4. 如果方法抛出异常 → ROLLBACK（回滚，数据库还原）

没有 @Transactional 的话：
    SQL 执行完就立刻提交，出了问题无法撤销
```

### 4.5 第四层：XxxApi 接口（跨模块契约）

这是模块间通信的"正门"，是整个模块化架构最核心的设计。

```java
// 文件：credit/api/CreditApi.java
// 作用：声明 credit 模块对外能提供什么能力
// 其他模块只依赖这个接口，不依赖 Service 实现

package com.campushub.credit.api;

public interface CreditApi {

    int getScoreOf(Long userId);

    void freeze(Long userId, int points);

    void unfreeze(Long userId, int points);  // 解冻（任务取消时）

    void settle(Long userId, int points);   // 结算（冻结→消费，任务完成时）

    void deduct(Long userId, int delta, String reasonCode);
}
// 文件：credit/api/CreditApiImpl.java
// 作用：接口的实现，委托给 Service 执行
// 其他模块 @Autowired CreditApi，Spring 自动注入这个实现类

package com.campushub.credit.api;

import com.campushub.credit.service.CreditService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class CreditApiImpl implements CreditApi {

    private final CreditService creditService;

    @Override
    public int getScoreOf(Long userId) {
        return creditService.getScoreOf(userId);
    }

    @Override
    public void freeze(Long userId, int points) {
        creditService.freeze(userId, points);
    }

    @Override
    public void settle(Long userId, int points) {
        creditService.settle(userId, points);
    }

    @Override
    public void deduct(Long userId, int delta, String reasonCode) {
        creditService.deduct(userId, delta, reasonCode);
    }

    @Override
    public void unfreeze(Long userId, int points) {
        creditService.unfreeze(userId, points);
    }
}
```

**❓为什么要多此一举？直接 `@Autowired CreditService` 不行吗？**

```java
// ❌ 错误：task 模块直接依赖 credit 的实现类
public class TaskService {
    @Autowired CreditService creditService; // 依赖了实现细节
    // 后果：CreditService 改了方法签名 → TaskService 也得改
    // 两个模块从"通过合同沟通"变成了"强绑定"
}

// ✓ 正确：task 模块依赖 credit 的接口（合同）
public class TaskService {
    @Autowired CreditApi creditApi; // 只依赖接口
    // 接口签名不变，实现怎么改都不影响 TaskService
    // 未来将 credit 拆成微服务，只需换一个 CreditApi 的实现（HTTP 调用版本）
    // TaskService 代码零修改
}
```

### 4.6 第五层：Event（模块间异步联动）

**作用**：当一件事发生时，触发其他模块联动，无需直接调用。

```java
// 文件：task/event/TaskAcceptedEvent.java
// 归属：task 模块（因为是 task 发布的事件）

package com.campushub.task.event;

import lombok.Getter;

@Getter
public class TaskAcceptedEvent {

    private final Long taskId;
    private final Long acceptorUserId;  // 接单人
    private final int  depositPoints;   // 需要冻结的押金

    // 没有 setter！事件一旦创建就不可修改
    // 防止订阅者（credit/notify）偷偷修改事件数据，造成混乱
    public TaskAcceptedEvent(Long taskId, Long acceptorUserId, int depositPoints) {
        this.taskId = taskId;
        this.acceptorUserId = acceptorUserId;
        this.depositPoints = depositPoints;
    }
}
// 文件：credit/service/CreditEventListener.java
// 作用：credit 模块监听其他模块的事件，做出响应

package com.campushub.credit.service;

import com.campushub.task.event.TaskAcceptedEvent;
import com.campushub.task.event.TaskCompletedEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
@RequiredArgsConstructor
public class CreditEventListener {

    private final CreditService creditService;

    // BEFORE_COMMIT：在发布事件的那个事务提交之前执行
    // 效果：冻结积分 与 更新task状态 在同一个数据库事务里
    // 冻结积分失败 → 整个事务回滚 → task状态也不变
    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void onTaskAccepted(TaskAcceptedEvent event) {
        creditService.freeze(event.getAcceptorUserId(), event.getDepositPoints());
    }

    // AFTER_COMMIT + @Async：事务提交后，异步执行
    // 效果：结算操作失败，不影响任务完成的记录（主流程已提交）
    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onTaskCompleted(TaskCompletedEvent event) {
        creditService.settle(event.getAcceptorUserId(), event.getDepositPoints());
    }
}
```

**事件的两种时机对比：**

| 时机                      | 注解                                               | 效果                                 | 适用场景                  |
| ------------------------- | -------------------------------------------------- | ------------------------------------ | ------------------------- |
| `BEFORE_COMMIT`           | `@TransactionalEventListener(phase=BEFORE_COMMIT)` | 在同一事务内执行，失败则整体回滚     | 核心业务（积分冻结/结算） |
| `AFTER_COMMIT` + `@Async` | 两个注解配合                                       | 事务提交后异步执行，失败不影响主流程 | 通知推送、日志记录        |

### 4.7 第六层：Controller（HTTP 接口）

```java
// 文件：task/controller/TaskController.java

package com.campushub.task.controller;

import com.campushub.task.service.TaskService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController                   // @Controller + @ResponseBody 的合并：
                                  // 这个类的所有方法返回值直接序列化为 JSON
@RequestMapping("/api/tasks")     // 这个类下所有接口的 URL 前缀
@RequiredArgsConstructor
public class TaskController {

    private final TaskService taskService;

    // POST /api/tasks/{taskId}/accept
    // {taskId} 是路径变量，比如 /api/tasks/123/accept 中的 123
    @PostMapping("/{taskId}/accept")
    public ResponseEntity<Void> acceptTask(
            @PathVariable Long taskId,       // 从 URL 路径取 taskId
            @RequestAttribute Long userId) { // 从 JwtFilter 注入的当前用户ID

        taskService.acceptTask(taskId, userId);
        return ResponseEntity.ok().build();  // 返回 HTTP 200 OK，无响应体
    }
}
```

**❓Controller 为什么不做业务逻辑？**

Controller 只做三件事：

1. 接收 HTTP 请求，解析参数
2. 调用 Service
3. 把 Service 的结果包装成 HTTP 响应

业务逻辑（"信用分够不够"、"积分够不够"）全部在 Service 里。
 这样 Service 可以被 Controller 调用，也可以被事件监听器调用，也可以被单元测试直接调用，互不影响。

### 4.8 公共组件：BizException 与 GlobalExceptionHandler

```java
// 文件：common/BizException.java
// 自定义业务异常：携带错误码，方便前端处理

package com.campushub.common.exception;

import lombok.Getter;

@Getter
public class BizException extends RuntimeException {

    private final String errorCode;

    public BizException(String errorCode) {
        super(errorCode);          // 把 errorCode 作为异常消息
        this.errorCode = errorCode;
    }

    public BizException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }
}
// 文件：common/GlobalExceptionHandler.java
// 统一异常处理：把异常转换为标准 JSON 响应格式

package com.campushub.common.exception;

import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice  // 拦截所有 Controller 抛出的异常
public class GlobalExceptionHandler {

    // 处理业务异常（积分不足、信用分不足等）
    @ExceptionHandler(BizException.class)
    public ResponseEntity<Map<String, String>> handleBizException(BizException ex) {
        return ResponseEntity
            .badRequest()   // HTTP 400
            .body(Map.of(
                "errorCode", ex.getErrorCode(),
                "message",   ex.getMessage()
            ));
    }

    // 处理乐观锁冲突（并发抢单失败）
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<Map<String, String>> handleOptimisticLock(Exception ex) {
        return ResponseEntity
            .status(409)   // HTTP 409 Conflict
            .body(Map.of(
                "errorCode", "CONCURRENT_CONFLICT",
                "message",   "操作冲突，请重试"
            ));
    }
}
```

------

## 5. 完整场景：接单全链路追踪

**场景**：学生 A（userId=101）接学生 B 发布的跑腿任务（taskId=500）。
 此时 500 名同学同时点击了"接单"按钮。

### 5.1 完整调用链

```
用户点击"接单"
    │
    ▼
[Nginx] 收到 POST /api/tasks/500/accept
  限流检查：该IP是否超频？ → 通过
    │
    ▼
[JwtFilter.doFilter()]
  解析请求头 Authorization: Bearer <token>
  验证 JWT 签名和有效期
  把 userId=101 写入 RequestAttribute
    │
    ▼
[TaskController.acceptTask(taskId=500, userId=101)]
  取出路径变量 taskId=500
  取出 RequestAttribute userId=101
  调用 taskService.acceptTask(500, 101)
    │
    ▼
[TaskService.acceptTask()] ← @Transactional 事务开始
    │
    ├─ ① 信用分检查
    │    creditApi.getScoreOf(101) → 返回 85
    │    85 ≥ 60，通过检查
    │
    ├─ ② 乐观锁抢单（500人同时到达这里）
    │    taskRepository.tryAccept(500, 101)
    │    SQL: UPDATE task SET status='IN_PROGRESS', acceptor_id=101
    │         WHERE id=500 AND status='PENDING_ACCEPT'
    │    数据库行锁：500个UPDATE同时到达，只有1个能把 status 从
    │    PENDING_ACCEPT 改成 IN_PROGRESS
    │    → 成功的那1个：affected=1，继续
    │    → 其余499个：affected=0，抛出 BizException("TASK_ALREADY_ACCEPTED")
    │                  → 事务回滚（什么都没改）→ 返回 HTTP 409
    │
    ├─ ③ 发布事件（成功的那1个继续）
    │    eventPublisher.publishEvent(
    │        new TaskAcceptedEvent(500, 101, depositPoints=10)
    │    )
    │    注意：此刻事件还没被处理，只是放入队列
    │
    │   ↓ BEFORE_COMMIT 触发（在当前事务提交之前）
    ├─ ④ CreditEventListener.onTaskAccepted() 被调用
    │    creditService.freeze(101, 10)
    │    SQL: UPDATE credit_account
    │         SET points=points-10, frozen_points=frozen_points+10
    │         WHERE user_id=101 AND points>=10
    │    如果积分不足 → 抛出 BizException → 整个事务回滚
    │    （task 的 status 更新也一起撤销）
    │
    ▼
[事务提交] ← task状态变更 + 积分冻结，原子写入数据库
    │
    │   ↓ AFTER_COMMIT + @Async（事务提交后，异步线程执行）
    ├─ ⑤ NotifyEventListener.onTaskAccepted() 被调用
    │    向学生B发送站内信："有人接了你的单"
    │    即使这步失败，task已提交，不会回滚
    │
    ▼
[TaskController] 返回 ResponseEntity.ok()
    │
    ▼
[Nginx] 返回 HTTP 200 OK 给学生A的浏览器
```

### 5.2 乐观锁原理详解

**问题**：500人同时抢1个任务，怎么保证只有1人成功？

**朴素方案（悲观锁）**：

```sql
-- 先锁住这行，其他人等着
SELECT * FROM task WHERE id=500 FOR UPDATE;
-- 检查状态
-- 更新状态
UPDATE task SET status='IN_PROGRESS' WHERE id=500;
-- 释放锁
```

问题：500人排队，性能极差。

**CampusHub 方案（乐观锁）**：

```sql
-- 不加锁，直接 UPDATE，但加条件
UPDATE task
SET status = 'IN_PROGRESS', acceptor_id = 101
WHERE id = 500
  AND status = 'PENDING_ACCEPT';  -- 条件：任务还没被接
-- 数据库保证：同时到达的500个UPDATE，只有1个能把 status 从
-- PENDING_ACCEPT 改成 IN_PROGRESS（先到的那个）
-- 其余499个条件不满足（status已经是IN_PROGRESS了），返回影响行数0
// 代码层面的检测
int affected = taskRepository.tryAccept(taskId, userId);
if (affected == 0) {
    // 我晚到了一步，任务已被人接走
    throw new BizException("TASK_ALREADY_ACCEPTED");
}
```

### 5.3 事务边界图

```
┌─────────── 数据库事务（ACID 保证）───────────┐
│                                              │
│  UPDATE task status → IN_PROGRESS      ─┐   │
│                                          ├── │── 要么都成功
│  UPDATE credit_account points -= 10    ─┘   │── 要么都失败
│                                              │
└──────────────────────────────────────────────┘

提交后（不在事务内）：
  发送站内信通知 → 失败了？记日志，10分钟后重试
                   不影响已提交的接单记录
```

------

## 6. 架构六条铁律详解

这六条规则是"架构不变量"——违反任何一条，代码必须在 PR 阶段被打回。

### 铁律1：跨模块通信只走两条路

```java
// ❌ 违规：task 模块直接调用 credit 模块的 Service
@Service
public class TaskService {
    @Autowired CreditService creditService; // 直接依赖实现类
    // 问题1：task 和 credit 强耦合，credit 改方法签名，task 也得改
    // 问题2：ArchUnit 检测到 → 构建失败
}

// ✓ 合规路径1：通过 XxxApi 接口同步调用
@Service
public class TaskService {
    @Autowired CreditApi creditApi; // 只依赖接口（合同）
    
    public void acceptTask(Long taskId, Long userId) {
        int score = creditApi.getScoreOf(userId); // 合法
    }
}

// ✓ 合规路径2：通过 ApplicationEvent 事件通知
@Service
public class TaskService {
    @Autowired ApplicationEventPublisher eventPublisher;
    
    public void acceptTask(Long taskId, Long userId) {
        // ...
        eventPublisher.publishEvent(new TaskAcceptedEvent(...)); // 合法
        // credit 模块的监听器会响应，task 不知道也不关心
    }
}
```

### 铁律2：每张表只属于一个模块

```java
// ❌ 违规：notify 模块直接查 credit 表
@Repository
public interface NotifyRepository extends JpaRepository<...> {
    // notify 模块里出现了查 credit_account 的 SQL
    @Query("SELECT c.creditScore FROM CreditAccount c WHERE c.userId = :uid")
    int getCreditScore(Long uid); // 违规！credit_account 是 credit 模块的私有领地
}

// ✓ 合规：notify 需要信用分，调 creditApi
@Service
public class NotifyService {
    @Autowired CreditApi creditApi;
    
    public void sendLowCreditWarning(Long userId) {
        int score = creditApi.getScoreOf(userId); // 合法
        if (score < 60) {
            // 发送警告通知
        }
    }
}
```

### 铁律3：Controller 禁止直接返回 Entity

```java
// ❌ 违规：Controller 直接返回 Entity
@GetMapping("/me")
public CreditAccount getMyAccount(@RequestAttribute Long userId) {
    return creditAccountRepository.findByUserId(userId).orElseThrow();
    // 危险！CreditAccount 里可能包含敏感字段
    // 即使现在没有，将来加了敏感字段，接口就泄露了
}

// ✓ 合规：转换为 VO（View Object）再返回
@GetMapping("/me")
public CreditInfoVO getMyAccount(@RequestAttribute Long userId) {
    CreditAccount account = creditAccountRepository.findByUserId(userId).orElseThrow();
    // 只暴露前端需要的字段，其余字段不出去
    return new CreditInfoVO(account.getCreditScore(), account.getPoints());
}
// VO：精心控制对外暴露的字段
public class CreditInfoVO {
    private Integer creditScore;
    private Integer points;        // 可用积分
    // 注意：没有 frozenPoints（内部状态，前端不需要）
    //       没有 version（乐观锁字段，前端不应该看到）
    //       没有 userId（冗余，通过 token 已知是当前用户）
}
```

### 铁律4：信用分/积分变动必须在事务提交前完成

```java
// ❌ 危险：使用 AFTER_COMMIT 处理积分冻结
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT) // 错误！
public void onTaskAccepted(TaskAcceptedEvent event) {
    creditService.freeze(event.getAcceptorUserId(), event.getDepositPoints());
    // 如果这里失败：task 已提交（status=IN_PROGRESS），但积分未冻结
    // 数据不一致！
}

// ✓ 正确：BEFORE_COMMIT 保证原子性
@TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
public void onTaskAccepted(TaskAcceptedEvent event) {
    creditService.freeze(event.getAcceptorUserId(), event.getDepositPoints());
    // 如果失败：整个事务回滚，task status 也撤销，数据一致
}
```

### 铁律5：管理接口必须加 `@PreAuthorize`

```java
// ❌ 违规：管理接口没有权限注解
@GetMapping("/api/admin/users/{userId}")
public AdminUserVO getUserDetail(@PathVariable Long userId) {
    return adminService.getUserDetail(userId); // 任何人都能访问！
}

// ✓ 合规：Spring Security 注解保护
@GetMapping("/api/admin/users/{userId}")
@PreAuthorize("hasRole('ADMIN')")  // 只有管理员角色才能访问
public AdminUserVO getUserDetail(@PathVariable Long userId) {
    return adminService.getUserDetail(userId);
    // AdminUserVO 里才允许包含 realName、studentNo
}
```

### 铁律6：日志必须脱敏

```java
// ❌ 违规：直接打印用户对象（可能含手机号、学号）
log.info("用户登录: {}", user);
// 日志里出现：User{phone=13812341234, studentNo=2021001234, ...}

// ✓ 合规：打印脱敏后的信息
log.info("用户登录: userId={}, phone={}",
    user.getId(),
    maskPhone(user.getPhone())); // 13812341234 → 138****1234

private String maskPhone(String phone) {
    if (phone == null || phone.length() != 11) return "***";
    return phone.substring(0, 3) + "****" + phone.substring(7);
}
```

------

## 7. 扩展性分析：加入 Agent 模块

### 7.1 先问：Agent 要做什么？

不同类型的 Agent，对架构的冲击完全不同：

| Agent 类型   | 例子                     | 架构冲击                                 |
| ------------ | ------------------------ | ---------------------------------------- |
| 只读助手     | 帮用户搜索任务、推荐评价 | 低：加新模块，调已有查询接口             |
| 代理操作     | 自动接单、自动发单       | 中：需要以用户身份调写接口，权限边界设计 |
| 自主决策+LLM | 调用 OpenAI、多步骤执行  | 高：需要异步执行框架、状态持久化         |

### 7.2 现有架构哪里够用

```java
// agent 模块合法调用已有接口
@Service
public class AgentService {
    @Autowired TaskApi   taskApi;   // ✓ 合法
    @Autowired CreditApi creditApi; // ✓ 合法
    @Autowired SearchApi searchApi; // ✓ 合法

    public void executeTaskSearch(Long userId, String query) {
        int score = creditApi.getScoreOf(userId);      // 检查资质
        List<TaskVO> tasks = searchApi.searchTasks(query); // 搜索任务
        // ... Agent 决策逻辑
    }
}
```

### 7.3 现有架构哪里不够用

**根本矛盾：现有架构是同步的，Agent 是异步的。**

```
现有 HTTP 请求模型：
  请求进来 → 处理 → 最多等 2 秒 → 返回结果

Agent + LLM 调用：
  请求进来 → 调用 OpenAI API（10-30秒）→ 返回结果
            → HTTP 超时！（默认30秒，且占用线程）
```

**缺失的能力：**

1. **异步任务队列**：Agent 任务提交后立即返回 `taskRunId`，客户端轮询进度
2. **状态持久化**：Agent 执行到一半，服务重启了，能从断点继续
3. **外部服务管理**：LLM API Key、重试策略、费用追踪

### 7.4 Agent 模块的最小侵入设计

```java
// 新增数据表（只属于 agent 模块）：
//
// agent_run（任务实例）
//   id, user_id, type, status(RUNNING/DONE/FAILED), created_at, finished_at
//
// agent_step（执行步骤）
//   id, run_id, step_name, input_json, output_json, status, created_at
//
// agent_tool_call（工具调用记录）
//   id, step_id, tool_name, request_json, response_json, duration_ms

// 新增接口：提交 Agent 任务（立即返回）
@PostMapping("/api/agent/runs")
public ResponseEntity<Map<String, Long>> startRun(@RequestBody AgentRunRequest req) {
    Long runId = agentService.start(req);
    return ResponseEntity.ok(Map.of("runId", runId));
}

// 新增接口：查询进度（客户端轮询）
@GetMapping("/api/agent/runs/{runId}")
public ResponseEntity<AgentRunVO> getRunStatus(@PathVariable Long runId) {
    return ResponseEntity.ok(agentService.getStatus(runId));
}
// Agent 执行器（异步，不阻塞 HTTP 线程）
@Service
public class AgentExecutor {

    // @Async：在独立线程池中执行，不阻塞调用方
    @Async("agentThreadPool")
    public void execute(Long runId) {
        // 1. 加载任务状态
        AgentRun run = agentRunRepository.findById(runId).orElseThrow();

        try {
            // 2. 调用 LLM（可能很慢）
            String llmResponse = llmClient.call(run.getPrompt());

            // 3. 解析 LLM 的决策，调用对应的工具（走 XxxApi）
            AgentDecision decision = parseDecision(llmResponse);
            executeDecision(decision); // 内部调用 taskApi / creditApi 等

            // 4. 更新状态为完成
            run.setStatus("DONE");
        } catch (Exception e) {
            run.setStatus("FAILED");
        }

        agentRunRepository.save(run);
    }

    private void executeDecision(AgentDecision decision) {
        // 关键原则：Agent 必须通过 XxxApi 操作数据，绝不直接写数据库
        switch (decision.getAction()) {
            case "ACCEPT_TASK" -> taskApi.accept(decision.getTaskId(), decision.getUserId());
            case "QUERY_SCORE" -> creditApi.getScoreOf(decision.getUserId());
            // ...
        }
    }
}
```

> **最重要的原则**：Agent 再强大，也必须通过 `XxxApi` 操作其他模块的数据。
>  绕过 API 直接写数据库 = 绕过所有边界规则 = 架构崩溃的起点。

------

## 附录

### A. 常见误区对照表

| 误区                                      | 正确理解                                                     |
| ----------------------------------------- | ------------------------------------------------------------ |
| "微服务比单体更先进"                      | 微服务适合大团队+高流量，4人团队选微服务是过度设计           |
| "模块化单体和普通单体一样"                | 关键区别：有无强制执行的边界规则（XxxApi + ArchUnit）        |
| "`@Transactional` 加在方法上就一定有事务" | 同类内部调用不走 Spring 代理，事务不生效（需要注入自身或拆类） |
| "乐观锁用了 `@Version` 就万能"            | 乐观锁适合低冲突场景；高冲突场景（抢购）应用排队/限流在前置  |
| "Controller 应该包含业务判断"             | Controller 只做参数解析和响应包装，业务逻辑全在 Service      |
| "Entity 可以直接返回给前端"               | Entity 映射数据库，字段可能含敏感信息；必须转为 VO 再返回    |
| "事件监听用 AFTER_COMMIT 更安全"          | 核心业务（积分冻结）必须 BEFORE_COMMIT，否则主事务提交后失败无法回滚 |
| "接口（Interface）是多此一举"             | 接口是模块间的合同，隔离实现细节，是未来拆微服务的关键       |

### B. 关键注解速查

| 注解                           | 位置           | 作用                       |
| ------------------------------ | -------------- | -------------------------- |
| `@Entity`                      | 类             | 声明这是数据库实体         |
| `@Table(name="...")`           | 类             | 指定对应的表名             |
| `@Id`                          | 字段           | 声明主键                   |
| `@Version`                     | 字段           | 开启乐观锁                 |
| `@Enumerated(EnumType.STRING)` | 枚举字段       | 存储枚举名称而非数字       |
| `@Service`                     | 类             | 声明为业务逻辑组件         |
| `@Repository`                  | 类/接口        | 声明为数据访问组件         |
| `@RestController`              | 类             | Controller + JSON响应      |
| `@Transactional`               | 方法/类        | 声明事务边界               |
| `@Modifying`                   | Repository方法 | 声明写操作（非查询）       |
| `@PreAuthorize`                | Controller方法 | 权限校验（必须有指定角色） |
| `@TransactionalEventListener`  | 方法           | 事务感知的事件监听         |
| `@Async`                       | 方法           | 异步执行（独立线程）       |
| `@RequiredArgsConstructor`     | 类（Lombok）   | 自动生成构造函数注入       |

### C. 知识依赖图（ASCII 树）

```
CampusHub 架构知识树

模块化架构
├── 为什么需要
│   ├── 耦合问题
│   └── 大泥球的代价
├── 核心选型
│   ├── 进程边界
│   ├── 本地事务 vs 分布式事务
│   └── 团队规模匹配
├── 模块边界
│   ├── 职责 + 数据主权 + 契约
│   ├── L1/L2/L3 层次
│   └── 反向依赖禁止
└── 代码实现
    ├── Entity（表映射）
    │   └── @Version 乐观锁
    ├── Repository（数据操作）
    │   └── Spring Data JPA 自动实现
    ├── Service（业务逻辑）
    │   └── @Transactional 事务
    ├── XxxApi 接口（跨模块契约）
    │   └── 接口 vs 直接依赖实现类
    └── Event（异步联动）
        ├── BEFORE_COMMIT（核心业务）
        └── AFTER_COMMIT + @Async（通知）
```

------

### D. 代码练习

> **建议**：合上笔记，独立完成，再对照参考答案。

------

#### 练习1：改错题（找出违反架构规则的代码）

下面的代码片段中有 **3 处** 架构违规，请找出并说明原因：

```java
// report/service/ReportService.java
@Service
public class ReportService {

    @Autowired CreditAccountRepository creditRepo;  // 违规？
    @Autowired NotifyService notifyService;          // 违规？

    @Transactional
    public void settleDispute(Long userId, int penaltyScore) {
        CreditAccount account = creditRepo.findByUserId(userId).orElseThrow();
        account.setCreditScore(account.getCreditScore() - penaltyScore);
        creditRepo.save(account);
        notifyService.sendPenaltyNotify(userId);     // 违规？
    }
}
```

<details> <summary>参考答案（做完再看）</summary>

**违规1**：`@Autowired CreditAccountRepository creditRepo`
 report 模块直接访问了 credit 模块的 Repository。
 规则：每张表只属于一个模块，跨模块必须走 `XxxApi`。
 修正：改为 `@Autowired CreditApi creditApi`，调用 `creditApi.deduct(userId, penaltyScore, "DISPUTE_PENALTY")`。

**违规2**：`@Autowired NotifyService notifyService`
 report 模块直接 Autowired 了 notify 模块的 Service 实现类。
 规则：跨模块通信只走接口（`NotifyApi`）或事件（`ApplicationEvent`）。
 修正：改为 `@Autowired NotifyApi notifyApi`，或发布 `DisputeSettledEvent`，让 notify 监听。

**违规3**：`notifyService.sendPenaltyNotify(userId)` 在 `@Transactional` 方法内同步调用通知
 通知失败会导致整个仲裁事务回滚，这不合理——仲裁裁决已生效，只是通知失败了。
 修正：发布 `@Async + AFTER_COMMIT` 的事件，让通知异步发送，失败重试。

</details>

------

#### 练习2：填空题（完成 `TaskCompletedEvent` 监听器）

任务完成时，需要：

- **积分结算**（消费冻结的押金给接单人）：必须与主事务原子
- **通知发布人**（发站内信）：允许失败，不影响主流程

请填写注解：

```java
@Component
@RequiredArgsConstructor
public class CreditCompletionListener {

    private final CreditService creditService;
    private final NotifyApi     notifyApi;

    // 填空：积分结算的注解
    @___________(___ = ___________.BEFORE_COMMIT)
    public void settleOnComplete(TaskCompletedEvent event) {
        creditService.settle(event.getAcceptorUserId(), event.getDepositPoints());
    }

    // 填空：通知的注解（两个）
    @___
    @___________(___ = ___________.AFTER_COMMIT)
    public void notifyOnComplete(TaskCompletedEvent event) {
        notifyApi.send(event.getPublisherUserId(), "您的任务已完成");
    }
}
```

<details> <summary>参考答案</summary>

```java
// 积分结算
@TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
public void settleOnComplete(TaskCompletedEvent event) { ... }

// 通知
@Async
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void notifyOnComplete(TaskCompletedEvent event) { ... }
```

</details>

------

#### 练习3：设计题（开放题）

**场景**：现在要给 CampusHub 加一个新功能——**"自动续期"**。
 规则：如果任务在截止时间前1小时还没完成，自动给双方发送催单通知。

请回答以下问题（不需要写完整代码，写思路即可）：

1. 这个功能应该放在哪个模块？为什么？
2. 需要新建一张数据表吗？如果要，设计它的核心字段。
3. 如何知道"截止时间前1小时"到了？（提示：考虑定时任务）
4. 发送通知应该调哪个模块的接口？走什么路径？

<details> <summary>参考思路</summary>

**1. 放在哪个模块？**
 功能涉及"任务截止时间"（task 的数据）和"发通知"（notify 的能力），但它是一个横切关注点（跨模块联动）。
 最合理：放在 L3 横切域，可以新建 `scheduler` 模块，或放入 `notify` 模块的定时任务里。
 也可以放在 `task` 模块：task 模块定时检查自己的数据，发布 `TaskNearDeadlineEvent` 事件，notify 监听。

**2. 数据表**
 不一定需要新表。`task` 表加一个 `deadline` 字段即可（如果还没有的话）。
 如果需要记录"是否已发过催单"，加 `reminder_sent_at` 字段，防止重复发送。

**3. 定时检查**
 用 Spring `@Scheduled` 注解的定时任务，每5分钟执行一次：

```java
@Scheduled(fixedDelay = 5 * 60 * 1000) // 每5分钟
public void checkNearDeadlineTasks() {
    LocalDateTime threshold = LocalDateTime.now().plusHours(1);
    List<Task> tasks = taskRepository.findNearDeadline(threshold);
    tasks.forEach(t -> eventPublisher.publishEvent(new TaskNearDeadlineEvent(t.getId())));
}
```

**4. 发送通知**
 `scheduler`/`task` 模块发布 `TaskNearDeadlineEvent`。
 `notify` 模块的 `NotifyEventListener` 监听该事件（`AFTER_COMMIT + @Async`）。
 `notify` 模块调用 `notifyApi.send()` 给双方发站内信。
 → 路径：事件（跨模块广播）→ notify 模块自己决定怎么发。

</details>

------

*笔记完*
 *版本：v1.0 | 基于 CampusHub 架构设计文档*