# CourseVault HTTP API

The API is served by the Express application on port `3000` in local development. Requests and responses use JSON unless a route accepts a `multipart/form-data` file upload. Sign-in creates an `HttpOnly`, same-site session cookie; send that cookie with later protected requests. `GET /api/health` is public. All `/api/admin/*` routes require the Admin role.

Common response codes are `200` for success, `201` for creation, `400` for invalid input, `401` for missing/expired sign-in, `403` for a role or permission failure, `404` for unavailable records, `409` for conflicts/duplicates, `410` for missing stored files, `415` for unsupported uploads, and `503` when a required search worker is unavailable.

## Authentication and profile

| Method and path | Access | Request / response |
|---|---|---|
| `GET /api/auth/me` | Public | Returns `{ "user": null }` or the signed-in user's safe profile. |
| `POST /api/auth/register` | Public | JSON: `name`, `email`, `password`, `role` (`Student` or `Staff`), `department_id`; students also provide `semester`. Creates the account and session. Admin registration is disabled. |
| `POST /api/auth/login` | Public | JSON: `email`, `password`. Returns the safe user and sets the session cookie. |
| `POST /api/auth/logout` | Signed-in | Destroys the session. |
| `POST /api/auth/password-reset/request` | Public | JSON: `email`. Always returns a generic confirmation; development may include a reset token. Production email requires SMTP configuration. |
| `POST /api/auth/password-reset/confirm` | Public | JSON: `token`, `password` (at least 10 characters). Tokens are one-use and expire after 30 minutes. |
| `GET /api/users/me` | Signed-in | Returns the current safe profile. |
| `PATCH /api/users/me` | Signed-in | JSON: `name`, optional `department_id`, optional `semester`. |

## Academic catalog and resources

| Method and path | Access | Request / response |
|---|---|---|
| `GET /api/departments` | Public | `{ items: [...] }`. |
| `GET /api/courses?departmentId=&semester=` | Public | Active courses, optionally filtered by department and semester. |
| `GET /api/resources?page=&limit=` | Signed-in | Paged visible resources. `limit` is capped at 30. |
| `GET /api/resources/recent?page=&limit=` | Signed-in | Paged recent resources visible to the caller. |
| `GET /api/resources/top-rated?page=&limit=` | Signed-in | Paged resources ordered by average rating. |
| `GET /api/resources/saved?page=&limit=` | Signed-in | The caller's saved resources. |
| `PUT /api/resources/:id/saved` | Signed-in | Saves a resource for the caller. |
| `DELETE /api/resources/:id/saved` | Signed-in | Removes it from the caller's saved list. |
| `GET /api/resources/:id` | Signed-in | Resource metadata and version history, subject to visibility rules. |
| `GET /api/resources/:id/file?download=1` | Signed-in | Opens or downloads the permitted file. Omit `download=1` for inline preview. Video resources redirect to their validated HTTPS link. |
| `POST /api/resources` | Staff, Admin | Multipart fields: `title`, `course_id`, `unit`, `type`, `description`, `content`, `visibility`, optional `file`, optional video `external_url`, optional `notify_updates`. Supported uploads are PDF, PPT/PPTX, DOC/DOCX, and TXT up to 25 MB. |
| `PATCH /api/resources/:id` | Owner staff, Admin | Multipart resource metadata and optional replacement file. The previous version is retained. |
| `POST /api/resources/:id/restore/:version` | Owner staff, Admin | Restores a saved version as a new current version. |
| `DELETE /api/resources/:id` | Owner staff, Admin | Soft-removes a resource and queues index removal. |
| `POST /api/resources/:id/report` | Student, Staff | JSON: `reason` (`incorrect`, `duplicate`, `outdated`, `inappropriate`) and optional `details`. |
| `PUT /api/resources/:id/rating` | Student | JSON: integer `value` from 1 through 5. Replaces the caller's existing rating. |

Resource records include `id`, title, description, type, department/course/unit/semester, uploader, timestamps, average rating, rating count, visibility, and file availability. Students can access resources in their department and resources marked public; staff can access their own resources and public resources; Admins can access all resources.

