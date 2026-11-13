# CourseVault

See [WORKFLOW.md](WORKFLOW.md) for the end-to-end project workflow, [REQUIREMENTS.md](REQUIREMENTS.md) for functional/non-functional requirements and traceability, [API.md](API.md) for HTTP endpoint contracts, and [ENGINE_DESIGN.md](ENGINE_DESIGN.md) for engine internals and demonstrations.

**CourseVault: A Multi-Process Persistent Academic Resource Search Engine** is a centralized, department-aware library for notes, video lectures, previous-year question papers, assignments, lab materials, and references. Students discover and rate resources, ask their uploader questions, and receive notifications for replies. Staff manage resources and answer doubts; admins manage courses, departments, and access.

## Four technical engines

Shares estimate implementation effort, not CPU usage.

| Priority | Technical engine | Subject | Share | Practical methods |
| --- | --- | --- | ---: | --- |
| 1 | Academic Inverted Search & Ranking Engine | DAA/DSA | 35% | Tokenization, normalization, hash map, posting lists with term frequency, TF-IDF-style relevance, rating and recency ranking |
| 2 | Persistent Academic Metadata & Storage Engine | DBMS | 25% | SQLite relational schema, foreign keys, constraints, metadata indexes, rating aggregates, indexed lookup versus `LIKE` comparison |
| 3 | Multi-Process Indexing & IPC Engine | OS | 25% | Node.js indexer and query-handler child processes, IPC messages, persistent snapshots, atomic writes, crash recovery checks |
| 4 | HTTP Academic Query Gateway | Web Technology & Networks | 15% | Node.js + Express REST endpoints, HTTP, JSON, browser client, validation, latency measurement under three loads |

Discrete math appears in query semantics: Boolean AND/OR/NOT can be implemented as intersection/union/difference on matching document-ID sets.

## Architecture

```text
Browser ── HTTP/JSON ── Express API
                           ├── SQLite: accounts, courses, resources, ratings, messages, notifications
                           ├── IPC ── Query handler ── read-only persistent inverted-index snapshot
                           └── IPC queue ── Indexer ── atomic snapshot update
```

The indexer owns writes; query handlers read the last complete snapshot. Write a new snapshot to a temporary file, flush it, then rename it into place. On startup validate the version/checksum and rebuild from stored extracted text if invalid. Test recovery by terminating the indexer during a temporary-file write and confirming the previous snapshot remains searchable.

## Free, practical stack

- Node.js LTS and Express for the API and process orchestration.
- SQLite for persistent relational metadata (use a free Node SQLite driver).
- A project-owned inverted index persisted as a versioned JSON snapshot for the first implementation.
- `child_process.fork()` and IPC messages for indexer/query-handler communication.
- React, Vite, and responsive CSS for the web client. No paid services are required for local development.
- Local file uploads initially, behind a storage interface so hosting can be chosen later.

## Data and routes

Core entities: `users`, `departments`, `courses`, `course_units`, `resources`, `resource_text`, `ratings`, `messages`, and `notifications`. Enforce unique email, role constraints, foreign keys, unique `(resource_id, student_id)` ratings, and indexes for course/unit, owner, and recipient/read state. Store password hashes only.

- `GET /api/search?q=&departmentId=&courseId=&unitId=&type=&sort=` — ranked results with metadata and rating.
- `GET /api/resources/recent` and `/api/resources/top-rated` — dashboard shelves.
- `POST /api/auth/register` — student/staff self-registration; session is created after the account is stored.
- `POST /api/resources` — staff/admin upload metadata and file, then enqueue indexing.
- `PUT /api/resources/:id/rating` — one rating per student/resource.
- `GET/POST /api/resources/:id/messages` — questions and staff replies.
- `GET /api/notifications`, `PATCH /api/notifications/:id/read` — notification inbox.

## Ranking and evaluation

Start with `0.60 × relevance + 0.25 × normalized rating + 0.15 × recency`, scaling each input to 0–1. Keep relevance-only ranking as a baseline. Compare SQLite `LIKE` with indexed lookup on the same generated dataset. Measure one client, moderate concurrency, and higher concurrency; document dataset size, hardware, warm/cold state, and latency percentiles.

## Run CourseVault locally

```sh
npm install
npm run dev
```

`npm run dev` starts Express on port 3000 and Vite on port 5173 (Vite chooses the next free port if needed). Open the Vite URL printed in the terminal. The first local startup creates `data/coursevault.sqlite`, a persistent search index, and sample accounts. Demo accounts share the password `CourseVault123!`:

- `student@coursevault.local` — search the inverted index, open/download resources, rate them, save them, and ask doubts.
- `staff@coursevault.local` — upload academic resources (metadata + file), which queues the OS indexer and notifies the query handler.
- `admin@coursevault.local` — manage users, courses, departments, and resources, plus reports, audit, backups, and search-index recovery.

Students and staff can also **register** from the sign-in screen (`POST /api/auth/register`). Admin accounts are created only by an administrator.

Uploads accept PDF, PPT/PPTX, DOC/DOCX, and TXT files up to 25 MB. Search text is extracted from PDF, DOCX, PPTX, and TXT in the indexer process; staff can add searchable text for other formats. Legacy DOC/PPT uploads are stored and downloadable, while their metadata and staff-entered summary are indexed.

Other useful commands:

```sh
npm run build                 # production frontend bundle
npm start                     # serve the built frontend and API
npm run measure:index          # compare indexed lookup with sequential scan at several dataset sizes
npm run measure:load           # low, medium, and high concurrent API load measurements
npm run restore:backup -- ID  # restore a backup after stopping CourseVault
```

`SESSION_SECRET` must be set to a long random value for production. Put CourseVault behind HTTPS when deployed. The local demo accounts and development reset tokens are only for development; the app does not send reset email because no mail provider is configured. Backups include the SQLite database and uploads. Search and activity history are retained 180 days and one year respectively; admin audit entries are retained three years, while message history remains until related data is removed.
