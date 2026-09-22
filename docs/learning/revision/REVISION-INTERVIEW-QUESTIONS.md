# REVISION: Interview Questions (100 Questions)

**Questions Only - No Answers**

Use this file for:
- ✅ Self-testing before checking answers
- ✅ Quick revision before interviews
- ✅ Identifying knowledge gaps
- ✅ Progress tracking with checkboxes

---

## Table of Contents

- [Security (15 Questions)](#security-15-questions) - Q1-Q15
- [Error Handling & Resilience (12 Questions)](#error-handling--resilience-12-questions) - Q16-Q27
- [Database & Performance (15 Questions)](#database--performance-15-questions) - Q28-Q42
- [Architecture & Design (18 Questions)](#architecture--design-18-questions) - Q43-Q60
- [Node.js Specific (15 Questions)](#nodejs-specific-15-questions) - Q61-Q75
- [DevOps & Deployment (15 Questions)](#devops--deployment-15-questions) - Q76-Q90
- [System Design (10 Questions)](#system-design-10-questions) - Q91-Q100

---

## Security (15 Questions)

1. [ ] **Q1:** How do you prevent SQL injection attacks? → [MODULE-9: Q1]
2. [ ] **Q2:** How do you store passwords securely? → [MODULE-9: Q2]
3. [ ] **Q3:** JWT vs Session Cookies - when to use each? → [MODULE-9: Q3]
4. [ ] **Q4:** How do you implement rate limiting? → [MODULE-9: Q4]
5. [ ] **Q5:** How do you prevent XSS attacks? → [MODULE-9: Q5]
6. [ ] **Q6:** Explain CORS and why it exists → [MODULE-9: Q6]
7. [ ] **Q7:** How do you handle secrets and API keys? → [MODULE-9: Q7]
8. [ ] **Q8:** What security headers do you implement and why? → [MODULE-9: Q8]
9. [ ] **Q9:** How do you prevent brute force attacks? → [MODULE-9: Q9]
10. [ ] **Q10:** Explain token rotation and why it matters → [MODULE-9: Q10]
11. [ ] **Q11:** How do you validate user input? → [MODULE-9: Q11]
12. [ ] **Q12:** What is CSRF and how do you prevent it? → [MODULE-9: Q12]
13. [ ] **Q13:** How do you secure API keys and service-to-service authentication? → [MODULE-9: Q13]
14. [ ] **Q14:** How do you handle password reset securely? → [MODULE-9: Q14]
15. [ ] **Q15:** What is the principle of least privilege and how do you implement it? → [MODULE-9: Q15]

---

## Error Handling & Resilience (12 Questions)

16. [ ] **Q16:** Explain the Circuit Breaker pattern → [MODULE-9: Q16]
17. [ ] **Q17:** What's your retry strategy and why not just keep retrying? → [MODULE-9: Q17]
18. [ ] **Q18:** How do you handle graceful shutdown? → [MODULE-9: Q18]
19. [ ] **Q19:** Operational vs Programming Errors - explain the difference → [MODULE-9: Q19]
20. [ ] **Q20:** How do you handle async errors in Express? → [MODULE-9: Q20]
21. [ ] **Q21:** Explain your global error handling strategy → [MODULE-9: Q21]
22. [ ] **Q22:** Explain database connection pooling and why it's critical → [MODULE-9: Q22]
23. [ ] **Q23:** What is bulkhead isolation and when do you use it? → [MODULE-9: Q23]
24. [ ] **Q24:** Deep health checks vs shallow health checks → [MODULE-9: Q24]
25. [ ] **Q25:** How do you implement timeouts for operations? → [MODULE-9: Q25]
26. [ ] **Q26:** Explain cascading failures and how to prevent them → [MODULE-9: Q26]
27. [ ] **Q27:** How do you implement monitoring and alerting? → [MODULE-9: Q27]

---

## Database & Performance (15 Questions)

28. [ ] **Q28:** How do you size database connection pools? → [MODULE-9: Q28]
29. [ ] **Q29:** What is the N+1 query problem and how do you solve it? → [MODULE-9: Q29]
30. [ ] **Q30:** Explain database transactions and ACID properties → [MODULE-9: Q30]
31. [ ] **Q31:** When and how do you use read replicas? → [MODULE-9: Q31]
32. [ ] **Q32:** How do you optimize slow database queries? → [MODULE-9: Q32]
33. [ ] **Q33:** Explain database migrations and version control → [MODULE-9: Q33]
34. [ ] **Q34:** Explain caching strategies and when to use each → [MODULE-9: Q34]
35. [ ] **Q35:** What is cache invalidation and why is it hard? → [MODULE-9: Q35]
36. [ ] **Q36:** Redis vs Memcached - when to use each? → [MODULE-9: Q36]
37. [ ] **Q37:** How does response compression work and when to use it? → [MODULE-9: Q37]
38. [ ] **Q38:** Explain pagination strategies (offset vs cursor) → [MODULE-9: Q38]
39. [ ] **Q39:** How do you implement lazy loading for better performance? → [MODULE-9: Q39]
40. [ ] **Q40:** How do you implement database backup and recovery? → [MODULE-9: Q40]
41. [ ] **Q41:** When do you use database indexes and when NOT to? → [MODULE-9: Q41]
42. [ ] **Q42:** How do you detect and prevent connection pool exhaustion? → [MODULE-9: Q42]

---

## Architecture & Design (18 Questions)

43. [ ] **Q43:** Microservices vs Monolith - when to use each? → [MODULE-9-PART-2: Q43]
44. [ ] **Q44:** How do you design RESTful APIs properly? → [MODULE-9-PART-2: Q44]
45. [ ] **Q45:** What is Event-Driven Architecture and when to use it? → [MODULE-9-PART-2: Q45]
46. [ ] **Q46:** What is the API Gateway pattern and why use it? → [MODULE-9-PART-2: Q46]
47. [ ] **Q47:** What is CQRS and when should you use it? → [MODULE-9-PART-2: Q47]
48. [ ] **Q48:** What is the Saga pattern for distributed transactions? → [MODULE-9-PART-2: Q48]
49. [ ] **Q49:** What is Service Mesh and when do you need it? → [MODULE-9-PART-2: Q49]
50. [ ] **Q50:** How do you design APIs for different client types? → [MODULE-9-PART-2: Q50]
51. [ ] **Q51:** GraphQL vs REST - when to use each? → [MODULE-9-PART-2: Q51]
52. [ ] **Q52:** How do you implement WebSockets for real-time features? → [MODULE-9-PART-2: Q52]
53. [ ] **Q53:** What is rate limiting and how do you implement it? → [MODULE-9-PART-2: Q53]
54. [ ] **Q54:** How do you implement API versioning strategies? → [MODULE-9-PART-2: Q54]
55. [ ] **Q55:** What is database sharding and when do you need it? → [MODULE-9-PART-2: Q55]
56. [ ] **Q56:** How do you implement caching strategies effectively? → [MODULE-9-PART-2: Q56]
57. [ ] **Q57:** What is the difference between authentication and authorization? → [MODULE-9-PART-2: Q57]
58. [ ] **Q58:** What are idempotency and how do you implement it? → [MODULE-9-PART-2: Q58]
59. [ ] **Q59:** How do you handle file uploads at scale? → [MODULE-9-PART-2: Q59]
60. [ ] **Q60:** What is the difference between horizontal and vertical scaling? → [MODULE-9-PART-2: Q60]

---

## Node.js Specific (15 Questions)

61. [ ] **Q61:** How does Node.js event loop work? → [MODULE-9-PART-3: Q61]
62. [ ] **Q62:** What is the difference between process.nextTick() and setImmediate()? → [MODULE-9-PART-3: Q62]
63. [ ] **Q63:** How do you handle memory leaks in Node.js? → [MODULE-9-PART-3: Q63]
64. [ ] **Q64:** What is the purpose of clustering in Node.js? → [MODULE-9-PART-3: Q64]
65. [ ] **Q65:** What are streams in Node.js and when to use them? → [MODULE-9-PART-3: Q65]
66. [ ] **Q66:** What is the difference between require() and import? → [MODULE-9-PART-3: Q66]
67. [ ] **Q67:** How do you debug memory leaks using heap snapshots? → [MODULE-9-PART-3: Q67]
68. [ ] **Q68:** What is the purpose of buffer in Node.js? → [MODULE-9-PART-3: Q68]
69. [ ] **Q69:** How does Node.js handle child processes? → [MODULE-9-PART-3: Q69]
70. [ ] **Q70:** What are Worker Threads and when to use them? → [MODULE-9-PART-3: Q70]
71. [ ] **Q71:** What is the V8 engine and how does it optimize JavaScript? → [MODULE-9-PART-3: Q71]
72. [ ] **Q72:** How do you profile Node.js applications? → [MODULE-9-PART-3: Q72]
73. [ ] **Q73:** What is garbage collection in Node.js? → [MODULE-9-PART-3: Q73]
74. [ ] **Q74:** What are the differences between setImmediate, setTimeout, and process.nextTick? → [MODULE-9-PART-3: Q74]
75. [ ] **Q75:** How do you handle uncaught exceptions and unhandled rejections? → [MODULE-9-PART-3: Q75]

---

## DevOps & Deployment (15 Questions)

76. [ ] **Q76:** How do you deploy Node.js applications with zero downtime? → [MODULE-9-PART-4: Q76]
77. [ ] **Q77:** How do you implement CI/CD pipelines for Node.js? → [MODULE-9-PART-4: Q77]
78. [ ] **Q78:** How do you monitor Node.js applications in production? → [MODULE-9-PART-4: Q78]
79. [ ] **Q79:** What is Docker and how do you containerize Node.js apps? → [MODULE-9-PART-4: Q79]
80. [ ] **Q80:** How do you use Kubernetes to orchestrate containers? → [MODULE-9-PART-4: Q80]
81. [ ] **Q81:** How do you implement environment variables securely? → [MODULE-9-PART-4: Q81]
82. [ ] **Q82:** What is Infrastructure as Code (IaC)? → [MODULE-9-PART-4: Q82]
83. [ ] **Q83:** How do you handle database migrations in production? → [MODULE-9-PART-4: Q83]
84. [ ] **Q84:** What is blue-green deployment? → [MODULE-9-PART-4: Q84]
85. [ ] **Q85:** How do you implement canary deployments? → [MODULE-9-PART-4: Q85]
86. [ ] **Q86:** How do you handle logging at scale? → [MODULE-9-PART-4: Q86]
87. [ ] **Q87:** What is feature flagging and how do you implement it? → [MODULE-9-PART-4: Q87]
88. [ ] **Q88:** How do you implement health checks and readiness probes? → [MODULE-9-PART-4: Q88]
89. [ ] **Q89:** What is service mesh and when do you need it? → [MODULE-9-PART-4: Q89]
90. [ ] **Q90:** How do you implement disaster recovery and backup strategies? → [MODULE-9-PART-4: Q90]

---

## System Design (10 Questions)

91. [ ] **Q91:** Design a URL shortener like bit.ly → [MODULE-9-PART-5: Q91]
92. [ ] **Q92:** Design a rate limiter → [MODULE-9-PART-5: Q92]
93. [ ] **Q93:** Design a real-time notification system → [MODULE-9-PART-5: Q93]
94. [ ] **Q94:** Design a distributed cache → [MODULE-9-PART-5: Q94]
95. [ ] **Q95:** Design a recommendation system → [MODULE-9-PART-5: Q95]
96. [ ] **Q96:** Design a logging and monitoring system → [MODULE-9-PART-5: Q96]
97. [ ] **Q97:** Design a job queue system → [MODULE-9-PART-5: Q97]
98. [ ] **Q98:** Design a search autocomplete system → [MODULE-9-PART-5: Q98]
99. [ ] **Q99:** Design a file upload system for large files → [MODULE-9-PART-5: Q99]
100. [ ] **Q100:** Design a distributed transaction system (Saga pattern) → [MODULE-9-PART-5: Q100]

---

## How to Use This File

### Self-Testing Mode
1. Read each question
2. Try to answer out loud or in writing
3. Check your answer in the source module
4. Mark the checkbox when confident

### Quick Revision
1. Scan through all questions in your weak areas
2. Identify patterns (e.g., many security questions use "parameterized queries")
3. Group similar questions (e.g., Q3, Q4, Q53 all relate to rate limiting)

### Progress Tracking
- Check off questions you can answer confidently
- Return to unchecked questions later
- Target: Answer all 100 questions in under 2 hours

### Finding Answers
Click the source reference (e.g., `→ [MODULE-9: Q1]`) to see:
- **Perfect answer** with real-world context
- **Code examples** (vulnerable vs secure)
- **Numbers and metrics** to quote in interviews
- **Follow-up questions** interviewers might ask
- **Trade-offs** to discuss

---

## Study Tips

**Before an interview:**
- Review all questions in relevant categories (30-45 minutes)
- Practice answering 10 random questions out loud
- Focus on categories matching the job (e.g., DevOps for SRE roles)

**Daily practice:**
- Answer 5-10 questions from different categories
- Rotate through categories to maintain broad knowledge
- Check answers after attempting all questions

**Weak area deep-dive:**
- If you struggle with a category (e.g., System Design)
- Go through all questions in that category
- Read the full module answers
- Re-test yourself after 24 hours

---

**Total Questions:** 100  
**Estimated Time to Complete (with answers):** 15-20 hours  
**Estimated Revision Time (questions only):** 30-60 minutes