## Search

| Method and path | Access | Request / response |
|---|---|---|
| `GET /api/search?q=&departmentId=&courseId=&semester=&unitId=&type=&subject=&from=&to=&sort=&page=&limit=` | Signed-in | Ranked, paged results. `sort` accepts `relevance`, `recent`, or `rating`. Search text supports terms, `AND`, `OR`, `NOT`, parentheses, and `&`, `|`, `!` aliases. Adjacent terms default to OR. |
| `GET /api/search/suggestions?q=` | Signed-in | Up to eight title/course suggestions; `q` must have at least two characters. |
| `GET /api/search/history` | Signed-in | Up to 20 of the caller's recent searches. |
| `DELETE /api/search/history` | Signed-in | Clears the caller's search history. |

Search responses include `{ items, total, page, limit, pages, query, elapsedMs, indexVersion }`. Each result includes relevance, normalized rating and recency scores, the combined score, and an explanation of matched terms. Combined score weights are 0.60 relevance, 0.25 rating, and 0.15 recency.

## Questions, replies, and notifications

| Method and path | Access | Request / response |
|---|---|---|
| `GET /api/resources/:id/messages?studentId=` | Signed-in participants | Returns the conversation for the resource and student. The uploader/Admin can select a student; students see their own conversation. |
| `POST /api/resources/:id/messages` | Student, resource uploader, Admin | JSON: `body`; staff/Admin replies also include `studentId`. Message length is 1–3000 characters. |
| `GET /api/resources/:id/conversations` | Resource uploader, Admin | Lists student threads and unread counts for the resource. |
| `GET /api/notifications` | Signed-in | Returns up to 100 notifications and the unread count. |
| `PATCH /api/notifications/:id/read` | Signed-in owner | Marks one notification read. |
| `PATCH /api/notifications/read-all` | Signed-in | Marks all of the caller's notifications read. |
| `GET /api/notification-preferences` | Signed-in | Returns message, resource-update, and rating notification preferences. |
| `PATCH /api/notification-preferences` | Signed-in | JSON booleans: `messages`, `resource_updates`, and/or `ratings`. |

## Administration and operations

| Method and path | Access | Purpose |
|---|---|---|
| `POST /api/admin/departments`; `PATCH/DELETE /api/admin/departments/:id` | Admin | Create, edit, or delete departments. A department in use cannot be deleted. |
| `POST /api/admin/courses`; `PATCH/DELETE /api/admin/courses/:id` | Admin | Create, edit, or archive courses. |
| `GET/POST /api/admin/users`; `PATCH/DELETE /api/admin/users/:id` | Admin | List, create, update, or disable accounts. |
| `GET /api/admin/resources`; `POST /api/admin/resources/:id/remove` | Admin | List or remove resources. |
| `GET /api/admin/reports`; `PATCH /api/admin/reports/:id` | Admin | Review and update report status (`open`, `reviewing`, `resolved`, `dismissed`). |
| `GET /api/admin/audit`; `GET /api/admin/activity` | Admin | Read administrative audit records and operational events. |
| `GET /api/admin/metrics` | Admin | In-memory search request count, latency percentiles, error rate, throughput, and worker state. |
| `GET /api/admin/search-index/term/:term` | Admin | Inspect a normalized term's posting list. |
| `POST /api/admin/search-index/rebuild` | Admin | Rebuild the persistent index from active database resources. |
| `GET/POST /api/admin/backups` | Admin | List or create a SQLite and uploads backup. |
| `POST /api/admin/search-index/crash-check` | Admin, development only | Simulates an interrupted index write and verifies the previous snapshot remains intact. |
| `GET /api/health` | Public | Reports API status and indexer/query-handler connection state. |

The indexer and query handler use versioned IPC messages internally; they are not public HTTP routes. The API rejects cross-origin state-changing requests, validates uploads by extension, MIME type, and file signature, and returns generic client errors without stack traces.
