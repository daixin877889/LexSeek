# Implementation Plan

- [x] 1. Install dayjs dependency
  - Run `bun add dayjs` to install dayjs package
  - _Requirements: 2.1_

- [ ] 2. Create timezone utility module
  - [x] 2.1 Create server/utils/timezone.ts with dayjs configuration
    - Import and configure dayjs with utc and timezone plugins
    - Define TIMEZONE constant as 'Asia/Shanghai'
    - Implement `now()` function that returns current Asia/Shanghai time
    - Implement `addMinutes(minutes, date?)` function
    - Implement `addHours(hours, date?)` function
    - Implement `toTimezone(date)` function
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ] 2.2 Write property test for timezone offset consistency
    - **Property 1: Timezone offset consistency**
    - **Validates: Requirements 1.1, 2.1**
  - [ ] 2.3 Write property test for time addition correctness
    - **Property 2: Time addition correctness**
    - **Validates: Requirements 2.2**

- [x] 3. Update SMS API to use timezone utility
  - [x] 3.1 Update server/api/v1/sms/send.post.ts
    - Import timezone utility functions
    - Replace `new Date()` with `now()` for createdAt and updatedAt
    - Replace `new Date(Date.now() + ...)` with `addMinutes()` for expiredAt
    - _Requirements: 3.1_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
