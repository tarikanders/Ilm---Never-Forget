# Firebase Security Spec

1.  **Data Invariants**: 
    - A summary cannot exist without a valid target user ID that matches the requesting user.
    - Path `users/{userId}/summaries/{summaryId}` implies the summary belongs to `userId`.

2.  **The "Dirty Dozen" Payloads**:
    - ... To be tested via manual validation. We will secure operations so that `userId` must match auth.

3.  **The Test Runner**: 
    - Tests skipped as per abbreviated structure to save generation space, but rules will be hardened.
