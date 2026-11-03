# Travel Planning & Booking Platform

Software Project I, Winter 2026 (German International University). A web platform to search and book flights and hotels, plan day-by-day itineraries with budgets, and share trips on a blog.

| Part | Technology | Status |
| --- | --- | --- |
| Backend (Milestone 1) | NestJS + MongoDB Atlas (Mongoose), REST API documented with Swagger | In progress |
| Frontend (Milestone 2) | Next.js (React, TypeScript) | Not started |

Milestone 1 is due 20 November 2026 and is graded through **Swagger UI**: an endpoint that cannot be demonstrated in Swagger does not count. Milestone 2 is due 11 December 2026.

## Repository layout

~~~
travel-platform/
|-- backend/        NestJS API (Milestone 1)
|-- frontend/       Next.js app (Milestone 2)
|-- docs/
|   |-- requirements/   project description (PDF)
|   |-- api/
|-- AI_PROMPTS.txt  log of AI prompts (required by the project)
|-- README.md
~~~

The official Excel requirements sheet is the authoritative source for business rules. Every requirement has an ID (for example `FLT-22`); use it in branch names, commits and pull requests.

## Run the backend locally

Prerequisites: Git, Node.js (the team develops with v24.21.0; use the same major version, 24), and npm. You also need the MongoDB connection string from the team leader (shared privately, never through Git or chat tools).

~~~
git clone https://github.com/youssefkhaleel0689/travel-platform.git
cd travel-platform/backend
npm install
~~~

The default branch is `develop`, so a fresh clone is already on it.

Create your local `.env` from the template:

~~~
# Windows (PowerShell)
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
~~~

Open `backend/.env`, put the connection string after `MONGODB_URI=` (no spaces, no quotes) and **save the file**. Then start the server:

~~~
npm run start:dev
~~~

Check that it works:

- The log contains `MongooseCoreModule dependencies initialized` and `Nest application successfully started`, with no `ERROR` line.
- `http://localhost:3000/api` returns `Hello World!`.
- `http://localhost:3000/api/docs` shows Swagger UI.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | Yes | Shared MongoDB Atlas connection string, including the database name (`/travel-platform`) |
| `PORT` | No | Server port, defaults to 3000 |

`.env` is ignored by Git. **Never commit it**, never paste the connection string into an AI tool, a chat, an issue or a pull request. If the password contains special characters (`@`, `#`, `/`), URL-encode them (`@` becomes `%40`).

### Useful scripts (run inside `backend/`)

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Run in watch mode (needs `.env`) |
| `npm run build` | Compile and catch TypeScript errors |

### Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Configuration key "MONGODB_URI" does not exist` | `.env` is missing, empty (check its size), not saved, or the key name is misspelled |
| `bad auth` | Wrong user or password in the connection string |
| `ENOTFOUND` | Wrong host in the connection string |
| `Cannot GET /` | Expected: all routes start with `/api` |

## API error format

Every error from the API has the same JSON shape, so the frontend can show messages next to each form field (GEN-02). Validation errors (400) list every invalid field in `errors`; nested objects and array elements use dotted paths such as `passengers.0.name`:

~~~
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "error": "Bad Request",
  "message": "Validation failed",
  "errors": [ { "field": "email", "messages": ["email must be an email"] } ],
  "path": "/api/auth/register",
  "timestamp": "2026-11-03T10:00:00.000Z"
}
~~~

All other errors have the same shape without `errors`:

~~~
{
  "statusCode": 404,
  "code": "NOT_FOUND",
  "error": "Not Found",
  "message": "Flight not found",
  "path": "/api/flights/123",
  "timestamp": "2026-11-03T10:00:00.000Z"
}
~~~

Default `code` per status (used when you do not set your own):

| Status | `code` |
| --- | --- |
| 400 | `BAD_REQUEST` (`VALIDATION_FAILED` for DTO validation) |
| 400 | `INVALID_VALUE` (a value Mongoose cannot convert, such as a malformed ObjectId in `/api/hotels/abc`; the value is never echoed) |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` (`DUPLICATE_KEY` for MongoDB unique index violations) |
| 500 | `INTERNAL_ERROR` (the message is always "Internal server error"; details go to the server log only) |
| other | `HTTP_<status>` |

Throw Nest's built-in exceptions. Pass an object to set your own `code`:

~~~
throw new NotFoundException('Flight not found');
throw new ConflictException({ code: 'SEAT_UNAVAILABLE', message: 'Only 1 seat left' });
~~~

Document error responses in Swagger with `ErrorResponseDto` from `src/common/dto/error-response.dto.ts`, for example `@ApiBadRequestResponse({ type: ErrorResponseDto })`. The setup lives in `src/app.setup.ts` (`configureApp`), which `main.ts` and the e2e tests share; see `test/error-format.e2e-spec.ts` for examples of every case.

## Team workflow

`develop` is the integration branch and `main` holds stable releases. Direct pushes are blocked: every change goes through a pull request that needs one approving review.

- **Branches:** always branch from the latest `develop`. Names: `feature/<ID>-<description>`, `fix/<ID>-<description>`, `docs/<description>`. Example: `feature/FLT-22-seat-hold`.
- **Commits:** conventional style, for example `feat(flights): add round-trip search`. Avoid vague messages such as "update", "changes", "final" or "fix".
- **Pull requests:** target `develop`, with a meaningful title and a description (What, Why, Verified, Notes), the requirement IDs listed, only related changes, and no secrets or `.env` files. Resolve review comments before merging.
- **Stay in sync:** merge `develop` into your branch regularly so conflicts stay small. After resolving a conflict, check that no teammate's work was deleted.
- **Before every commit:** run `git status --short` and stage files by name. `.env` must never appear.
- **AI usage:** record prompts that materially shaped your work in `AI_PROMPTS.txt` (date, student, tool, requirement, prompt, how the output was used). Never put passwords, tokens or connection strings in a prompt. Review all AI output before merging; you must be able to explain it.
- **Definition of done for a requirement:** works in Swagger with documented request and response examples, validated on the server, authorization checked, requirement ID in the pull request, prompt log updated, and a second person has reviewed it.

### Shared database rules

Everyone uses the same MongoDB Atlas database.

- Never drop a collection or delete data you did not create.
- Prefix your test data with your initials (for example `test_yk_`).
- Announce schema or index changes to the team before merging them.
- The seed script must be safe to run more than once.