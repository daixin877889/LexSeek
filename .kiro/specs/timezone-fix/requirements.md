# Requirements Document

## Introduction

本功能旨在修复项目中时间存储到 PostgreSQL 数据库时的时区问题。当前问题是：代码使用 `new Date()` 生成的 UTC 时间被错误地附加了 +08 时区偏移后存入数据库，导致时间不准确。数据库时区为 `Asia/Shanghai`，不可更改。需要在应用层统一处理时区，确保时间正确存储和读取。

## Glossary

- **UTC**: 协调世界时，标准时间基准
- **Asia/Shanghai**: 中国标准时间，UTC+8
- **Timestamptz**: PostgreSQL 带时区的时间戳类型
- **Prisma**: 项目使用的 ORM 框架
- **Application Layer**: 应用程序代码层，负责业务逻辑处理

## Requirements

### Requirement 1

**User Story:** As a developer, I want all timestamps to be correctly stored with proper timezone information, so that time-based queries and displays are accurate.

#### Acceptance Criteria

1. WHEN the application creates a new Date object for database storage THEN the system SHALL generate the timestamp in Asia/Shanghai timezone
2. WHEN timestamps are stored in the database THEN the system SHALL ensure the timezone offset matches the actual local time in Asia/Shanghai
3. WHEN timestamps are read from the database THEN the system SHALL correctly interpret them as Asia/Shanghai timezone

### Requirement 2

**User Story:** As a developer, I want a centralized utility for timezone handling, so that all parts of the application use consistent time handling.

#### Acceptance Criteria

1. WHEN a developer needs to create a timestamp for database storage THEN the system SHALL provide a utility function that returns the correct Asia/Shanghai time
2. WHEN a developer needs to calculate future timestamps (e.g., expiration times) THEN the system SHALL provide utility functions that correctly handle timezone offsets
3. WHEN the utility functions are used THEN the system SHALL produce timestamps that match the database timezone configuration

### Requirement 3

**User Story:** As a developer, I want existing code to be updated to use the new timezone utilities, so that all timestamps are handled consistently.

#### Acceptance Criteria

1. WHEN SMS records are created THEN the system SHALL use the timezone utility for createdAt, updatedAt, and expiredAt fields
2. WHEN user records are created or updated THEN the system SHALL use the timezone utility for all timestamp fields
3. WHEN any model with timestamp fields is modified THEN the system SHALL use the timezone utility for those fields
