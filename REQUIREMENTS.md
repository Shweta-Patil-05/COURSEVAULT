# CourseVault — Requirements Specification

This document organizes the supplied functional and non-functional requirements into an implementable baseline. The API stack is **Node.js + Express.js** (the supplied diagram's FastAPI label is superseded by the project decision). The initial database is SQLite and the search index is custom-built.

## Product scope

CourseVault is a responsive academic resource library organized by department, course, semester, and unit. It supports student, staff, and administrator workflows; resource discovery; a persistent inverted index maintained by separate processes; ratings; student–staff questions; and notifications.

## Functional requirements

| ID | Requirement | Verification / acceptance |
| --- | --- | --- |
| FR-01 | Users can authenticate with credentials and students/staff can self-register. Passwords are stored as a secure password hash; responses and logs never include plaintext passwords. | Valid credentials create an authenticated session; invalid credentials return a generic 401 response; registration creates a Student or Staff account and signs the user in. |
| FR-02 | The system supports Student, Staff, and Admin roles with server-enforced role-based authorization. | Student, staff, and admin requests are checked against a role/permission matrix on every protected operation. |
| FR-03 | Admins manage user accounts, role assignments, departments, courses, semesters, and units. | Create/read/update/delete operations validate references and reject unauthorized callers. |
| FR-04 | Users browse courses and resources by department, course, semester, unit, and resource type. | Filter selections combine correctly and return only authorized records. |
| FR-05 | Authorized staff upload notes, PDFs, presentations, video links, and previous-year question papers. | Server validates metadata and allowed content type/size; ownership and upload date are stored. |
| FR-06 | Staff and admins can update/remove authorized resources; admins can remove inappropriate resources. Students can view/download resources they are permitted to access. | Ownership/role checks are enforced; deleting or updating metadata also schedules index reconciliation. |
| FR-07 | Resource metadata includes title, subject/course, unit, description, type, uploader, and upload/update dates. Files and metadata persist across restarts. | Metadata and file references survive application restart; unavailable files return a clear error without exposing paths. |
| FR-08 | Users search keywords, topics, subjects, and units, and filter by department, course, semester, and resource type. | Search returns matching authorized resources; empty results show a useful message. |
| FR-09 | A custom inverted index uses a hash map from normalized terms to posting lists, with document IDs and term frequency. | Query lookup uses postings rather than scanning every resource's full text. Boolean AND/OR/NOT can be evaluated as set intersection/union/difference. |
| FR-10 | Indexer and Query Handler run as separate processes and communicate through a documented IPC message format. | Indexer updates on create/update/remove; query handler returns results and handles malformed/unavailable IPC requests. |
| FR-11 | Search and indexing may run concurrently without corrupting or exposing a partial index. | Writes use a serialized update strategy and atomic snapshot replacement; readers use the last complete snapshot. |
| FR-12 | The persistent index loads on startup, survives restart, can be rebuilt from stored resource text, and recovers safely after interrupted updates. | Terminate an index update mid-write; the previous index remains queryable, and a rebuild restores consistency. |
| FR-13 | Results rank by keyword relevance, student rating, and recency. The dashboard also shows recent and highly rated resources. | Ranking inputs are normalized to 0–1; initial weights are relevance 0.60, rating 0.25, recency 0.15 and remain configurable. Recent/top-rated lists use database queries. |
| FR-14 | Authenticated students rate resources from 1–5; the system displays the average and accepts an update to the same student's rating. | A unique `(resource_id, student_id)` constraint prevents duplicate rows; updates recalculate the average and affect ranking. |
| FR-15 | Students ask questions about a resource; the responsible uploader can read and reply. Conversation history is retained and visible only to authorized participants. | Message reads and writes check student/resource/uploader participation; unrelated accounts cannot access the thread. |
| FR-16 | Notifications are created for incoming messages/replies and relevant resource changes. Users see unread counts and can mark notifications read. | Recipient, event, timestamp, and read state persist; unread count updates after marking read. |
| FR-17 | Express exposes JSON REST APIs for authentication, search, resources, ratings, messages, and notifications. Requests are validated and return appropriate HTTP status codes and understandable errors. | Valid requests return documented JSON; malformed input, missing records, unauthenticated access, forbidden access, and server failures map to suitable 4xx/5xx responses. |
| FR-18 | The system records relevant operational errors and basic activity events for maintenance without exposing internal details to users. | Logs exclude credentials and private message bodies; client errors do not contain stack traces or filesystem paths. |

## Non-functional requirements

| Area | Requirement and measurable target |
| --- | --- |
| Performance | Proposed target: p95 search latency under 1 second for a documented dataset and load. This is a goal to measure, not a guaranteed result. Report response time, throughput, and error rate for low, medium, and high load. |
| Search efficiency | Inverted-index searches retrieve candidate IDs from posting lists instead of scanning all resource text. Compare indexed retrieval with SQLite `LIKE` on the same dataset. |
| Security & privacy | Use secure password hashing, authentication, role checks, parameterized SQL, upload type/size validation, HTTPS in deployment, and restricted access to private resources/messages. Collect only required personal data and define retention/deletion rules. |
| Reliability & integrity | Preserve files/metadata across restarts; use database transactions for related changes; keep a valid index through failed writes; provide rebuild and graceful component-unavailable responses. Maintain backup guidance for database and file storage. |
| Usability & accessibility | Keep search easy to find, provide clear labels and action feedback, support keyboard navigation, readable type and sufficient contrast, and do not rely on color alone. Design toward WCAG guidance. |
| Compatibility | Support current mainstream browsers and responsive desktop, tablet, and mobile layouts. Backend runs on supported Node.js environments and standard student computers. |
| Maintainability | Separate frontend, API, database, authentication, resources, search, indexer/query handler, messaging, and notification modules. Document key APIs and use consistent naming. |
| Scalability & efficiency | Add departments/courses without architectural changes; avoid repeated extraction and unnecessary database calls; separate index writes from search reads so processing/storage can grow independently. |
| IPC & concurrency | Define versioned IPC messages, handle process exits/timeouts, serialize index writes, and exercise crash/recovery behavior under controlled failure. |
| Tooling & cost | Prefer free/open-source tools: Node.js, Express, SQLite, custom index, React/Vite, Postman or curl, and Autocannon. Initial deployment must not require paid cloud services or commercial licenses. |

## Four-engine traceability

| Engine | Subject | Share | Requirements owned or demonstrated |
| --- | --- | ---: | --- |
| Academic Inverted Search & Ranking Engine | DAA/DSA | 35% | FR-08–FR-09, FR-13; tokenization, hash map, posting lists, relevance scoring, Boolean set operations, indexed-vs-scan comparison. |
| Persistent Academic Metadata & Storage Engine | DBMS | 25% | FR-03–FR-07, FR-14–FR-16; SQLite schema, keys/constraints, transactions, indexes, aggregation, metadata and communication persistence. |
| Multi-Process Indexing & IPC Engine | OS | 25% | FR-10–FR-12; independent processes, IPC, synchronization, persistent snapshots, crash recovery and rebuild. |
| HTTP Academic Query Gateway | Web Technology & Networks | 15% | FR-01–FR-02, FR-17–FR-18 plus browser UI; Express, HTTP/JSON, validation, status codes, auth middleware, responsive experience and load measurement. |

Messaging, ratings, notifications, and role access cross multiple engines; they are not isolated to a single subject.

## Architecture

```text
Student / Staff / Admin browser
              │ HTTPS + JSON
              ▼
      Node.js + Express API ───── SQLite metadata and application state
              │                                  │
              ├── IPC request ──► Query Handler  │
              │                   (read snapshot) │
              └── IPC queue ────► Indexer ◄──────┘
                                  │
                                  ▼
                         atomic persistent index
```

The API authenticates and authorizes requests, validates input, and accesses SQLite. Search requests go to the Query Handler; resource mutations update SQLite transactionally and enqueue indexing work. The Indexer is the only writer of index snapshots. It writes a temporary snapshot, flushes it, then atomically renames it into place. Query handlers keep reading the last valid snapshot until replacement succeeds.

## API surface (initial contract)

- `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/departments`, `GET /api/courses`, admin `POST/PATCH/DELETE` management routes
- `GET /api/search?q=&departmentId=&courseId=&semester=&unitId=&type=`
- `GET /api/resources/recent`, `GET /api/resources/top-rated`, `POST /api/resources`, `GET/PATCH/DELETE /api/resources/:id`
- `PUT /api/resources/:id/rating`
- `GET/POST /api/resources/:id/messages` and a staff reply operation
- `GET /api/notifications`, `PATCH /api/notifications/:id/read`
- `GET /api/admin/activity` for restricted basic monitoring

## Delivery sequence

1. Responsive browsing/search prototype and requirements baseline.
2. SQLite schema, seed data, authentication, role middleware, and course/resource APIs.
3. Text extraction, tokenizer, custom index, query scoring, and persistent snapshots.
4. Indexer and Query Handler processes, IPC, concurrency strategy, crash test, rebuild.
5. Ratings, messaging, notifications, admin operations, and upload validation.
6. Low/medium/high load measurements, accessibility review, mobile/browser review, backup and deployment notes.

## Current implementation status

The project now includes a responsive React/Vite client, Express REST API, SQLite persistence, session authentication with login/register and role middleware, resource upload/versioning, ratings, reports, messaging, notifications, and custom search workers. The indexer extracts supported document text and atomically replaces persistent snapshots; the query handler loads snapshots and serves ranked searches. The project also includes local load/index measurements, recovery checks, and backup/restore tooling. See [README.md](README.md) for demo accounts, setup, limitations, and commands.
