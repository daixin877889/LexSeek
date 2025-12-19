# Implementation Plan

- [x] 1. Create core types and interfaces
  - [x] 1.1 Create `shared/utils/logger/types.ts` with LogLevel, LogEntry, Transport, and LoggerOptions interfaces
    - Define LOG_LEVELS constant and LogLevel type
    - Define LogEntry interface with timestamp, level, prefix, message, args
    - Define Transport interface with write method
    - Define LoggerOptions interface
    - _Requirements: 1.1, 1.3_

- [-] 2. Implement LogFormatter and LogParser
  - [x] 2.1 Create `shared/utils/logger/formatter.ts` with LogFormatter class
    - Implement formatTimestamp method for HH:mm:ss.SSS format
    - Implement format method to produce `[timestamp][prefix][level] message` string
    - Handle safe serialization of objects and errors
    - _Requirements: 7.1, 6.3_
  - [ ] 2.2 Create `shared/utils/logger/parser.ts` with LogParser class
    - Implement parse method to extract timestamp, prefix, level, message from log string
    - Return null for invalid log strings
    - _Requirements: 7.2_
  - [ ]* 2.3 Write property test for round-trip consistency
    - **Property 1: Log Format Round-Trip Consistency**
    - **Validates: Requirements 7.1, 7.2, 7.3**
  - [ ]* 2.4 Write property test for safe serialization
    - **Property 7: Safe Serialization**
    - **Validates: Requirements 6.3**

- [x] 3. Implement ConsoleTransport
  - [x] 3.1 Create `shared/utils/logger/transports/console.ts` with ConsoleTransport class
    - Implement write method
    - Detect browser vs Node.js environment
    - Apply color styling in browser (DEBUG=#6366f1, INFO=#22c55e, WARN=#f59e0b, ERROR=#ef4444)
    - Use appropriate console method based on level
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 4. Implement FileTransport
  - [x] 4.1 Create `shared/utils/logger/transports/file.ts` with FileTransport class
    - Implement ensureLogsDir method to create logs directory
    - Implement getLogFilePath method with pattern `logs/{level}-{YYYY-MM-DD}.log`
    - Implement write method with append mode
    - Handle file system errors gracefully
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.1, 6.2_
  - [ ]* 4.2 Write property test for file naming pattern
    - **Property 3: File Naming Pattern**
    - **Validates: Requirements 3.3**
  - [ ]* 4.3 Write property test for date-based file rotation
    - **Property 4: Date-Based File Rotation**
    - **Validates: Requirements 3.4**

- [x] 5. Implement Logger core class
  - [x] 5.1 Create `shared/utils/logger/logger.ts` with Logger class
    - Implement constructor with environment detection and default level setting
    - Implement setLevel, setPrefix, setTimestamp methods
    - Implement debug, info, warn, error methods
    - Implement log method with level filtering
    - Implement createNamespace method for child loggers
    - Auto-configure transports based on environment
    - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3_
  - [ ]* 5.2 Write property test for log level filtering
    - **Property 2: Log Level Filtering**
    - **Validates: Requirements 4.3**
  - [ ]* 5.3 Write property test for namespace inheritance
    - **Property 6: Namespace Prefix Inheritance**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 6. Create main export and convenience functions
  - [x] 6.1 Create `shared/utils/logger/index.ts` as main entry point
    - Export Logger class and types
    - Create default logger instance
    - Export convenience functions (debug, info, warn, error, createLogger)
    - Export setLogLevel, setLogPrefix, enableTimestamp functions
    - _Requirements: 1.1_

- [x] 7. Cleanup legacy logger
  - [x] 7.1 Delete old `app/utils/logger.ts` file
    - Remove the original logger file after new implementation is complete
    - _Requirements: 1.1_

- [ ] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
