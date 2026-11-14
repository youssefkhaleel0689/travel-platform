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

Open `backend/.env`, put the connection string after `MONGODB_URI=` (no spaces, no quotes), put your own secret after `JWT_SECRET=` (generate it with the command in "Environment variables" below) and **save the file**. Then start the server:

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
| `BCRYPT_COST` | No | bcrypt cost for password hashes, defaults to 12. Must be a whole number from 4 to 15; any other value (including an empty `BCRYPT_COST=`) stops the app at startup |
| `JWT_SECRET` | Yes | Secret that signs the access tokens (HS256). At least 32 characters; the app refuses to start when it is missing, empty or shorter. Every developer generates their own and keeps it only in `backend/.env` |
| `ADMIN_EMAIL` | Only for `npm run seed:admin` | Email of the admin account the seed creates (see "Admin account (ACC-18)"). Not needed to start the app |
| `ADMIN_PASSWORD` | Only for `npm run seed:admin` | Password of that admin; it must pass the password rules. Not needed to start the app |
| `ADMIN_NAME` | No | Name of that admin; empty or unset means `Platform Admin`; at most 100 characters |

Generate a `JWT_SECRET` (PowerShell, or any shell with Node) and paste the output after `JWT_SECRET=`:

~~~
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
~~~

**Never commit `JWT_SECRET` or paste it into any tool or chat**: whoever knows it can sign a token for any user. Changing it ends every existing session on your machine (requests get 401 until you log in again).

**Never commit `ADMIN_EMAIL` or `ADMIN_PASSWORD`, and never paste the admin password into any tool, chat or screenshot.**

`.env` is ignored by Git. **Never commit it**, never paste the connection string into an AI tool, a chat, an issue or a pull request. If the password contains special characters (`@`, `#`, `/`), URL-encode them (`@` becomes `%40`).

### Useful scripts (run inside `backend/`)

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Run in watch mode (needs `.env`) |
| `npm run build` | Compile and catch TypeScript errors |
| `npm run seed` | Build, then load the reference data into MongoDB (needs `.env`) |
| `npm run seed:admin` | Build, then create the admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env` (it boots the app, so it also needs `MONGODB_URI` and `JWT_SECRET`). Safe to run again: an existing admin is left unchanged |

### Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Configuration key "MONGODB_URI" does not exist` | `.env` is missing, empty (check its size), not saved, or the key name is misspelled |
| `JWT_SECRET is required` | `JWT_SECRET` is missing from `backend/.env` or empty: generate one with the command in "Environment variables" and add it to `backend/.env` |
| `JWT_SECRET must be at least 32 characters` | The value is too short: generate one with the command in "Environment variables" and put it in `backend/.env` instead |
| `ADMIN_EMAIL is required` (from `npm run seed:admin`) | `ADMIN_EMAIL` is missing from `backend/.env` or empty |
| `ADMIN_EMAIL: must be a valid email` or `ADMIN_EMAIL: must be at most 254 characters` | Fix the value of `ADMIN_EMAIL` |
| `ADMIN_PASSWORD is required` | `ADMIN_PASSWORD` is missing from `backend/.env` or empty |
| `ADMIN_PASSWORD: password must ...` (for example `ADMIN_PASSWORD: password must contain at least one digit`) | The password breaks the rule named after the colon (see the password rules in "Accounts and authentication"); the value itself is never printed |
| `ADMIN_EMAIL belongs to a non-admin account (USER) and will not be promoted` (or another role) | That email is already registered as a non-admin account. The seed never promotes an account: use another email for the admin |
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

Some 4xx errors also carry an optional `details` object with structured data the client needs, placed between `errors` and `path`. Today only `ACCOUNT_LOCKED` uses it; it also sends a `Retry-After` header (seconds until the lock ends):

~~~
HTTP/1.1 423 Locked
Retry-After: 900

{
  "statusCode": 423,
  "code": "ACCOUNT_LOCKED",
  "error": "Locked",
  "message": "account locked, try again later",
  "details": { "lockedUntil": "2026-11-13T10:15:00.000Z" },
  "path": "/api/auth/login",
  "timestamp": "2026-11-13T10:00:00.000Z"
}
~~~

Default `code` per status (used when you do not set your own):

