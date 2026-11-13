# CourseVault engine design and demonstration map

This document maps the engine-specific requirements to the current implementation. Shares are approximate project effort, not runtime resource use.

| Engine | Subject | Share | Implementation |
| --- | --- | ---: | --- |
| Academic Inverted Search & Ranking Engine | DAA/DSA | 35% | Unicode tokenizer, case normalization, hash map term postings, term-frequency counts, Boolean query set operations, TF-IDF-style score, title boost, rating/recency blend. |
| Persistent Academic Metadata & Storage Engine | DBMS | 25% | SQLite schema, relations/constraints, indexes, transactions, ratings/messages/notifications, reporting/audit, backup snapshot. |
| Multi-Process Indexing & IPC Engine | OS | 25% | Separate Node child processes, versioned IPC messages, serialized writer queue, query snapshot reload, atomic file replacement, worker restart and recovery. |
| HTTP Academic Query Gateway | Web Technology & Networks | 15% | Node + Express, JSON REST routes, sessions/roles, validation, responsive React client, performance metrics and measurement scripts. |

## DAA/DSA search behavior

- `server/extract.js` reads TXT files and extracts PDF, DOCX, and PPTX text in the Indexer process. The parser uses OfficeParser's async `parseOffice()` and `ast.to('text')` interfaces. Unsupported legacy DOC/PPT text extraction falls back to indexed metadata and staff-provided searchable text.
- `server/search-core.js` tokenizes Unicode letters/numbers and lowercases normalized terms. Stop words are retained to avoid losing meaningful course terms.
- The index maps each term to sorted `(resourceId, termFrequency)` postings. It stores term postings and lightweight title tokens, not duplicate full document bodies.
- Multi-term queries use OR by default; explicit `AND` intersects the relevant posting sets and `NOT` removes matching IDs. Ties are broken by resource ID.
- Relevance is normalized, then combined as `0.60 × relevance + 0.25 × rating/5 + 0.15 × exp(-ageDays/90)`. Rating or freshness cannot introduce a resource absent from the query's candidate set.
- Search filters support department, course, semester, unit text, resource type, subject, and upload date. API responses include metadata, page data, matching terms, ranking explanation, and elapsed time.
- Empty queries return a prompt; unsupported input returns a validation error; a valid query with no hits returns a no-results message.

### DSA demonstration

1. Search from the signed-in browser and inspect `/api/search?q=process%20synchronization` JSON.
2. Sign in as Admin and inspect `/api/admin/search-index/term/process` to show the posting list and term frequencies.
3. Open any result's explanation to show relevance, rating, recency, and matched terms.
4. Run `npm run measure:index` to compare the indexed lookup with a sequential scan at 100, 1,000, and 5,000 generated resources. The script reports build time and p95 query times; it is a repeatable local measurement, not a claimed performance result.
5. Run `npm run measure:load` to collect throughput, p50/p95/p99 latency, and error rate for low, medium, and high request concurrency.

## OS process behavior

- `server/index.js` forks `server/indexer.js` and `server/query-handler.js`.
- IPC objects carry protocol version 1, operation type, and a request ID. Request waits have a timeout.
- The Indexer serializes all updates. It writes a new version to a unique temporary file, flushes it, closes it, then renames it over `data/search-index.json`.
- The Query Handler holds the last complete snapshot in memory and reloads after a successful index update. It can continue serving the previous snapshot while the Indexer prepares a replacement.
- Child exits are logged and restarted. On Indexer startup, stale temporary files are discarded and the authoritative SQLite resource data is reindexed. The Query Handler loads the saved snapshot and then reloads after startup synchronization.
- Admin can rebuild the index in the Administration panel. The dev-only crash check writes a replacement temp snapshot and deliberately terminates the Indexer before rename; it confirms the old snapshot checksum is unchanged. This route is disabled in production.

### OS demonstration

1. Check `http://localhost:3000/api/health` for worker status.
2. Upload a resource and observe the API's `indexing: queued` response; search for its title/summary after indexing.
3. Search during an upload to confirm the previous complete snapshot remains readable.
4. Use Administration → Rebuild search index.
5. Use Administration → Run crash-recovery check in development; verify the result says the previous index was preserved and worker status recovers.
6. Stop and restart CourseVault; the database and index persist, and the indexer reconciles from authoritative resource records.

## DBMS data and rules

Tables include users, departments, courses, resources, ratings, messages, notifications, notification preferences, reports, resource versions, search history, reset tokens, audit logs, and activity logs. Foreign keys are enabled. Ratings use `UNIQUE(resource_id, student_id)` and a 1–5 check. Course/resource changes are stored in transactions where multiple records must move together. Indexes cover common course, recency, uploader, rating, conversation, notification, report, history, and audit queries.

SQLite is authoritative for resource metadata. The search index is derived and rebuildable. Admin can create a local backup of the database and uploaded files; `npm run restore:backup -- <backup-id>` confirms before replacing data and must be run while CourseVault is stopped.

## Web/API implementation

The Express API provides authentication/password reset/profile, departments/courses, advanced search and suggestions/history, upload/resource detail/version/file download, ratings, report submission/review, participant-checked conversations, delivery/read states, notification preferences, admin accounts/audit/metrics/backups/index rebuild, and health status. The browser includes login, role-specific tools, filter panel, suggestions, highlighting, pagination, PDF/video preview, ratings, reporting, version history, conversations, notification inbox, and admin catalog controls.

Authentication uses bcrypt password hashes and an HTTP-only same-site session cookie. Students and staff can register themselves; admin accounts remain administrator-provisioned. After login the API verifies the role and the client opens the matching workspace: student search, staff upload/index, or admin catalog management. Rating a resource or asking a doubt stores the event in SQLite and notifies the relevant staff or student. Password reset tokens are short-lived and single-use. In development, the reset token is shown in the UI because no mail provider is configured; production returns only the generic message and requires email delivery to be added before enabling resets there.

## Remaining environment-specific limits

- Scanned PDFs without a text layer need OCR, which is not enabled. Metadata and staff-provided searchable text remain indexed.
- Legacy binary DOC/PPT files can be uploaded and downloaded, but their body text is not extracted by the configured parser.
- The default session store is in-memory for the local student build. A deployed instance should use a persistent session store, secure `SESSION_SECRET`, HTTPS, backups, and a deployment-specific retention policy.
- Performance targets must be measured on the declared dataset and deployment hardware; no benchmark result is guaranteed by this source code.
