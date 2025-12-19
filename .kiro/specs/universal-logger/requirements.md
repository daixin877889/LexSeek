# Requirements Document

## Introduction

本规范定义了一个通用日志工具，将现有的客户端日志工具（`app/utils/logger.ts`）迁移到 `shared/utils` 目录，使其成为前后端通用的日志解决方案。客户端继续输出到浏览器控制台，服务端则输出到项目根目录的 `logs` 文件夹中的日志文件。

## Glossary

- **Logger**: 日志记录器，负责格式化和输出日志消息
- **LogLevel**: 日志级别，包括 DEBUG、INFO、WARN、ERROR、SILENT
- **Transport**: 日志传输层，负责将日志输出到特定目标（控制台或文件）
- **ConsoleTransport**: 控制台传输层，将日志输出到浏览器或 Node.js 控制台
- **FileTransport**: 文件传输层，将日志写入文件系统
- **LogRotation**: 日志轮转，按日期或大小分割日志文件

## Requirements

### Requirement 1

**User Story:** As a developer, I want to use a unified logging API across client and server code, so that I can maintain consistent logging patterns throughout the application.

#### Acceptance Criteria

1. WHEN the logger is imported from `shared/utils/logger` THEN the Logger SHALL provide identical API methods (debug, info, warn, error) on both client and server
2. WHEN the logger is initialized THEN the Logger SHALL automatically detect the runtime environment (browser vs Node.js)
3. WHEN log methods are called THEN the Logger SHALL format messages with timestamp, level, and optional prefix

### Requirement 2

**User Story:** As a frontend developer, I want logs to appear in the browser console with proper formatting, so that I can debug client-side issues effectively.

#### Acceptance Criteria

1. WHEN running in browser environment THEN the ConsoleTransport SHALL output logs to the browser console
2. WHEN outputting to browser console THEN the ConsoleTransport SHALL apply color styling based on log level
3. WHEN the log level is DEBUG THEN the ConsoleTransport SHALL use blue color (#6366f1)
4. WHEN the log level is INFO THEN the ConsoleTransport SHALL use green color (#22c55e)
5. WHEN the log level is WARN THEN the ConsoleTransport SHALL use yellow color (#f59e0b)
6. WHEN the log level is ERROR THEN the ConsoleTransport SHALL use red color (#ef4444)

### Requirement 3

**User Story:** As a backend developer, I want server logs to be written to files in the logs directory, so that I can review and analyze server behavior.

#### Acceptance Criteria

1. WHEN running in Node.js server environment THEN the FileTransport SHALL write logs to files in the `logs/` directory at project root
2. WHEN writing log files THEN the FileTransport SHALL create the `logs/` directory if it does not exist
3. WHEN writing log files THEN the FileTransport SHALL name files using the pattern `{level}-{date}.log` (e.g., `error-2025-12-19.log`)
4. WHEN a new day begins THEN the FileTransport SHALL create a new log file for that date
5. WHEN writing to log files THEN the FileTransport SHALL append logs without overwriting existing content
6. WHEN serializing log entries to file THEN the FileTransport SHALL format each entry as a single line with timestamp, level, prefix, and message

### Requirement 4

**User Story:** As a developer, I want to control log verbosity through log levels, so that I can filter out unnecessary log messages in production.

#### Acceptance Criteria

1. WHEN the environment is production THEN the Logger SHALL default to INFO level (hiding DEBUG logs)
2. WHEN the environment is development THEN the Logger SHALL default to DEBUG level (showing all logs)
3. WHEN setLevel is called with a valid level THEN the Logger SHALL only output logs at or above that level
4. WHEN setLevel is called with SILENT level THEN the Logger SHALL suppress all log output

### Requirement 5

**User Story:** As a developer, I want to create namespaced loggers, so that I can identify which module generated each log message.

#### Acceptance Criteria

1. WHEN createLogger is called with a namespace THEN the Logger SHALL return a new logger instance with that namespace in the prefix
2. WHEN a namespaced logger outputs a message THEN the Logger SHALL include the namespace in the log prefix (e.g., `[LexSeek][SMS]`)
3. WHEN a child logger is created THEN the Logger SHALL inherit the parent's log level and settings

### Requirement 6

**User Story:** As a developer, I want the logger to handle errors gracefully, so that logging failures do not crash the application.

#### Acceptance Criteria

1. IF file writing fails on server THEN the FileTransport SHALL fall back to console output and continue operation
2. IF the logs directory cannot be created THEN the FileTransport SHALL log a warning to console and continue with console-only output
3. WHEN logging objects or errors THEN the Logger SHALL safely serialize them without throwing exceptions

### Requirement 7

**User Story:** As a developer, I want to pretty-print log entries and parse them back, so that I can verify log formatting is correct.

#### Acceptance Criteria

1. WHEN formatting a log entry THEN the Logger SHALL produce a string in the format `[{timestamp}][{prefix}][{level}] {message}`
2. WHEN parsing a formatted log string THEN the Logger SHALL extract timestamp, prefix, level, and message components
3. WHEN a log entry is formatted and then parsed THEN the Logger SHALL recover the original components (round-trip consistency)