| Status | `code` |
| --- | --- |
| 400 | `BAD_REQUEST` (`VALIDATION_FAILED` for DTO validation) |
| 400 | `INVALID_VALUE` (a value Mongoose cannot convert, such as a malformed ObjectId in `/api/hotels/abc`; the value is never echoed) |
| 401 | `UNAUTHORIZED` (only the filter's fallback for a bare 401; the auth guard returns `UNAUTHENTICATED` and login returns `INVALID_CREDENTIALS`) |
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

The filter reads only these fields from the object you pass; anything else is dropped:

| Field | Rules |
| --- | --- |
| `code` | String; the default for the status when missing |
| `message` | String (or an array of strings, joined with `; `); the status's reason phrase when missing |
| `errors` | Array of `{ field, messages }` field errors |
| `details` | Optional. A plain object (not an array, a `Date` or a class instance), kept only for a 4xx; a 5xx never carries `details`, so nothing internal can leak through them |
| `retryAfterSeconds` | Optional. A positive whole number, sent as the `Retry-After` header and never in the body; any other value is ignored |

For a status without a built-in exception class, such as 423, use `HttpException` with the status (see `accountLocked()` in `src/auth/auth.service.ts`):

~~~
throw new HttpException(
  {
    code: 'ACCOUNT_LOCKED',
    message: 'account locked, try again later',
    details: { lockedUntil: lockedUntil.toISOString() },
    retryAfterSeconds: 900,
  },
  HttpStatus.LOCKED,
);
~~~

Document error responses in Swagger with `@ApiErrorResponse` (see "Documenting errors in Swagger" below). The setup lives in `src/app.setup.ts` (`configureApp`), which `main.ts` and the e2e tests share; see `test/error-format.e2e-spec.ts` for examples of every case.

### Documenting errors in Swagger

Use `@ApiErrorResponse({ status, description, examples: [...] })` from `src/common/swagger/api-error-response.decorator.ts` for every error response. Never write `type: ErrorResponseDto` in an `@Api...Response` decorator.

Why: the examples on `ErrorResponseDto` are shared by every response that uses it, so every error showed the same 400 `VALIDATION_FAILED` body. `ApiErrorResponse` attaches each response's own example; the schema is still `ErrorResponseDto`. Each example only needs `code`, `message`, `path` and, when there are field errors, `errors`; `statusCode`, `error` (the reason phrase, as the filter sets it) and `timestamp` are filled in for you.

~~~
@ApiErrorResponse({
  status: 404,
  description: 'No such airline (AIRLINE_NOT_FOUND)',
  examples: [
    {
      code: 'AIRLINE_NOT_FOUND',
      message: 'Airline not found',
      path: '/api/airlines/6720f1c2a1b2c3d4e5f60718',
    },
  ],
})
~~~

An example can also include `details`, and `@ApiErrorResponse` accepts `headers` to document response headers. The login 423 (`src/auth/auth.controller.ts`):

~~~
@ApiErrorResponse({
  status: 423,
  description: 'Too many failed attempts: the account is locked for 15 minutes',
  headers: {
    'Retry-After': {
      description: 'Whole seconds until the lock ends (the same moment as details.lockedUntil)',
      schema: { type: 'integer', minimum: 1 },
    },
  },
  examples: [
    {
      code: 'ACCOUNT_LOCKED',
      message: 'account locked, try again later',
      path: '/api/auth/login',
      details: { lockedUntil: '2026-11-13T10:15:00.000Z' },
    },
  ],
})
~~~

Rules:

- Use codes and messages the endpoint really returns (read your service and the filter), and the endpoint's real path with an example id.
- When one status can return several codes, give one example per code; Swagger UI shows them in a dropdown named by code. Two examples with the same code in one response are refused.
- `test/swagger-docs.e2e-spec.ts` (part of `npm run test:e2e`; it boots the app, and like every e2e test that boots `AppModule` it needs both `MONGODB_URI` and `JWT_SECRET` in `backend/.env`) fails for any error response without its own example whose `statusCode` matches the response status. The failure names the endpoint and status, for example `GET /api/airlines/{id} 404: no example (use ApiErrorResponse)`.
- Branches that already document errors with `type: ErrorResponseDto` must switch to `ApiErrorResponse` after merging `develop`.

## Pagination (GEN-05)

Every list endpoint returns pages of exactly 10 items in the same shape. The client sends only `page` (starts at 1). There is no `limit`: `?limit=50` is rejected with a 400 validation error. The helpers live in `src/common/pagination/`.

~~~
{
  "items": [
    { "id": "6720f1c2a1b2c3d4e5f60718", "name": "Cairo to Berlin" },
    { "id": "6720f1c2a1b2c3d4e5f60719", "name": "Berlin to Rome" }
  ],
  "meta": {
    "page": 1,
    "pageSize": 10,
    "totalItems": 25,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
~~~

| Field | Meaning |
| --- | --- |
| `page` | The page that was returned (as requested, starting at 1) |
| `pageSize` | Always 10 |
| `totalItems` | Number of items matching the request across all pages |
| `totalPages` | Number of pages; 0 when there are no items |
| `hasNextPage` | `true` if `page` is before the last page |
| `hasPreviousPage` | `true` if `page` is greater than 1 |

Controller:

~~~
@Get()
@ApiPaginatedResponse(AccountDto)
list(@Query() query: PaginationQueryDto) {
  return this.accountsService.list(query.page);
}
~~~

Service:

~~~
return paginateQuery(this.userModel, filter, { page, sort: { createdAt: -1 } });

// For a list built in code:
return paginateArray(list, page);
~~~

Rules:

- Always bind `PaginationQueryDto`; the helpers assume a valid `page`, validation happens in the DTO.
- `paginateQuery` always adds `_id` as the last sort key so pages never repeat or skip rows; do not remove it.
- A page beyond the last returns `items: []` with status 200.
- Use `paginateQuery` when the data is in MongoDB; use `paginateArray` only for lists built in code (it loads the whole list in memory and does not sort).
- `paginateQuery` returns plain lean objects including `_id` and `__v`: map them to a response DTO and never return fields such as password hashes.

The helpers are in `src/common/pagination/`, and `test/pagination.e2e-spec.ts` shows every case end to end, including how the Swagger document looks.

## Module structure and conventions

The backend is organized into 7 feature modules plus shared code in `src/common/`. Every module follows the same layout, so any teammate can open any module and find things in the same place.

Feature modules:

| Module | Contains |
| --- | --- |
| `auth` | Registration, login, sessions, users |
| `flights` | Airlines, flights, cabins, prices, seat holds |
| `hotels` | Hotels, rooms, availability, room holds, reviews |
| `payments` | Stripe payments, refunds |
| `itineraries` | Itineraries, days, activities, budgets, exchange rates |
| `blog` | Posts, comments, likes |
| `administration` | Moderator accounts, account suspension, moderation of reports, audit log |

Where bookings live is decided at the data-model review.

Shared code: `src/common/` holds code used by several modules. It contains `auth/` (the shared `Role` and `UserStatus` enums and the `@Public`, `@Roles`, `@CurrentUser` and `@OptionalUser` decorators), `dto/` (`ErrorResponseDto`), `filters/` (`AllExceptionsFilter`), `pagination/`, `reference-data/`, `swagger/` (`ApiErrorResponse`), `time/` (airport time zones) and `validation/` (`validationExceptionFactory`); `notifications/` and `uploads/` are planned. Feature modules may import `common/`, but `common/` never imports a feature module, so there are no import cycles.

Layout of one module:

~~~
src/flights/
  flights.module.ts
  flights.controller.ts
  flights.service.ts
  flights.service.spec.ts
  schemas/
  dto/
~~~

Rules:

- Files are kebab-case (`flight-search.service.ts`), classes are PascalCase (`FlightSearchService`).
- Unit tests are `*.spec.ts` next to the file; end-to-end tests are in `test/`.
- Controllers validate and delegate, services hold the business rules, schemas define the data shape.
- A module uses another module through its exported service, never through its Mongoose model.
- IDs: reference data keeps the given string ids (`cairo`, `EG`, `CAI`, `att-1`); all other documents use ObjectId, returned to clients as a string `id`.
- Time: store dates in UTC and return ISO 8601; flight times are returned in the airport's local time with its offset (see "Airport time zones (GEN-06)"); each airport has an IANA `timeZone` (`CAI` is `Africa/Cairo`).
- Money: store as Decimal128 and return as a string (`"199.99"`). Convert it to a string in the response DTO mapping, not in a schema transform, because lean queries (`paginateQuery`) skip document transforms. Do arithmetic with a decimal library (decimal.js, not installed yet; the first module that needs money arithmetic adds it), never `Number()`. Convert to integer minor units only when calling Stripe.
- Currency: PAY-04 requires one platform currency; the team chose USD. Flight and hotel prices, payments and refunds are always USD and are never converted. Itinerary budgets may use any seeded currency (EGP, AED, GBP, USD, EUR, JPY, SAR); conversion applies to budgets only.
- Swagger: every endpoint has `@ApiTags`, a summary, `@ApiOkResponse` or `@ApiPaginatedResponse`, error responses documented with `@ApiErrorResponse` (`ErrorResponseDto` is only their shape; see "Documenting errors in Swagger"), and `@ApiCookieAuth` when it is protected.
- Errors and lists: throw Nest exceptions with an error code (see "API error format"); every list endpoint uses `PaginationQueryDto` (see "Pagination (GEN-05)").

Shared helpers are in `src/common/`, and the requirements sheet in `docs/requirements/` is the authoritative source for business rules.

## Reference data (GEN-12)

The seed loads countries, cities, airports (with IANA time zone), attractions and the supported currencies. It keeps the ids from the provided dataset (`cairo`, `EG`, `CAI`, `att-1`), because the same records and identifiers are used in the final evaluation.

The seed reads `MONGODB_URI` from `backend/.env`:

~~~
cd backend
npm run seed
~~~

| Collection | `_id` example | Fields |
| --- | --- | --- |
| `currencies` | `USD` | None besides `_id` |
| `countries` | `EG` | `name`, `currency` |
| `cities` | `new_york` | `name`, `countryId` |
| `airports` | `CAI` | `name`, `cityId`, `countryId`, `timeZone` |
| `attractions` | `att-1` | `name`, `cityId` |

A run validates all the data first and writes no documents if any check fails. It then upserts by `_id` with `replaceOne`, in the order of the table above, and never deletes. A second run with the same data changes nothing, which shows that it is safe to re-run:

~~~
currencies: total=7 upserted=0 modified=0 matched=7
countries: total=8 upserted=0 modified=0 matched=8
cities: total=8 upserted=0 modified=0 matched=8
airports: total=8 upserted=0 modified=0 matched=8
attractions: total=8 upserted=0 modified=0 matched=8
~~~

Endpoints:

| Endpoint | Requirement | Filters |
| --- | --- | --- |
| `GET /api/airports` | FLT-02 | `cityId`, `countryId` |
| `GET /api/countries` | ITN-01, HTL-01 | |
| `GET /api/cities` | ITN-05, ITN-16, HTL-01 | `countryId` |
| `GET /api/currencies` | ACC-09, ITN-18 | |

All four are public and paginated. An unknown but well-formed filter returns an empty page; a malformed one returns 400.

Using reference data in your module:

~~~
// hotels.module.ts
@Module({ imports: [ReferenceDataModule], providers: [HotelsService] })
export class HotelsModule {}

// hotels.service.ts
constructor(private readonly referenceData: ReferenceDataService) {}

async create(dto: CreateHotelDto) {
  await this.referenceData.assertCityExists(dto.cityId);
  // ...
}
~~~

| Method | Use it for | Error code (400) |
| --- | --- | --- |
| `getAirportOrThrow` | Flight creation and search (FLT-03, FLT-11) | `UNKNOWN_AIRPORT` |
| `assertCityExists` | Hotels, itinerary days, transport entries (HTL-01, ITN-05, ITN-16) | `UNKNOWN_CITY` |
| `assertCountriesExist` | Itinerary countries (ITN-01) | `UNKNOWN_COUNTRY` |
| `assertSupportedCurrency` | Preferred currency and budgets (ACC-09, ITN-14, ITN-16, ITN-18) | `UNSUPPORTED_CURRENCY` |

Rules:

- `docs/requirements/Mock_Data.xlsx` is the source. Each sheet is converted to one JSON file in `src/common/reference-data/data/` with the same column names (snake_case), the same row order and the values unchanged; `currencies.json` holds the distinct values of the Countries `currency` column in order of first appearance. The seed maps these names to the camelCase schema fields and validates the result. Any change to the workbook regenerates the JSON in the same pull request.
- Do not edit seeded documents by hand: the next seed run resets them to the dataset. Extra documents with other ids are left untouched.
- Tell the team before running the seed against the shared database for the first time with changed data.
- Validation and id formats live in `src/common/reference-data/` (`reference-data.patterns.ts`); other modules reuse those patterns instead of writing their own.
- Never inject the reference data models in a feature module; use `ReferenceDataService` (see "Module structure and conventions").
- Validate reference ids in your DTOs with the patterns in `reference-data.patterns.ts`; the service checks the format again, but the DTO gives the field-level error.
- Booking prices, payments and refunds are always USD (PAY-04); do not use `assertSupportedCurrency` for them.
- `test/reference-data.e2e-spec.ts` reads the seeded data on the shared database; run `npm run seed` first.

The module and schemas are in `src/common/reference-data/`, and the validation, mapping and entry point are in its `seed/` folder.

## Airport time zones (GEN-06)

Flight times are stored as UTC instants and shown in each airport's local time. Clients send local times without an offset (`2026-11-20T08:30`), and the airport's IANA `timeZone` supplies the zone. The helpers live in `src/common/time/` and use the built-in `Intl` API, so there is no date library.

| Function or decorator | Returns | Used by |
| --- | --- | --- |
| `toUtcFromAirportLocal(localDateTime, timeZone, field?)` | UTC `Date` | FLT-03, FLT-05 (departure and arrival times) |
| `toAirportLocalDateKey(instant, timeZone)` | `"2026-11-20"` | FLT-03 (`departureDateKey`), FLT-11 (today at the departure airport) |
| `toAirportLocalIso(instant, timeZone)` | `"2026-11-20T08:30:00+02:00"` | FLT-11, FLT-17 (local times in responses) |
| `@IsLocalDate()` | | FLT-11 (search dates) |
| `@IsLocalDateTime()` | | FLT-03, FLT-05 (request bodies) |

DTO:

~~~
@IsLocalDateTime()
departureLocal: string;
~~~

Service:

~~~
const airport = await this.referenceData.getAirportOrThrow(dto.departureAirportId);
const departureAtUtc = toUtcFromAirportLocal(dto.departureLocal, airport.timeZone, 'departureLocal');
const departureDateKey = toAirportLocalDateKey(departureAtUtc, airport.timeZone);

// In a response:
departureLocal: toAirportLocalIso(flight.departureAtUtc, airport.timeZone),
~~~

Some airports change their clocks for daylight saving time, so a local time can be skipped or repeated. In 2026, Cairo skips 24 April 00:00 to 00:59 and repeats 29 October 23:00 to 23:59.

| Case | Result |
| --- | --- |
| Bad format or a value that does not exist (`2026-02-30`, `24:00`) in a DTO | 400 `VALIDATION_FAILED` with a field error |
| The same value passed to `toUtcFromAirportLocal` directly | 400 `INVALID_LOCAL_DATE_TIME` |
| A time skipped by a DST change (Cairo `2026-04-24T00:30`) | 400 `NONEXISTENT_LOCAL_TIME` on the field named by `field` |
| A time that happens twice (Cairo `2026-10-29T23:30`) | Accepted as the earlier instant (`+03:00`) |
| A time zone that `Intl` does not know | `RangeError`, returned as 500 (zones come from the validated seed) |

Rules:

- Always take `timeZone` from `getAirportOrThrow`; never accept a zone or an offset from the client.
- Never use `new Date('YYYY-MM-DD')`: it means midnight UTC, not midnight at the airport.
- Never add 24 hours to reach the next day: a day with a DST change has 23 or 25 hours. Compare `departureDateKey` values instead.
- Store and compare UTC instants (`departureAtUtc`, `arrivalAtUtc`); compute duration as `arrivalAtUtc - departureAtUtc`, never from local times.
- `departureDateKey` is the departure airport's local date, so a Tokyo flight at `2026-11-19T23:30Z` has the key `2026-11-20`.

The helpers and their unit tests are in `src/common/time/`; `airport-time.spec.ts` lists the 2026 DST cases.

## Accounts and authentication (ACC-01, ACC-04, ACC-05, ACC-11, ACC-19, GEN-13)

A traveller creates an account with `POST /api/auth/register` and logs in with `POST /api/auth/login`; both start a session by setting the `access_token` cookie. Passwords are stored only as bcrypt hashes, and the rules for a new password are shared by every endpoint that sets one.

| Endpoint | Requirement | Access |
| --- | --- | --- |
| `POST /api/auth/register` | ACC-01, GEN-13 | Public |
| `POST /api/auth/login` | ACC-04, ACC-05 | Public |
| `GET /api/auth/me` | ACC-04, ACC-19 | Logged in |
| `GET /api/users/me` | ACC-11 | Logged in |

Register request body:

| Field | Rules |
| --- | --- |
| `name` | String, trimmed, not empty, at most 100 characters |
| `email` | Valid email, trimmed and lower-cased, at most 254 characters, not registered yet |
| `password` | The password rules below; used exactly as sent (not trimmed) |
| `acceptTerms` | Must be the boolean `true` (terms and privacy consent); `false`, a missing value or `"true"` fails with `acceptTerms must be true to register` |

~~~
{ "name": "Sara Ahmed", "email": "sara@example.com", "password": "Travel2026", "acceptTerms": true }
~~~

201 response (`UserResponseDto`, never `passwordHash`). Registration also logs the user in: the response sets the session cookie (see "Session cookie" below).

~~~
{
  "id": "6720f1c2a1b2c3d4e5f60718",
  "name": "Sara Ahmed",
  "email": "sara@example.com",
  "phone": null,
  "preferredCurrency": null,
  "role": "USER",
  "status": "ACTIVE",
  "mustChangePassword": false,
  "createdAt": "2026-11-12T10:00:00.000Z"
}
~~~

| Case | Result |
| --- | --- |
| A field breaks a rule | 400 `VALIDATION_FAILED` with a field error per invalid field |
| An unknown field, such as `role` | 400 `VALIDATION_FAILED`: it is rejected, not ignored |
| The email is already registered (in any case, with or without spaces) | 409 `EMAIL_ALREADY_REGISTERED` with a field error on `email` |

The role is always `USER`; it is set by the server, never read from the request. Admins cannot register: admin accounts are only seeded (see "Admin account (ACC-18)" below), and moderators are created by an admin (ACC-13).

Login request body: `email` (valid email, trimmed and lower-cased, at most 254 characters) and `password` (a non-empty string, used exactly as sent). The login DTO does not apply the password rules: login must not reveal them, and old passwords keep working if the rules change.

~~~
{ "email": "sara@example.com", "password": "Travel2026" }
~~~

| Case | Result |
| --- | --- |
| Right email and password, account `ACTIVE` | 200 with the profile (`UserResponseDto`, same shape as above) and the session cookie |
| Unknown email, or wrong password | 401 `INVALID_CREDENTIALS` (`invalid email or password`). Both give the same body, and an unknown email runs the same bcrypt work, so neither the response nor its timing reveals which emails are registered |
| Right password, account `SUSPENDED` | 403 `ACCOUNT_SUSPENDED` (`account suspended`) |
| Right password, account `DEACTIVATED` | 403 `ACCOUNT_DEACTIVATED` (`account deactivated`) |
| The 5th consecutive failure, or any attempt while the account is locked | 423 `ACCOUNT_LOCKED` (see "Account lockout (ACC-05)" below) |
| A field breaks a rule, or an unknown field | 400 `VALIDATION_FAILED` |

The status is checked only after the password matches, so a wrong password for a suspended account still gives 401 and does not reveal the status. No error response sets a cookie.

`GET /api/auth/me` and `GET /api/users/me` return the logged-in user's profile (`UserResponseDto`), or 401 `UNAUTHENTICATED`. The frontend calls `/api/auth/me` to learn who is logged in, because page scripts cannot read the httpOnly cookie. `/api/users/me` returns the same profile on the path where PATCH (ACC-09) and DELETE (ACC-12) will be added.

Session cookie (`src/auth/tokens/auth-cookie.ts`), set by register and login:

| Attribute | Value |
| --- | --- |
| Name | `access_token` |
| `HttpOnly` | Yes: page scripts cannot read it |
| `Secure` | Yes |
| `SameSite` | `Lax` |
| `Path` | `/` |
| `Max-Age` | 1800 (30 minutes) |

The cookie holds a JWT signed with `JWT_SECRET`; only HS256 is accepted, so a token that claims another algorithm or `none` is rejected. The payload is only `{ sub: <user id> }` plus the standard `iat` and `exp`; the role is never in the token. The token expires 30 minutes after it was issued, whether or not the user is active. The token is never in a response body.

Password rules (`src/common/validation/password.ts`), checked in this order; the field error is the message of the first rule broken:

| Rule | Message |
| --- | --- |
| A string | `password must be a string` |
| At least 8 characters (Unicode code points, so an emoji counts as one) | `password must be at least 8 characters` |
| At least one letter (any alphabet, so `كلمةسر12` is valid) | `password must contain at least one letter` |
| At least one digit | `password must contain at least one digit` |
| At most 72 bytes in UTF-8 | `password must be at most 72 bytes` |

bcrypt reads only the first 72 bytes of a password and ignores the rest, so a longer password would be silently cut. The cap is in bytes, not characters: an Arabic letter takes 2 bytes, so 40 Arabic letters plus a digit (41 characters, 81 bytes) is too long. `PasswordService` also refuses to hash more than 72 bytes, and its `verify()` returns `false` for a longer input, so "the 72 stored bytes plus anything" never matches.

Using the rules in your DTO (every DTO that accepts a new password: ACC-07a, ACC-08, ACC-13):

~~~
// No @Transform: never trim or change a password.
@IsValidPassword()
newPassword: string;
~~~

Creating and finding users from another module (illustration only: the administration module does not exist yet):

~~~
// administration.module.ts
@Module({ imports: [AuthModule], providers: [ModeratorsService] })
export class AdministrationModule {}

// moderators.service.ts
constructor(private readonly users: UsersService) {}

const profile = await this.users.create({
  name: dto.name,
  email: dto.email,
  password: dto.password,
  role: Role.AIRLINE_MODERATOR,
  mustChangePassword: true,
});
~~~

| `UsersService` method | Returns | Notes |
| --- | --- | --- |
| `create(input)` | `UserProfile` | Takes the plain password and hashes it; trims and lower-cases the email; 409 `EMAIL_ALREADY_REGISTERED` on a duplicate email. `termsAcceptedAt` defaults to `null`, `mustChangePassword` to `false` |
| `findById(id)` | `UserProfile` or `null` | `null` for an id that is not 24 hex characters, without querying |
| `findByEmail(email)` | `UserProfile` or `null` | Trims and lower-cases the email before the query |
| `verifyCredentials(email, password)` | `{ kind: 'ok', profile }`, `{ kind: 'invalid' }` or `{ kind: 'locked', lockedUntil }` | For login only. Applies the lockout (ACC-05), compares the password with the stored hash and never returns the hash; an unknown email runs a dummy bcrypt compare. Returns the profile whatever its status: the caller decides |

`UserProfile` has `id`, `name`, `email`, `phone`, `preferredCurrency`, `role`, `status`, `mustChangePassword` and `createdAt`; it never contains `passwordHash` or the lockout fields.

Rules:

- Never call bcrypt yourself and never store a hash you computed: create users with `UsersService.create()`, which hashes. `PasswordService` is the only file that calls bcrypt.
- Never inject the `User` model outside `src/auth/`; import `AuthModule` and use `UsersService` (see "Module structure and conventions").
- `passwordHash` has `select: false`, so normal queries never load it. Only `verifyCredentials()` (login) selects it explicitly, and the hash never leaves that method.
- Email uniqueness is guaranteed by the unique index on `users.email`, not by a lookup before the insert, so two parallel registrations with the same email give one 201 and one 409.
- `Role` (`USER`, `ADMIN`, `AIRLINE_MODERATOR`, `HOTEL_MODERATOR`) and `UserStatus` (`ACTIVE`, `SUSPENDED`, `DEACTIVATED`) come from `src/common/auth/auth.enums.ts`. Use them instead of string literals; the flights `ActorRole` type in `airline-actor.ts` should switch to `Role` later.
- `trimText` and `trimLower` for `@Transform` are in `src/common/validation/text-transforms.ts`. Import them from there, not from another module's DTO files.
- Available now: register and login set the session cookie, the global guards protect every route (see "Protecting your endpoints"), `/api/auth/me` and `/api/users/me` return the logged-in user, and repeated failed logins lock the account (ACC-05). Still to come: refresh tokens, logout and the 30-minute idle expiry (ACC-06, PR 4). Until PR 4 there is no logout endpoint, and a session ends when its cookie expires.
- `test/auth-register.e2e-spec.ts`, `auth-login.e2e-spec.ts`, `auth-guard.e2e-spec.ts`, `auth-me.e2e-spec.ts` and `auth-lockout.e2e-spec.ts` register real users in the database from `MONGODB_URI`. Every email starts with a prefix unique to the run (`e2e-register-`, `e2e-login-`, `e2e-guard-`, `e2e-me-` or `e2e-lockout-` followed by a timestamp), and each test deletes those users when it finishes; the login and guard tests also delete any airline whose name starts with their prefix.

### Account lockout (ACC-05)

5 consecutive failed logins lock the account for 15 minutes. A correct password resets the counter (`src/auth/users/login-lockout.ts` holds both numbers; they are fixed by the requirement, not set through `.env`).

| Case | Result |
| --- | --- |
| Account locked | 423 `ACCOUNT_LOCKED` (`account locked, try again later`) with `details.lockedUntil` (ISO date) and a `Retry-After` header (whole seconds until the lock ends); the body is shown in "API error format" |
| The 5th consecutive wrong password | 423 already, not 401 |
| Correct password while locked | Still 423, and no cookie is set |
| Unknown email, or wrong password before the 5th | The generic 401 `INVALID_CREDENTIALS`, unchanged |

The lock only stops new logins: existing sessions (the `access_token` cookie) keep working until they expire. Once the lock ends, the next login starts with a fresh count; there is no scheduled job.

Why the design: checking the lock and counting the failure after bcrypt would let parallel requests all pass the check before any failure is counted. Instead, each attempt first reserves a "ticket" with one atomic database update, before bcrypt, so parallel requests can never test more than 5 passwords per lock period. If a request holding the last ticket dies before writing the lock, the next attempt writes it, so the account unlocks after one lock period instead of staying locked forever.

Testing:

- Use a throwaway account, never the seeded admin: locking the shared admin locks it for the whole team.
- To unlock early on a dev database, set the user's `lockedUntil` to a past date in Atlas (collection `users`), or wait 15 minutes.

### Admin account (ACC-18)

There is no admin self-registration: `POST /api/auth/register` always creates a `USER`, and an `ADMIN` account comes only from the seed (`src/auth/seed/`).

To seed the admin (inside `backend/`):

1. Put `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env` (and optionally `ADMIN_NAME`). The password rules apply. To generate a password that passes them (the `7a` suffix guarantees a digit and a letter):

   ~~~
   node -e "console.log(require('crypto').randomBytes(18).toString('base64url') + '7a')"
   ~~~

2. Run `npm run seed:admin`.
3. Expect the log line `Admin account created for <email>`. On failure the script prints `Admin seed failed: <reason>` and exits with code 1 (see "Troubleshooting").

Behaviour:

- Idempotent: when an admin with that email already exists it logs `Admin account <email> already exists` and changes nothing, not even the password.
- It never promotes an existing account: if the email belongs to a `USER` or a moderator, it stops with an error.
- All variables are checked before the database is touched.
- The admin is created `ACTIVE`, with `mustChangePassword` set to `false` and no `termsAcceptedAt`.
- The password is never logged or included in an error message.

Shared database: the admin is seeded once for the whole team. Teammates get the admin credentials privately from the team leader, never through Git or chat tools.

The curl preview in Swagger UI shows the request body, including the password, after a login. Crop it out of any screenshot.

Rotating the admin password:

1. Delete the `ADMIN` user in Atlas (collection `users`).
2. Put the new `ADMIN_PASSWORD` in `backend/.env`.
3. Run `npm run seed:admin` again.

Old admin sessions stop working at once: the guard loads the user by id on every request, and the new admin has a new id.

### Protecting your endpoints

Every route requires a logged-in user unless it is marked `@Public()`. The two guards (`JwtAuthGuard`, then `RolesGuard`) are registered globally in `AuthModule`, so they apply to every module: a route that guests should reach but has no `@Public()` returns 401.

| Decorator (`src/common/auth/`) | Use |
| --- | --- |
| `@Public()` | On a method or a class: guests may call it. A valid cookie still sets `request.user`, but a missing or bad one is never rejected |
| `@Roles(Role.ADMIN, ...)` | Only these roles may call it; another logged-in user gets 403. Needs at least one role (`@Roles()` alone throws at startup). On a method it replaces the class's `@Roles` |
| `@CurrentUser()` | Parameter: the logged-in user. Use it on protected routes |
| `@OptionalUser()` | Parameter: the logged-in user or `undefined`, for public routes that behave differently for a logged-in user |

Example (illustration only: the hotels module does not exist yet):

~~~
import type { AuthenticatedUser } from '../common/auth/authenticated-user';

@Controller('hotels')
export class HotelsController {
  @Get(':id')
  @Public()
  findOne(@Param() params: HotelIdParamDto, @OptionalUser() user?: AuthenticatedUser) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateHotelDto, @CurrentUser() user: AuthenticatedUser) {}
}
~~~

Import `AuthenticatedUser` with `import type`: TypeScript requires it for a type used only in a decorated parameter with this project's settings.

`request.user` is `{ userId, role }` (`AuthenticatedUser`). The guard loads the user from the database on every request, so the role always comes from the database, and a suspension or role change applies to the very next request.

| Status | `code` | When |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` (`Authentication required`) | No cookie, a bad or expired token, a user that no longer exists, or an account that is not `ACTIVE`. The body is the same in every case |
| 403 | `FORBIDDEN` (`You do not have permission to do this`) | Logged in, but the role is not in `@Roles` |

Document every protected endpoint with `@ApiCookieAuth('access_token')` and a 401, plus a 403 when roles apply:

~~~
@Post()
@Roles(Role.ADMIN)
@ApiCookieAuth('access_token')
@ApiErrorResponse({
  status: 401,
  description: 'Not logged in, or the session is no longer valid (UNAUTHENTICATED)',
  examples: [{ code: 'UNAUTHENTICATED', message: 'Authentication required', path: '/api/hotels' }],
})
@ApiErrorResponse({
  status: 403,
  description: 'Not an admin (FORBIDDEN)',
  examples: [{ code: 'FORBIDDEN', message: 'You do not have permission to do this', path: '/api/hotels' }],
})
~~~

Trying it in Swagger UI:

- Run `POST /api/auth/login` (or register). The browser stores the cookie and sends it with every later request from Swagger UI, so no Authorize step is needed.
- The curl preview that Swagger UI shows has no cookie, because page scripts cannot read an httpOnly cookie. A copied curl command therefore gets 401.
- Safari may refuse `Secure` cookies over `http://localhost`; use Chrome or Firefox for Swagger.

In e2e tests, register or log in through the API and reuse the `access_token` cookie (see `accessTokenCookie` in `test/auth-me.e2e-spec.ts`):

~~~
const login = await request(app.getHttpServer())
  .post('/api/auth/login')
  .send({ email, password })
  .expect(200);
await request(app.getHttpServer())
  .get('/api/users/me')
  .set('Cookie', accessTokenCookie(login))
  .expect(200);
~~~

The endpoints, `UsersService`, `PasswordService`, `AccessTokenService`, the guards and the `User` schema are in `src/auth/`; the enums and decorators are in `src/common/auth/`, and the password rules and text transforms in `src/common/validation/`.

## Flight search (FLT-11, FLT-12, FLT-15)

`GET /api/flights/search` is public, so guests and logged-in users can both use it. It lists the SCHEDULED flights of ACTIVE airlines that have not departed yet, on the departure date at the departure airport, that have a cabin with a free seat for every adult and child. Each result shows only the cabins that match the search. The code is in `src/flights/flight-search/`.

| Parameter | Default | Rules |
| --- | --- | --- |
| `departureAirportId`, `arrivalAirportId` | required | Seeded airport codes (`GET /api/airports`), not the same airport |
| `departureDate` | required | `YYYY-MM-DD` on the departure airport's calendar, not before today there |
| `tripType` | `ONE_WAY` | `ONE_WAY` or `ROUND_TRIP` |
| `returnDate` | | Required for `ROUND_TRIP`, not allowed for `ONE_WAY`. Date at the return flight's airport, not before `departureDate` |
| `adults`, `children`, `infants` | 1, 0, 0 | At least 1 adult, `adults + children` at most 9, at most one infant per adult. Infants take no seat |
| `cabin` | any | `ECONOMY`, `PREMIUM_ECONOMY`, `BUSINESS` or `FIRST` |
| `minPrice`, `maxPrice` | none | Price per seat in USD, at most 2 decimals, both inclusive, `maxPrice` not below `minPrice` |
| `sortBy`, `sortOrder` | `price`, `asc` | `price` (`lowestPrice`), `duration` or `departureTime`; `asc` or `desc` |
| `page`, `returnPage` | 1 | Page of the outbound and of the return flights |

~~~
GET /api/flights/search?departureAirportId=CAI&arrivalAirportId=DXB&departureDate=2026-12-20&adults=2&infants=1

{
  "outbound": {
    "items": [
      {
        "id": "6720f1c2a1b2c3d4e5f60719",
        "airline": { "id": "6720f1c2a1b2c3d4e5f60718", "name": "EgyptAir", "iataCode": "MS" },
        "flightNumber": "MS910",
        "departureAirportId": "CAI",
        "arrivalAirportId": "DXB",
        "departureLocalTime": "2026-12-20T08:30:00+02:00",
        "arrivalLocalTime": "2026-12-20T14:30:00+04:00",
        "departureAtUtc": "2026-12-20T06:30:00.000Z",
        "arrivalAtUtc": "2026-12-20T10:30:00.000Z",
        "durationMinutes": 240,
        "lowestPrice": "199.99",
        "cabins": [
          { "category": "ECONOMY", "pricePerSeat": "199.99", "seatsAvailable": 42, "freeBaggageCount": 1, "maxBagWeightKg": 23 }
        ]
      }
    ],
    "meta": { "page": 1, "pageSize": 10, "totalItems": 1, "totalPages": 1, "hasNextPage": false, "hasPreviousPage": false }
  },
  "inbound": null
}
~~~

A `ROUND_TRIP` fills `inbound` with the flights back from `arrivalAirportId` to `departureAirportId` on `returnDate`, with the same passengers, cabin, price range and sort. Each leg has its own page.

| Case | Result |
| --- | --- |
| A missing or invalid parameter, or a rule between two of them | 400 `VALIDATION_FAILED` with one field error per mistake |
| An airport that is not seeded | 400 `UNKNOWN_AIRPORT` |
| A date before today at the airport the flight leaves from | 400 `DEPARTURE_DATE_IN_PAST` on `departureDate` or `returnDate` |
| No flight matches | 200 with `items: []` ("no flights found") |

Other modules search one leg through `FlightSearchService`, exported by `FlightsModule`. ITN-26 passes every airport of the itinerary's first city:

~~~
const flights = await this.flightSearch.searchLeg({
  departureAirportId: dto.originAirportId,
  arrivalAirportIds: cityAirports.map((airport) => airport.id),
  departureDate: itinerary.startDate,
  dateField: 'departureDate',
  seats: dto.adults + dto.children,
  sortBy: FlightSortBy.PRICE,
  sortOrder: SortOrder.ASC,
});
return paginateArray(flights, dto.page);
~~~

Rules:

- `minPrice` and `maxPrice` apply to each cabin's price per seat, so a flight lists only the cabins in range and `lowestPrice` is the cheapest of those. Prices are filtered and sorted as Decimal128 inside MongoDB; never convert them with `Number()`.
- Search shows prices per seat only. Totals, with infants at 10% of the fare, belong to the booking summary (FLT-21).
- Search never returns the seat counters, and its results are not a reservation: the hold (FLT-22) checks the seats again. For a round trip, the hold must also check that the return flight leaves after the outbound flight lands.

The unit tests are next to the code. `test/flight-search.e2e-spec.ts` runs the real endpoint on the shared database: it creates two airlines named `KE e2e search ...` with an unused two-digit IATA code and flights numbered `KE5xxx` in January 2099, and deletes only those. Run it with `npm run test:e2e -- flight-search`.

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