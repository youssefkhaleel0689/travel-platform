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
|       |-- openapi.yaml    the API contract, generated (see "API document (OpenAPI)")
|-- AI_PROMPTS.txt  log of AI prompts (required by the project)
|-- README.md
~~~

The official Excel requirements sheet is the authoritative source for business rules. Every requirement has an ID (for example `FLT-22`); use it in branch names, commits and pull requests.

## Run the backend locally

Prerequisites: Git, Node.js **24.9 or newer** (the team develops with v24.21.0), and npm. The version is not a preference: Jest loads this project's ESM dependencies through `require(esm)`, which Node gained in 24.9, so on Node 22 every test suite fails to load with `Must use import to load ES Module` while the app itself still starts. `backend/package.json` declares it in `engines`, so `npm install` warns you. You also need the MongoDB connection string from the team leader (shared privately, never through Git or chat tools).

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
| `MONGODB_URI` | Yes | Shared MongoDB Atlas connection string, including the database name |
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

**Never commit `JWT_SECRET` or paste it into any tool or chat**: whoever knows it can sign a token for any user. Changing it makes every access token signed with the old secret invalid at once (401). A session that is still live can get a new access token through `POST /api/auth/refresh`; otherwise log in again.

**Never commit `ADMIN_EMAIL` or `ADMIN_PASSWORD`, and never paste the admin password into any tool, chat or screenshot.**

| `STRIPE_SECRET_KEY` | No | Stripe **test mode** secret key (`sk_test_...`). Without it the payment endpoints answer 503 and everything else works, so only the people demonstrating payments need one |
| `STRIPE_WEBHOOK_SECRET` | No | The `whsec_...` printed by `stripe listen`. Without it every webhook delivery is rejected, because an unverified event is never trusted |
| `FXRATES_API_KEY` | No | FXRatesAPI key used by the backend to convert itinerary budgets. Optional, stays on the server |
| `FXRATES_API_URL` | No | Overrides the FXRatesAPI endpoint, defaults to `https://api.fxratesapi.com/latest` |

`.env` is ignored by Git. **Never commit it**, never paste the connection string into an AI tool, a chat, an issue or a pull request. If the password contains special characters (`@`, `#`, `/`), URL-encode them (`@` becomes `%40`).

### Useful scripts (run inside `backend/`)

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Run in watch mode (needs `.env`) |
| `npm run build` | Compile and catch TypeScript errors |
| `npm run seed` | Build, then load the reference data into MongoDB (needs `.env`) |
| `npm run seed:admin` | Build, then create the admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env` (it boots the app, so it also needs `MONGODB_URI` and `JWT_SECRET`). Safe to run again: an existing admin is left unchanged |
| `npm run openapi` | Build, then write the OpenAPI document Swagger UI serves to `docs/api/openapi.yaml` (needs `.env`: the app connects to MongoDB). See "API document (OpenAPI)" |
| `npm run test:e2e -- <name>` | Run the e2e test files whose name contains `<name>` (needs `.env` when the test uses the database) |

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
| `503 PAYMENTS_UNAVAILABLE` | `STRIPE_SECRET_KEY` is not set; expected unless you are working on payments |
| `501 BOOKING_TYPE_UNAVAILABLE` | No booking module provides a `BookingsPort` yet; expected until A1 or B2 lands |
| `501 PROVIDER_TYPE_UNAVAILABLE` | ACC-13 was asked for a moderator of a provider type whose module is not wired (both airline and hotel are wired now) |
| `bad auth` | Wrong user or password in the connection string |
| `ENOTFOUND` | Wrong host in the connection string |
| `querySrv ECONNREFUSED` | Your machine's DNS resolver will not answer the SRV lookup `mongodb+srv://` needs. Use the non-SRV form of the string (`mongodb://host1,host2,host3/db?replicaSet=...&authSource=admin&ssl=true`) in your own `.env` |
| `Cannot GET /` | Expected: all routes start with `/api` |
| `503 PAYMENTS_UNAVAILABLE` | `STRIPE_SECRET_KEY` is not set; expected unless you are working on payments |

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
- `test/swagger-docs.e2e-spec.ts` (part of `npm run test:e2e`; it boots the app, and like every e2e test that boots `AppModule` it needs both `MONGODB_URI` and `JWT_SECRET` in `backend/.env`) fails for any error response without its own example whose `statusCode` matches the response status. The failure names the endpoint and status, for example `GET /api/airlines/{id} 404: no example (use ApiErrorResponse)`. It also fails when an operation refers to a security scheme the document does not define, naming the method, path and key (see "API document (OpenAPI)").
- Branches that already document errors with `type: ErrorResponseDto` must switch to `ApiErrorResponse` after merging `develop`.

### API document (OpenAPI)

`docs/api/openapi.yaml` is the OpenAPI 3 document that Swagger UI serves at `/api/docs`, exported from the NestJS decorators (code-first: the decorators are the only source). It is the contract the frontend works against: open it in Swagger Editor, or generate a typed client from it.

To regenerate it, run inside `backend/`:

~~~
npm run openapi
~~~

It builds, creates the app without starting the HTTP server, writes the file and prints its path with the number of paths and operations. It needs `backend/.env`, because creating the app connects to MongoDB.

Rules:

- Never edit the file by hand: change the decorators and regenerate.
- For Milestone 1 the team leader regenerates it, which avoids merge conflicts in a large generated file. If two branches change it, resolve the conflict by regenerating, not by merging lines.
- The document's configuration (title, version, security schemes) lives only in `buildSwaggerDocument` (`src/swagger.setup.ts`), shared by `main.ts`, the export and `test/swagger-docs.e2e-spec.ts`, so all three describe the same API.
- Security schemes: the `access_token` cookie is registered under two keys, `cookie` and `access_token`, so both `@ApiCookieAuth()` and `@ApiCookieAuth('access_token')` are valid. `swagger-docs.e2e-spec.ts` fails, naming the method, path and key, if an operation refers to a scheme the document does not define.

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
| `flights` | Airlines, flights, cabins, prices, seat holds, flight bookings |
| `hotels` | Hotels, rooms, availability, room holds, reviews |
| `payments` | Stripe payments, refunds |
| `itineraries` | Itineraries, days, activities, budgets, exchange rates |
| `blog` | Posts, comments, likes, tags, author pages |
| `administration` | Moderator accounts, account suspension |
| `media` | The shared image-upload service (GEN-08) |
| `audit` | The append-only admin audit log (GEN-07) |
| `moderation` | Content reports and admin moderation (GEN-09, GEN-10) |

Where bookings live is decided at the data-model review: flight bookings live in `flights` (`flightBookings`, see "Seat inventory and flight bookings (FLT-22)").

Shared code: `src/common/` holds code used by several modules. It contains `auth/` (the shared `Role` and `UserStatus` enums and the `@Public`, `@Roles`, `@CurrentUser` and `@OptionalUser` decorators), `bookings/` (the GEN-11 lifecycle and `BookingsPort`), `providers/` (the ACC-13 `ModeratorAssignmentPort`), `dto/` (`ErrorResponseDto`), `filters/` (`AllExceptionsFilter`), `money/` (the platform currency and the Stripe conversion), `pagination/`, `reference-data/`, `swagger/` (`ApiErrorResponse`), `time/` (airport time zones) and `validation/` (`validationExceptionFactory`). Image uploads live in the feature module `src/media/` (GEN-08), because the service needs its own Mongoose collection. Feature modules may import `common/`, but `common/` never imports a feature module, so there are no import cycles.

Notifications were planned for `src/common/notifications/` but live in the feature module `src/notifications/` instead: GEN-01 has four endpoints, and a controller needs the guards and DTO wiring that a feature module provides. Other modules use it the normal way, through its exported `NotificationsService`.

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
- **Declare an ObjectId reference as `@Prop({ type: SchemaTypes.ObjectId })`, never `Types.ObjectId`.** They look interchangeable and are not: through Nest's `@Prop` the second compiles to a **Mixed** path, which casts nothing, so whatever you pass is stored as-is - a string id stays a string, and a later query with an `ObjectId` (or with a string, against rows written the other way) matches nothing and reports it as an empty result rather than an error. `SchemaTypes.ObjectId` casts a 24-character string to an ObjectId on both writes and queries, which is what every id field in this project wants. It matters most for ACC-11: `ownerFilter` and `findOwnedOrThrow` pass the plain string from the token and rely on that cast, so on a Mixed path they would 404 everything. Check a schema with `SomeSchema.path('userId').instance` - it must print `ObjectId`.
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

## Accounts and authentication (ACC-01, ACC-04, ACC-05, ACC-06, ACC-11, ACC-19, GEN-13)

A traveller creates an account with `POST /api/auth/register` and logs in with `POST /api/auth/login`; both start a session (ACC-06) and set the `access_token` and `refresh_token` cookies. Passwords are stored only as bcrypt hashes, and the rules for a new password are shared by every endpoint that sets one.

| Endpoint | Requirement | Access |
| --- | --- | --- |
| `POST /api/auth/register` | ACC-01, GEN-13 | Public |
| `POST /api/auth/login` | ACC-04, ACC-05 | Public |
| `POST /api/auth/refresh` | ACC-06 | Public (uses the `refresh_token` cookie) |
| `POST /api/auth/logout` | ACC-06 | Public |
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

201 response (`UserResponseDto`, never `passwordHash`). Registration also logs the user in: the response sets the session cookies (see "Session cookies" below).

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
| Right email and password, account `ACTIVE` | 200 with the profile (`UserResponseDto`, same shape as above) and the session cookies |
| Unknown email, or wrong password | 401 `INVALID_CREDENTIALS` (`invalid email or password`). Both give the same body, and an unknown email runs the same bcrypt work, so neither the response nor its timing reveals which emails are registered |
| Right password, account `SUSPENDED` | 403 `ACCOUNT_SUSPENDED` (`account suspended`) |
| Right password, account `DEACTIVATED` | 403 `ACCOUNT_DEACTIVATED` (`account deactivated`) |
| The 5th consecutive failure, or any attempt while the account is locked | 423 `ACCOUNT_LOCKED` (see "Account lockout (ACC-05)" below) |
| A field breaks a rule, or an unknown field | 400 `VALIDATION_FAILED` |

The status is checked only after the password matches, so a wrong password for a suspended account still gives 401 and does not reveal the status. No error response sets a cookie.

`GET /api/auth/me` and `GET /api/users/me` return the logged-in user's profile (`UserResponseDto`), or 401 `UNAUTHENTICATED`. The frontend calls `/api/auth/me` to learn who is logged in, because page scripts cannot read the httpOnly cookie. `/api/users/me` returns the same profile on the path where PATCH (ACC-09) and DELETE (ACC-12) will be added.

Session cookies (`src/auth/tokens/auth-cookie.ts`), set by register, login and refresh:

| Attribute | `access_token` | `refresh_token` |
| --- | --- | --- |
| `HttpOnly` | Yes: page scripts cannot read it | Yes |
| `Secure` | Yes | Yes |
| `SameSite` | `Lax` | `Lax` |
| `Path` | `/`: sent with every API request | `/api/auth`: sent only to the auth endpoints (refresh, logout) |
| `Max-Age` | 1800 (30 minutes) | Until the session's absolute end (at most 5 hours) |

The access cookie holds a JWT signed with `JWT_SECRET`; only HS256 is accepted, so a token that claims another algorithm or `none` is rejected. The payload is only `{ sub: <user id>, sid: <session id> }` plus the standard `iat` and `exp`; the role is never in the token, and a token without a valid `sid` is rejected like any invalid token. The token expires 30 minutes after it was issued, and the guard also refuses it as soon as its session ends (see "Sessions, refresh and logout (ACC-06)" below). Neither token is ever in a response body.

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
- Available now: register and login start a session and set both cookies, the global guards protect every route (see "Protecting your endpoints"), `/api/auth/me` and `/api/users/me` return the logged-in user, repeated failed logins lock the account (ACC-05), refresh, logout and the 30-minute idle expiry work (ACC-06), the owner-only access helper is ready for owner-scoped modules (ACC-11), and a user who must change the password is held to the allowed routes (ACC-07a, ACC-13).
- `test/auth-register.e2e-spec.ts`, `auth-login.e2e-spec.ts`, `auth-guard.e2e-spec.ts`, `auth-me.e2e-spec.ts`, `auth-lockout.e2e-spec.ts`, `auth-sessions.e2e-spec.ts`, `auth-refresh.e2e-spec.ts` and `auth-logout.e2e-spec.ts` register real users in the database from `MONGODB_URI`. Every email starts with a prefix unique to the run (`e2e-register-`, `e2e-login-`, `e2e-guard-`, `e2e-me-`, `e2e-lockout-`, `e2e-sessions-`, `e2e-refresh-` or `e2e-logout-` followed by a timestamp), and each test deletes those users when it finishes; the login and guard tests also delete any airline whose name starts with their prefix. The sessions, refresh and logout tests also delete their users' sessions; sessions left by the older tests are removed by the TTL index within 5 hours. `password-change-required.e2e-spec.ts` works the same way (prefix `e2e-pwchange-`) and deletes its users and their sessions. `ownership.e2e-spec.ts` creates no users: it uses only a temporary collection, `e2e_ownership_probe`, and drops it when it finishes.

### Sessions, refresh and logout (ACC-06)

Every login (and registration) creates one session in the `sessions` collection (`src/auth/sessions/`). A session ends when it is revoked (logout, or all of a user's sessions at once), after 30 minutes without requests (idle timeout), or 5 hours after login (absolute lifetime), whichever comes first. The guard checks the session on every request, so an ended session stops its access token at once, not when the token expires.

- The refresh token is 32 random bytes. Only its SHA-256 hash is stored, never the token itself.
- Activity (`lastActivityAt`) is recorded at most once a minute, so the idle timeout is exact to within a minute.
- A TTL index on `expiresAt` deletes expired sessions in the background. It only cleans up: validity is always checked in the query itself, because the deletion can lag.

`POST /api/auth/refresh` (no body; reads only the `refresh_token` cookie):

| Case | Result |
| --- | --- |
| A live session and an `ACTIVE` user | 200 with the profile (same as login), a new `access_token` and a new `refresh_token` for the same session. The old refresh token stops working at once (rotation); of two concurrent refreshes with the same token, exactly one succeeds |
| No cookie, an unknown or already used token, a session that is revoked, idle or past its end, or a user that is missing or not `ACTIVE` | 401 `UNAUTHENTICATED` (`Authentication required`), the same body in every case, and both cookies are cleared. For a user that is not `ACTIVE`, the session is also revoked |

Refresh checks no password, so the login lockout (ACC-05) does not apply to it.

`POST /api/auth/logout` (public, no body) always answers 204 and clears both cookies, whether or not a session existed, so it can be called twice. It ends the session found through the access cookie (the session id from the verified token) or through the refresh cookie; either is enough, so a logout still works after the access token has expired. Other sessions of the same user (other devices) keep working.

For teammates:

- `AuthenticatedUser` (`request.user`) now has a required `sessionId`, set by the guard only from the verified token; never take a session id from the body, query, params or headers. Test fixtures that build an `AuthenticatedUser` must include one, for example `sessionId: '6720f1c2a1b2c3d4e5f60799'`.
- To sign a user out everywhere, call `SessionsService.revokeAllSessions(userId, { exceptSessionId })` (exported by `AuthModule`). It returns how many sessions it revoked.

  | Requirement | Call |
  | --- | --- |
  | ACC-07a (admin password reset), ACC-12 (deactivation), ACC-16 (suspension) | `revokeAllSessions(userId)` |
  | ACC-08 (password change) | `revokeAllSessions(user.userId, { exceptSessionId: user.sessionId })`, so the device that made the change stays logged in |

- Never write to the `sessions` collection directly or inject the `Session` model outside `src/auth/`; use `SessionsService`.
- Tokens issued before ACC-06 have no `sid` and now get 401: log in again.

Shared Atlas database: the `expiresAt_1` index on `sessions` must be the TTL index (`expireAfterSeconds: 0`). Do not run e2e tests from a branch whose schema defines a different index on `sessions`: on startup it would try to create a conflicting index on the shared database.

### Owner-only access (ACC-11)

A user reaches only their own data: their bookings, private itineraries, posts and so on. The owner check is part of the database query (`src/common/auth/ownership.ts`), never a comparison after loading, so another user's document is never even loaded.

A missing resource, one owned by someone else and a malformed id all give the same 404 with the module's own not-found code, so the response never reveals which ids exist. 403 is only for the wrong role.

Reading one document (illustration only: the booking endpoints do not exist yet):

~~~
import { findOwnedOrThrow, ownerFilter } from '../common/auth/ownership';

const booking = await findOwnedOrThrow(this.flightBookingModel, id, user, {
  notFoundCode: 'FLIGHT_BOOKING_NOT_FOUND',
  notFoundMessage: 'Flight booking not found',
});

// Another owner field name, e.g. posts:
const post = await findOwnedOrThrow(this.postModel, id, user, {
  notFoundCode: 'POST_NOT_FOUND',
  notFoundMessage: 'Post not found',
  ownerField: 'authorId',
});
~~~

The owner field defaults to `userId`; `select` limits the loaded fields. A malformed id is refused without querying.

Changing a document: first `findOwnedOrThrow` (404 when missing or not yours), then one conditional update whose filter repeats `ownerFilter(user)` and the status the change expects. If nothing matched, the state changed in between: 409.

~~~
await findOwnedOrThrow(this.flightBookingModel, id, user, {
  notFoundCode: 'FLIGHT_BOOKING_NOT_FOUND',
  notFoundMessage: 'Flight booking not found',
});
const result = await this.flightBookingModel
  .updateOne(
    { _id: id, ...ownerFilter(user), status: BookingStatus.CONFIRMED },
    { $set: { status: BookingStatus.CANCELLED } },
  )
  .exec();
if (result.matchedCount === 0) {
  throw new ConflictException({ code: 'BOOKING_NOT_CANCELLABLE', message: 'Booking cannot be cancelled' });
}
~~~

Listing: put the owner condition into the filter you give `paginateQuery`:

~~~
return paginateQuery(this.flightBookingModel, { ...ownerFilter(user), ...otherFilters }, { page: query.page });
~~~

Rules:

- Take the owner only from `@CurrentUser()`, never from the body, query or params.
- Store the owner as an ObjectId reference to `users`.
- No admin bypass: admin views are separate `@Roles(Role.ADMIN)` endpoints (ACC-17).
- Moderators are scoped by their provider assignment (FLT-29, HTL-22), not by `ownerFilter`.

| Who uses it | Requirements |
| --- | --- |
| Flight and hotel bookings, and their cancellation | FLT-26, HTL-21 |
| Payments | PAY-01, PAY-02 |
| Itineraries | D1 |
| Own posts and comments | BLG |

### Password change required (ACC-07a, ACC-13)

The `mustChangePassword` flag is set when an admin resets a password (ACC-07a) or creates a moderator (ACC-13), and cleared when the user changes the password (ACC-08).

- Login still succeeds and returns `mustChangePassword: true`, so the client can redirect to the change-password screen.
- While the flag is set, every protected route returns 403 `PASSWORD_CHANGE_REQUIRED` (`password change required`), except routes marked `@AllowWhenPasswordChangeRequired()`. Today that is only `GET /api/auth/me`.
- `@Public` routes (login, refresh, logout, guest search) are not affected.
- The guard checks the flag after the token, session, user and status checks, on the user it loads for each request, so clearing the flag applies on the next request.

`PATCH /api/auth/change-password` (ACC-08) carries `@AllowWhenPasswordChangeRequired()` too, and clears the flag, so it is the one route that gets an account out of this state. `04` and `06` in `docs/api/evidence/` are the same account one request apart: the reset, then the 403 on a route it can no longer reach.

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
| `@AllowWhenPasswordChangeRequired()` | On a method or a class: a user who must change the password may still call it (see "Password change required (ACC-07a, ACC-13)") |

Example (illustration only, simplified from the real hotels module):

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

`request.user` is `{ userId, role, sessionId }` (`AuthenticatedUser`). The guard loads the user from the database on every request, so the role always comes from the database, and a suspension or role change applies to the very next request.

| Status | `code` | When |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` (`Authentication required`) | No cookie, a bad or expired token, a token without a session id, a session that is revoked, idle or past its end, a user that no longer exists, or an account that is not `ACTIVE`. The body is the same in every case |
| 403 | `FORBIDDEN` (`You do not have permission to do this`) | Logged in, but the role is not in `@Roles` |
| 403 | `PASSWORD_CHANGE_REQUIRED` (`password change required`) | Logged in, but the password must be changed first, and the route is not marked `@AllowWhenPasswordChangeRequired()` |

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

- Run `POST /api/auth/login` (or register). The browser stores both cookies and sends them with every later request from Swagger UI, so protected endpoints work with no Authorize step.
- Swagger UI does not call refresh by itself. After 30 minutes without requests the session is idle and you must log in again; before then, you can run `POST /api/auth/refresh` yourself to get a new access cookie.
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

The endpoints, `UsersService`, `PasswordService`, `AccessTokenService`, `SessionsService`, the guards and the `User` and `Session` schemas are in `src/auth/`; the enums, the decorators (including `@AllowWhenPasswordChangeRequired()` in `password-change.decorator.ts`) and the ownership helper (`ownership.ts`) are in `src/common/auth/`, and the password rules and text transforms in `src/common/validation/`.

## Seat inventory and flight bookings (FLT-22)

A flight booking holds seats for 10 minutes while the user pays. The seat counters live in each flight's `cabinInventory[]` (`totalSeats`, `bookedSeats`, `heldSeats`); free seats are always computed as `totalSeats - bookedSeats - heldSeats` and never stored. Only `SeatInventoryService` (`src/flights/seat-inventory/`) writes `bookedSeats` and `heldSeats`, each change in one conditional update, so concurrent requests can never oversell.

| Method | Moves seats | Called by |
| --- | --- | --- |
| `hold(change, session?)` | free -> held | FLT-22 hold |
| `releaseHeld(change, session?)` | held -> free | hold expiry, failed payment, FLT-06 (pending holds) |
| `convertHeldToBooked(change, session?)` | held -> booked | FLT-23 after a verified payment |
| `releaseBooked(change, session?)` | booked -> free | FLT-26, FLT-06 (confirmed bookings) |

`change` is `{ flightId, category, seats }`, where `seats` counts adults and children (infants take no seat).

Change the booking status and the counters in one transaction, and change the status only if it still has the expected value, so a release or conversion happens exactly once:

~~~
await this.connection.transaction(async (session) => {
  // e.g. PENDING_PAYMENT -> EXPIRED, only if it is still PENDING_PAYMENT
  for (const segment of booking.segments) {
    await this.seatInventory.releaseHeld(
      { flightId: segment.flightId, category: segment.cabinCategory, seats: segment.seatsRequired },
      session,
    );
  }
});
~~~

| Case | Result |
| --- | --- |
| Not enough free seats | 409 `SEAT_UNAVAILABLE` ("Only 1 seat left in ECONOMY") |
| Flight not SCHEDULED or already departed | 409 `FLIGHT_NOT_BOOKABLE` |
| The flight has no such cabin | 400 `CABIN_NOT_OFFERED` |
| No such flight | 404 `FLIGHT_NOT_FOUND` |
| A release or conversion finds too few seats | 500: the counters and the bookings disagree, which is a bug; the transaction rolls back |

Booking flow:

1. `POST /api/flight-bookings` (FLT-19, FLT-21) validates passengers and baggage and returns the summary. Nothing is stored.
2. `POST /api/flight-bookings/hold` (FLT-22) takes the same body, re-validates and re-prices it, and in one transaction holds every segment and creates the `PENDING_PAYMENT` booking with `holdExpiresAt` 10 minutes ahead.
3. Policies are accepted (PAY-02) and the booking is paid (PAY-01) with the booking id.
4. The verified Stripe webhook confirms it (FLT-23), or the hold expires and the seats are released. Both are described under "Flight bookings" below.

The `flightBookings` collection (`schemas/flight-booking.schema.ts`) stores a snapshot of each segment (with its cabin price), the passengers (each with its own `_id`, `dateOfBirth` as `YYYY-MM-DD`), baggage, prices in USD, the airline policy it was booked under (`policySnapshot`, PAY-02) and the cancellation. Indexes: `userId + status` (FLT-25), `status + holdExpiresAt` (hold expiry), `segments.flightId + status` (FLT-06, FLT-29), and a unique `bookingReference` that only applies once the reference is set.

Rules:

- Never write `bookedSeats` or `heldSeats` outside `SeatInventoryService`, and never read, check, then save: two requests can both pass the check.
- Never accept a booking status from the client (GEN-11).
- `documentNumber` is personal data: never return it in lists or the passenger export.

`test/seat-inventory.e2e-spec.ts` proves the concurrency rules on the shared database: 20 simultaneous holds for the last seat give exactly one winner, and a round trip whose return flight is full leaves both flights unchanged. It creates its own flights (random `airlineId`, flight numbers starting with `KE`, dates in 2099) and deletes only those. Run it with `npm run test:e2e -- seat-inventory`.

## Hotel room holds and double booking (HTL-18, B2)

Room availability is derived from bookings, not stored as a free-room counter: a room is unavailable for a night when a `CONFIRMED` booking or an unexpired `PENDING_PAYMENT` hold covers that night (PAY-01/HTL-18). Expired holds stop blocking immediately, so correctness does not depend on the expiry worker having run.

A hold is all-or-nothing across the selected rooms. `POST /api/hotel-bookings` opens one MongoDB transaction, locks every selected room, re-checks availability for the whole stay, and inserts the reservation. If any room fails, the transaction aborts and **no** room is held.

Why two parallel holds cannot take the last room: `InventoryService.lockRooms()` increments `lockVersion` on every selected `Room` document inside the transaction. Two transactions touching the same room write the same field, so MongoDB raises a `WriteConflict` and aborts one of them. `connection.transaction()` retries the loser, which then re-reads availability, sees the first request's committed hold and returns 409 `ROOM_UNAVAILABLE`. Ordinary unique indexes cannot express "no overlapping date range", which is why the lock plus transaction is needed. The same mechanism protects availability edits and room deactivation.

`test/hotel-hold.e2e-spec.ts` runs against the shared database: two parallel holds for the last free room give exactly one 201 and one 409, and a hold for rooms 1 and 2 while room 2 is taken gives 409 with nothing held on room 1.

Run `npm run seed:hotels` after `npm run seed` and `npm run seed:admin` to load demo hotels and rooms in the seeded reference cities, so every hotel endpoint has data in Swagger. The seed is idempotent and needs `ADMIN_EMAIL` in `backend/.env` for `createdBy`.

How the hotel side fits together:

- **One hotel module.** `src/hotels/` (HTL-01) owns the `hotels` and `hotelModeratorAssignment` collections. Rooms, availability, policies, search, reservations and reviews read hotels only through the `HotelsService` it exports: `getActiveHotelOrThrow`, `assertManagesHotel` (the assigned moderator, or an admin where `allowAdmin` is set), `findActiveByCityOrCountry`, `briefs` and `setRatingAggregate`.
- **Payments (PAY-01, PAY-02).** Hotel reservations implement the shared `BookingsPort` in `src/hotel-bookings/hotel-bookings.port.ts`, provided as `HOTEL_BOOKINGS_PORT` by the global `HotelBookingsModule`. Statuses and port types come from `src/common/bookings/`, never from a copy. `confirmAfterPayment` is idempotent: a repeated webhook returns the same reference. The Stripe webhook sends the `BOOKING_CONFIRMED` notice, so the hotel side does not send it again.
- **Hold expiry.** The hotel worker marks expired holds `EXPIRED`. C2's `PaymentExpiryService` then cancels the open PaymentIntent of any booking that is no longer payable.
- **Refunds (HTL-21, PAY-03).** A cancellation calls C2's `RefundsService.issueForCancellation` through `HotelPaymentsAdapter` (`src/hotel-bookings/hotel-integration.adapters.ts`). The adapter looks `RefundsService` up when a refund is needed instead of injecting it, which breaks the provider cycle gateway → hotel port → hotel bookings → refunds → payments → gateway without `forwardRef`. A failed Stripe refund is recorded as `FAILED` and never undoes the cancellation.
- **Notifications (GEN-01).** `HotelNotificationsAdapter` sends the cancellation notice through `NotificationsService`.
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

Other modules search one leg through `FlightSearchService`, exported by `FlightsModule`. A leg can leave from and land at several airports, which is how ITN-26 searches every airport of a city (see "Flight search from an itinerary" below):

~~~
const flights = await this.flightSearch.searchLeg({
  departureAirportIds: [query.originAirportId],
  arrivalAirportIds: await this.referenceData.listAirportIdsInCity(cityId),
  departureDate: '2026-12-20',
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

## Flight search from an itinerary (ITN-26)

`GET /api/itineraries/:id/flights` searches flights from an airport the user chooses to **any airport in the city of the itinerary's first day**, one way or round trip. It lives in `src/flights/itinerary-flights/` (its own `ItineraryFlightsModule`, because it needs both `FlightsModule` and `ItinerariesModule` and neither should import the other) but sits under `/itineraries` with D1's auth and ownership answers.

| Parameter | Default | Rules |
| --- | --- | --- |
| `originAirportId` | required | A seeded airport, not in the itinerary's first city |
| `departureDate` | the itinerary's start date | `YYYY-MM-DD` on the origin airport's calendar, not before today there |
| `tripType` | `ONE_WAY` | `ONE_WAY` or `ROUND_TRIP` |
| `returnDate` | the date of the itinerary's last day | `ROUND_TRIP` only, not before `departureDate` |
| `adults`, `children`, `infants`, `cabin`, `minPrice`, `maxPrice`, `sortBy`, `sortOrder`, `page`, `returnPage` | as in search | The same fields and rules as `GET /api/flights/search` (the DTO is built from search's with `OmitType`) |

- The itinerary is read with D1's `ItinerariesService.findOwnedOrThrow`, so another account's itinerary, a missing one and a malformed id all answer 404 `ITINERARY_NOT_FOUND`. Day dates come from D1's `dateOfDay(startDate, index)`.
- The destination airports are `ReferenceDataService.listAirportIdsInCity(cityId)`. The outbound leg flies from the origin to any of them; a round trip flies back from any of them to the origin. Results, sorting, paging and `DEPARTURE_DATE_IN_PAST` are search's own (`searchLeg`), unchanged.
- The response is search's two pages plus what the itinerary decided: `destinationCityId`, `destinationAirportIds`, `departureDate` and `returnDate` (null one way).

| Case | Result |
| --- | --- |
| The itinerary has no day yet | 409 `ITINERARY_HAS_NO_DAYS` |
| The first city has no seeded airport | 409 `NO_AIRPORT_IN_CITY` |
| The origin airport is in that city | 400 `ORIGIN_IN_DESTINATION_CITY` on `originAirportId` |
| A chosen `departureDate` after the itinerary's last day, with the default return date | 400 `RETURN_BEFORE_DEPARTURE` on `returnDate` |

The unit tests are next to the code. `test/itinerary-flights.e2e-spec.ts` creates its itineraries through D1's own endpoints and checks the defaults, a round trip, chosen dates, the 404, the 400 and the 409 on the shared database. It creates one airline named "KE e2e itinerary flights" with an unused two-digit IATA code from 70 up, flights numbered `KE8xxx` in March 2099 and `test_c2_` accounts with their itineraries, and deletes exactly those. Run it with `npm run test:e2e -- itinerary-flights`.

## Flight details (FLT-17)

`GET /api/flights/:id` is public, like search, so a guest can open the details page from a search result. It returns:

- the airline (`id`, `name`, `iataCode`), the flight number and the `status`;
- both airports as seeded (name, city, country, time zone);
- local departure and arrival times in each airport's own time zone (GEN-06), the UTC times and the duration;
- every cabin with its price per seat, `seatsRemaining` (total minus booked minus held, never below 0) and its baggage allowance;
- the airline's terms from `AirlinePoliciesService.getForAirline()`: extra-bag price and limit, and the cancellation tiers from the most days before departure to the fewest. An airline without a policy shows `null` extra bags and no tiers, the same terms a booking would get.

The seat counters themselves are never returned. A flight of an airline that is not `ACTIVE` answers 404 `FLIGHT_NOT_FOUND`, the same as a missing flight or a malformed id, because search hides it too (ACC-15). A cancelled or departed flight is still shown, with its status, so an old link explains itself.

`FlightDetailsController` is the last controller in `flights.module.ts` on purpose: routes match in the order they are registered, and `GET /flights/:id` registered before search would take `GET /flights/search` as a flight with the id `search`. `test/flight-details.e2e-spec.ts` checks the full response for a guest, the three 404s and that search still answers. It creates two airlines named "KE e2e details ..." with unused two-digit IATA codes from 30 up, a policy and flights numbered `KE7xxx` in March 2099, and deletes exactly those.

## Flight bookings (FLT-19, FLT-21, FLT-22, FLT-23)

The code is in `src/flights/flight-bookings/`. Every route is for a signed-in traveller (`@Roles(Role.USER)`): a moderator or an admin gets 403.

| Endpoint | Requirement | Notes |
| --- | --- | --- |
| `POST /api/flight-bookings` | FLT-19, FLT-21 | The summary: checks and prices the request and stores nothing (200) |
| `POST /api/flight-bookings/hold` | FLT-22 | The same body: holds the seats for 10 minutes and creates the `PENDING_PAYMENT` booking (201) |
| `GET /api/flight-bookings/:id` | FLT-22, ACC-11 | One of your bookings, with its status, `holdExpiresAt` and, once paid, its `bookingReference` |
| `GET /api/flight-bookings/:id/e-ticket` | FLT-23, ACC-11 | The e-ticket of one of your CONFIRMED (or COMPLETED) bookings, as a PDF download |

The body of both POST routes:

~~~
{
  "tripType": "ROUND_TRIP",                                // optional, ONE_WAY by default
  "outbound": { "flightId": "...", "cabin": "ECONOMY" },
  "inbound": { "flightId": "...", "cabin": "ECONOMY" },    // only for a ROUND_TRIP
  "passengers": [
    {
      "fullName": "Khaled Elshitany",
      "dateOfBirth": "2004-03-10",
      "passengerType": "ADULT",                            // ADULT, CHILD or INFANT
      "documentNumber": "A12345678",
      "extraBags": { "count": 1, "weightKg": 20 }          // optional
    }
  ]
}
~~~

Prices, seats and the status never come from the client: the server reads them from the flights and the airline every time, and the hold prices the request again instead of trusting the summary.

Rules, in the order they are checked:

- **The body** (400 `VALIDATION_FAILED`): 1 to 18 passengers, at least one adult, no more infants than adults and at most 9 adults and children. `documentNumber` is 5 to 30 letters and digits, stored upper-case. A rule between two values stays silent while one of them is invalid, so each mistake gives one error.
- **The flights**: each must exist (404 `FLIGHT_NOT_FOUND`), be `SCHEDULED`, not have departed and belong to an `ACTIVE` airline (409 `FLIGHT_NOT_BOOKABLE`), offer the cabin (400 `CABIN_NOT_OFFERED`) and have a seat for every adult and child (409 `SEAT_UNAVAILABLE`, on `outbound.cabin` or `inbound.cabin`).
- **A round trip**: the return flies the same route backwards (400 `ROUND_TRIP_ROUTE_MISMATCH`) and leaves after the outbound flight lands (400 `RETURN_BEFORE_ARRIVAL`).
- **Passenger types** (FLT-12): the type must match the age on the outbound departure date, adult 12 and over, child 2 to 11, infant under 2 (400 `PASSENGER_TYPE_MISMATCH`, on the passenger's `passengerType` or `dateOfBirth`).
- **Extra bags** (FLT-21): only when the airline sells them, up to its limit per passenger, and no heavier than the lighter cabin's `maxBagWeightKg` on a round trip (400 `EXTRA_BAGS_NOT_ALLOWED`).

Prices: adults and children pay the cabin price, an infant sits on a lap (no seat) and pays 10% of it, rounded half up. An extra bag costs the airline's price once per segment, so a round trip charges it twice. All amounts are decimal strings in USD through `common/money`; nothing goes through a float.

The hold runs in one transaction (`connection.transaction`): the flights and the airline are read with the transaction's session, every segment is held through `SeatInventoryService`, and the booking is created with snapshots of the segments, the passengers, the bags, the prices and the airline policy. If any step fails, nothing is held and nothing is stored. The response is the summary plus `id`, `status`, `holdExpiresAt`, `bookingReference` (null until paid) and `createdAt`. `documentNumber` is personal data, so every response masks it to its last four characters (`•••••5678`).

`GET /api/flight-bookings/:id` uses `findOwnedOrThrow`: another account's booking, a missing one and a malformed id all answer the same 404 `BOOKING_NOT_FOUND`, so ids cannot be probed.

### The airline policy

The booking takes the **outbound** airline's policy, because FLT-12 cancels a round trip with the outbound tier, and stores it in `policySnapshot`. That snapshot is what PAY-02 shows and what a later cancellation (FLT-26) uses, so an airline editing its policy never changes an existing booking.

`FlightBookingPolicyReader` reads it with `AirlinePoliciesService.getForAirline()` (FLT-08, FLT-09) and copies the version, the extra-bag price and limit and the cancellation tiers, nothing else. An airline that has never defined a policy gets version 0: no extra bags for sale (they answer "this airline does not sell extra bags") and no cancellation tiers. A stored policy starts at version 1, so 0 always means "no policy".

### Connected to payments (GEN-11)

`FlightBookingsPortAdapter` is the flights side of the `BookingsPort` described under "Booking lifecycle and the BookingsPort". Payments never reads `flightBookings` itself.

| Method | What it does |
| --- | --- |
| `findPayable` | The total and currency from the price snapshot, `holdExpiresAt` only while `PENDING_PAYMENT`, and the airline as the provider |
| `findPolicies` | The booking's `policySnapshot`, with its `version` as `policyVersion` |
| `confirmAfterPayment` | In one transaction: `PENDING_PAYMENT` -> `CONFIRMED` with `confirmedAt`, `paymentId` and a new `bookingReference`, and the held seats become booked seats. A repeated call returns the same reference and moves nothing; once the hold has run out it is refused with 409 `HOLD_EXPIRED` |
| `releaseHold` | In one transaction: `PENDING_PAYMENT` -> `EXPIRED` with `expiredAt`, and the held seats go back. It only matches a `PENDING_PAYMENT` booking, so a second call changes nothing |
| `hasUpcomingConfirmedBookings` | A `CONFIRMED` booking with a segment that has not departed (ACC-12) |

The booking reference is 6 random characters (`crypto.randomInt`) from A to Z and 2 to 9 without 0, O, 1 and I, which are easy to misread: about a billion values. The unique index on `bookingReference` refuses a clash, and the confirmation is retried with a new reference, up to three times. Payments sends the `BOOKING_CONFIRMED` notification (GEN-01) itself; `confirmAfterPayment` also returns an optional one-line `summary` of what was booked, which the notice adds after the reference (see "E-ticket and the confirmation notice" below).

`FlightBookingsModule` is `@Global()` and exports only `FLIGHT_BOOKINGS_PORT`. `BookingsGateway` is created inside `BookingsModule` (`common/`), and a provider is only visible to the modules that import the module exporting it. `common/` must never import a feature module, so `BookingsModule` cannot import this one; a global module's exports are visible everywhere, `BookingsModule` included. Exported from an ordinary module instead, the gateway's optional port stays undefined and every flight payment answers 501. `test/flight-bookings.e2e-spec.ts` checks that `gateway.supports(BookingType.FLIGHT)` is true and that `GET /api/bookings/flight/:id/policies` returns the snapshot.

### E-ticket and the confirmation notice (FLT-23)

After the verified Stripe webhook, `confirmAfterPayment` does the first three parts of FLT-23 in one transaction: CONFIRMED, held seats become booked seats, and a unique booking reference. The rest:

- **The notice.** `BookingConfirmation` has an optional `summary` that payments' webhook adds to the `BOOKING_CONFIRMED` message: "Your flight booking K7Q2PX is confirmed: KD100 CAI to DXB on 20 Dec 2026, 08:30; 3 passengers. 434.98 USD was paid." Times are local to each departure airport. It is built after the transaction commits, and a failure there only leaves the summary out: a paid booking is never un-confirmed by a notice. Hotels need not set it; without it the notice is the reference and the amount.
- **The e-ticket.** `GET /api/flight-bookings/:id/e-ticket` answers `application/pdf` with `Content-Disposition: attachment; filename="e-ticket-<reference>.pdf"`. It is built on every download from the booking response itself (`e-ticket/e-ticket.view.ts` turns it into printable lines, `e-ticket/e-ticket.pdf.ts` draws them with [pdfkit](https://pdfkit.org)), so it is never out of date and nothing is stored: `ticketFileUrl` stays null. It shows the reference, each flight with its airline and airport names and local times, the duration, cabin and baggage, the passengers with their document numbers masked, the price and the cancellation tiers.
- **Who gets it.** Only the owner (`findOwnedOrThrow`, the same 404 for anyone else), and only once the booking is CONFIRMED or COMPLETED. Before payment, or after a cancellation or expiry, it is 409 `TICKET_NOT_AVAILABLE`.
- **Fonts.** The PDF uses the built-in Helvetica, which only covers Windows-1252 characters (Latin letters, accents, `•`). Anything else, such as Arabic letters in a name, is printed as `?` rather than as broken glyphs. Passport names are in Latin letters, so this is rare.
- **The confirmation page** is the frontend's: `GET /api/flight-bookings/:id` already returns the CONFIRMED status and the reference.

### Hold expiry

`FlightHoldExpiryService` runs every minute (`@Cron`; `ScheduleModule.forRoot()` is registered once, in `PaymentsModule`). It finds up to 100 `PENDING_PAYMENT` bookings past `holdExpiresAt`, oldest first (the `status + holdExpiresAt` index), and calls `releaseHold` with `HOLD_EXPIRED` for each.

Payments' own sweep only looks at bookings with an open payment, so without this job a hold the user never started paying for would keep its seats for good. When both reach the same booking, the first one releases the seats and the second changes nothing. A hold keeps its seats for 11 minutes at most, one failing booking is logged without stopping the rest, and a run is skipped while the previous one is still going.

### Tests

Unit: `dto/flight-booking-request.dto.spec.ts` (through the real `ValidationPipe`), `flight-booking-pricing.spec.ts`, `flight-bookings.service.spec.ts`, `flight-booking-policy.reader.spec.ts`, `e-ticket/e-ticket.view.spec.ts`, `e-ticket/e-ticket.pdf.spec.ts`, `flight-bookings-port.adapter.spec.ts` and `flight-hold-expiry.service.spec.ts`.

`test/flight-bookings.e2e-spec.ts` runs against the shared database: 401 and 403, a summary that stores nothing, a full return flight reported before anything is held, the 201 hold, a rollback when the second segment cannot be held, 6 simultaneous holds for 3 free seats giving exactly 3, the owner-only `GET`, the policies endpoint through the real gateway, confirmation (reference, held to booked, idempotent, the notice summary), the e-ticket (409 before payment, the PDF after it, 404 for another account), ACC-12, a release that happens once, the expiry job, and extra bags priced from a real airline policy while older bookings keep the version they were made under. It creates one airline named "KE e2e booking" with an unused two-digit IATA code from 50 up, flights numbered `KE6xxx` in February 2099 `test_c2_` accounts and that airline's policy, and deletes exactly those. Run it with `npm run test:e2e -- flight-bookings`.

## Account management (ACC-07a, ACC-08, ACC-09, ACC-12, ACC-13, ACC-14, ACC-16)

Login, the cookie and the guards are described under "Accounts and
authentication" above. This section covers the account endpoints built on top
of them.

| Endpoint | Requirement | Notes |
| --- | --- | --- |
| `PATCH /api/auth/change-password` | ACC-08 | Needs the current password; the new one goes through the shared password rules |
| `PATCH /api/users/me` | ACC-09 | Name, phone, preferred currency; `null` clears the last two |
| `DELETE /api/users/me` | ACC-12 | Needs `confirm: true`; blocked while an upcoming confirmed booking exists |
| `GET /api/admin/accounts` | ACC-14 | Admin only; search by name or email, filter by role and status |
| `PATCH /api/admin/accounts/:id/suspend` | ACC-16, ACC-15 | Keeps the account's bookings valid and notifies the owner |
| `PATCH /api/admin/accounts/:id/reactivate` | ACC-16, ACC-15 | Also clears a login lockout |
| `POST /api/admin/users/:id/reset-password` | ACC-07a | Returns a temporary password once; stored only as a hash |
| `POST /api/admin/moderators` | ACC-13 | Admin only; creates an airline or hotel moderator linked to exactly one provider |

Rules worth knowing before you touch these:

- `PATCH /api/users/me` rejects `email`, `role` and `status` with a 400 rather
  than ignoring them, because the global pipe runs `forbidNonWhitelisted`.
- The preferred currency must be one of the seeded currencies, checked through
  `ReferenceDataService` (GEN-12), not just a well-formed three-letter code.
- An admin can neither act on their own account nor on another admin account.
  Both are ways to lock the platform out of its own administration, and admin
  accounts are seeded (ACC-18), so there is no way back through the API.
- An account its owner deactivated is not reactivated by an admin either,
  because that was the owner's decision.
- The search term in `GET /api/admin/accounts` is escaped before it becomes a
  regular expression, so `(.*)+$` is matched as text instead of being compiled
  as a pattern that could stall the server.
- Deactivation deletes nothing. The status alone hides the account's posts and
  public itineraries and makes its comments and reviews read as "Deleted user",
  so the blog and itinerary modules derive that from one field, and past
  bookings, payments and refunds keep pointing at a real account.
- Suspension and deactivation take effect on the next request without any token
  being revoked, because `JwtAuthGuard` reloads the user from the database every
  time.
- An admin password reset (ACC-07a), a password change (ACC-08) and
  reactivation (ACC-16) all clear an ACC-05 lockout: they set
  `failedLoginAttempts` to 0 and `lockedUntil` to null. Agreed with the Leader
  when ACC-05 landed, because the admin has just replaced the password, so a
  lock earned by the old one is meaningless, and there is otherwise no way to
  clear a lock through the API. `test/admin-accounts.e2e-spec.ts` drives the
  whole flow: five wrong passwords, the 423, the reset, and the temporary
  password logging in straight away.

**Sessions end with the account's password or its status (ACC-06).** Sessions
landed with the Leader's PR 31, so the four places that used to be an open gap
now call `SessionsService.revokeAllSessions(userId, { exceptSessionId })` and
nothing here writes to the `sessions` collection itself:

| Action | Requirement | Sessions ended |
| --- | --- | --- |
| Change your own password | ACC-08 | every one but the caller's, so you stay signed in on the device you changed it on |
| Admin resets a password | ACC-07a | all of them: the old password is gone, so the temporary one is the only way back in |
| Admin suspends an account | ACC-16 | all of them |
| Owner deactivates the account | ACC-12 | all of them, the caller's included |

Two details worth knowing:

- The revoke happens **after** the write it belongs to, so a failed change -
  the wrong current password, or a new password equal to the old one - signs
  nothing out. Otherwise a wrong guess would be a way to disrupt the owner.
- `UsersService` still only writes the users collection. The session half lives
  in `AuthService.changeOwnPassword`, `AdminAccountsService` and
  `AccountsService`, for the same reason `AccountsService` exists at all: the
  service that owns a collection does not reach into another one.

Suspension and deactivation already took effect on the next request, because
the guard reloads the user every time. Revoking matters for what the guard does
not see: a refresh token would otherwise keep rotating, and a session would
come back with the account if an admin reactivated it.

### Creating a moderator (ACC-13)

`POST /api/admin/moderators` is the only route that creates an account rather
than acting on one that exists, and the only one that reaches into a provider
module. Body: `name`, `email`, `role` (`AIRLINE_MODERATOR` or
`HOTEL_MODERATOR`), the provider id that matches the role - `airlineId` or
`hotelId` - and an optional `password`.

- `role` is restricted to the two moderator roles by `@IsIn`, so this route can
  never mint an `ADMIN`. Admins are seeded (ACC-18) and users register
  (ACC-01).
- The provider is named by `airlineId` or `hotelId` rather than one generic
  `providerId`, so the body says which collection the id has to come from. One
  validator in `CreateModeratorDto` holds both halves of the rule: the id that
  matches the role is required, and the one that does not is rejected by name,
  so a body meant for a hotel cannot quietly create an airline moderator. Both
  properties appear in the Swagger schema because Swagger UI cannot hide one
  body property based on another's value; send only the matching one. The
  response still carries `providerId`, because `account.role` already says
  which kind of id it is and a pair with one half always null says less. The
  ports underneath stay generic for the same reason.
- `password` is the temporary password the admin sets. Leave it out and the
  server generates one the same way ACC-07a does. Either way it is in the
  response once and nowhere else; the database holds only a bcrypt hash.
- The account is created with `mustChangePassword: true`, which is what makes
  "must change the password on first login" real: `JwtAuthGuard` answers 403
  `PASSWORD_CHANGE_REQUIRED` to every route but
  `PATCH /api/auth/change-password` while the flag is set.
- The link to the one airline or hotel lives **only** in the provider module's
  assignment collection (schema section 2.2). It is never copied onto the user,
  so there is one place that says which provider a moderator manages.

Two collections in two modules are written, with no transaction across them, so
the order makes a half-done creation either impossible or repairable:

1. the provider is checked first, so a provider id that does not exist (404) or
   is deactivated (400 `PROVIDER_DEACTIVATED`) costs nothing;
2. the account is created, which is where a duplicate email becomes 409;
3. the link is written. If that fails, the account is deleted again before the
   error is rethrown, so the admin can retry with the same email.
   `UsersService.deleteById` exists for this one caller and nothing else:
   accounts are closed by changing their status, never by deleting the row.

**The `ModeratorAssignmentPort`.** Administration does not touch either
assignment collection. `src/common/providers/moderator-assignment.port.ts`
declares the two methods (`assertAssignable`, `assign`) and
`ModeratorAssignmentsGateway` routes a role to the module that owns it, the same
shape as `BookingsPort`. The airline side is wired today by
`AirlineModeratorAssignmentAdapter`, on top of the `AirlinesService` that
`FlightsModule` exports, and the hotel side by `HotelModeratorAssignmentAdapter`,
on top of the `HotelsService` that `HotelsModule` exports. A provider type whose
module is not wired would answer **501 `PROVIDER_TYPE_UNAVAILABLE`** instead of
the app refusing to start.

## Notifications (GEN-01)

`GET /api/notifications` (paginated, `?unreadOnly=true`), `GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read` and `PATCH /api/notifications/read-all`. Every route works on the account in the cookie.

Creating one from your module:

~~~
// your.module.ts
@Module({ imports: [NotificationsModule], providers: [YourService] })

// your.service.ts
await this.notifications.notify({
  userId: booking.userId,
  type: NotificationType.FLIGHT_CANCELLED,
  title: 'Flight cancelled',
  message: 'MS123 on 3 December was cancelled.',
  resourceType: NotificationResourceType.FLIGHT_BOOKING,
  resourceId: booking.id,
});

// One round trip for many users, e.g. every passenger on a cancelled flight:
await this.notifications.notifyMany(passengers.map(toNotification));
~~~

Rules:

- `notify` and `notifyMany` never throw. A missed notice must not be the reason a confirmed payment or a completed refund reports an error, so a failure is logged and the caller carries on. Do not wrap them in `try`/`catch`.
- The `type` values are a closed list (`NotificationType`), so the frontend always knows how to render one. Add a value there rather than inventing a string.
- Marking an already-read notification succeeds and keeps the first read time.
- The list sorts by `createdAt` and then `_id`, both descending, so a batch written in the same millisecond still reads newest first.
- Owner-only access (ACC-11) is in the filter, never a comparison after loading: another account's notification answers the same 404 as one that does not exist. `PATCH /api/notifications/:id/read` does it in **one** conditional update rather than `findOwnedOrThrow` followed by a write - the owner is part of that update's filter, so there is nothing to gain from a second query, and the single update also keeps the first read time when it runs twice. The payment and refund reads use the same filter-based rule; a refund is the one exception, because its owner lives on its payment, so it is checked after the load with the identical 404 either way.

## Booking lifecycle and the BookingsPort (GEN-11)

The five booking states and the only four transitions between them live in `src/common/bookings/booking-status.ts` and are shared by flight bookings and hotel reservations:

~~~
PENDING_PAYMENT -> CONFIRMED -> COMPLETED
PENDING_PAYMENT -> EXPIRED
CONFIRMED       -> CANCELLED
~~~

Anything else, **including a state to itself**, is refused by `assertBookingTransition` with a 409 `INVALID_BOOKING_STATE`. A state to itself is refused on purpose: a caller that can run twice, such as a webhook Stripe retried or the hold-expiry sweep racing a payment, has to notice the work is already done rather than repeat its side effects. A status never comes from request input.

### What flights and hotels have to provide

Payments and account deactivation never read or write a booking collection. They ask the module that owns it through one interface, which is what lets them be built and tested before those collections exist, and keeps the seat and room rules inside the module that owns them.

~~~
// flights.module.ts (A1). hotel-bookings.module.ts is the same with HOTEL_BOOKINGS_PORT.
@Global()
@Module({
  providers: [
    FlightBookingsPortAdapter,
    { provide: FLIGHT_BOOKINGS_PORT, useExisting: FlightBookingsPortAdapter },
  ],
  exports: [FLIGHT_BOOKINGS_PORT],
})
export class FlightsModule {}
~~~

The module that provides a port must be `@Global()`. `BookingsGateway` lives in `BookingsModule` under `src/common/`, which must not import a feature module, and Nest only resolves a provider from a module's own imports or from a global module. Without `@Global()` the gateway's optional port stays empty and that booking type answers 501. `HotelBookingsModule` does this for `HOTEL_BOOKINGS_PORT`.

`BookingsPort` has five methods:

| Method | Used by | Must |
| --- | --- | --- |
| `findPayable(bookingId)` | PAY-01, PAY-02 | Return the booking's owner, status, total, currency and hold expiry, or null. Do not filter by user: the caller checks ownership |
| `findPolicies(bookingId)` | PAY-02 | Return the terms **this booking carries** (its snapshot), not the provider's latest |
| `confirmAfterPayment(bookingId, paymentId)` | PAY-01 | Be idempotent, refuse once the hold has expired, and convert the hold in one atomic step |
| `releaseHold(bookingId, reason)` | PAY-01 | Release once only, however often it is called |
| `hasUpcomingConfirmedBookings(userId)` | ACC-12 | Say whether the account has a confirmed booking that has not happened yet |

Both ports are optional, so the app runs with neither, one or both wired in. A booking type whose module is not connected answers **501 `BOOKING_TYPE_UNAVAILABLE`** with a clear message, rather than the app refusing to start or a 500 that looks like a bug in payments.

Returning the booking's own policy snapshot rather than the provider's current policy is what makes acceptance stable: a provider editing its policy during the 10-minute hold cannot invalidate an acceptance the user has already given, and a later edit never changes what an existing booking agreed to.

## Money (PAY-04)

`src/common/money/money.ts` holds the platform currency and the arithmetic.

- `PLATFORM_CURRENCY` is `USD`. Flight and hotel prices, payments and refunds are always USD and are never converted. A user's preferred currency (ACC-09) applies to itinerary budgets only.
- Amounts are `Decimal128` in the database and **strings** in every response (`"199.99"`). Convert with `decimal128ToString` in the response DTO mapping, not in a schema transform, because lean queries skip document transforms.
- Never use `Number()` on money. `19.99 * 100` as a double is `1998.9999999999998`, so `toMinorUnits` goes through decimal.js and refuses anything that is not a whole number of cents. That is the only place an amount becomes a native number, and only for Stripe.
- `percentageOf(amount, percentage)` is the refund share: rounded half up to the cent and never more than what was captured.
- `HOLD_MINUTES` is 10 (FLT-22, HTL-18).

## Payments, policies and refunds (PAY-01 to PAY-04)

The `payments` module owns `payments`, `refunds`, `policyAcceptances` and `stripeWebhookEvents`. Everything runs in **Stripe test mode**.

| Endpoint | Requirement |
| --- | --- |
| `GET /api/bookings/:type/:id/policies` | PAY-02 |
| `POST /api/bookings/:type/:id/accept-policies` | PAY-02 |
| `POST /api/payments` | PAY-01 |
| `POST /api/payments/:id/retry` | PAY-01 |
| `GET /api/payments/:id` | PAY-01 |
| `POST /api/payments/webhook` | PAY-01 (Stripe calls it; not in Swagger) |
| `GET /api/refunds/:id` | PAY-03 |

`:type` is `flight` or `hotel`, matched case-insensitively.

### Card details never reach this backend

`POST /api/payments` opens a Stripe PaymentIntent and returns its `clientSecret`. The browser sends the card straight to Stripe with Stripe Elements, so no card number, CVC or expiry ever arrives here and none is stored: only the PaymentIntent id, the amount, the currency and the status. The `clientSecret` is not a credential for this API; it only ever lets its holder complete that one PaymentIntent.

The amount comes from the booking, never from the request, so a client cannot choose what to pay.

### Only a verified webhook confirms a booking

A booking becomes `CONFIRMED` in one place: the handler for a Stripe webhook whose signature verified. The browser is never believed, because it can lie, it can be closed before it reports, and it cannot be trusted about money.

The signature is checked against the **raw request bytes**, which is why `main.ts` creates the app with `rawBody: true` and the route binds no body DTO: parsing and re-serialising the JSON would change the bytes and break the signature. An e2e test that drives the webhook must create the app the same way (`moduleFixture.createNestApplication({ rawBody: true })`).

Handling is **exactly once**, not at least once, because Stripe retries until it gets a 2xx and can deliver the same event twice anyway. There are two guards, either of which is enough on its own:

1. inserting a row in `stripeWebhookEvents` keyed by the Stripe event id is how a delivery claims the event, and the unique index turns a second delivery into a no-op;
2. the payment's status is moved with a conditional update, so only one delivery gets past it even if an event row were ever lost.

A handler that throws records the failure and rethrows, so Stripe sees a 5xx and retries, and the stored event is `FAILED` rather than `PROCESSED` so the retry is allowed to claim it again.

### Retrying, and when the hold runs out

A declined card does not finish a PaymentIntent: Stripe puts it back to `requires_payment_method`, so `POST /api/payments/:id/retry` reuses the same intent and client secret with another card, and only opens a new attempt when the old one was really cancelled. A failed attempt deliberately keeps the hold, because PAY-01 lets the user retry until it expires.

The hold is re-checked before any client secret is handed back, including on a retry: once the hold has gone the seats or rooms have been released, so letting the user pay would sell inventory the platform no longer has.

A sweep runs every minute (`PaymentExpiryService`) over the open payments. For each one whose booking is no longer payable it cancels the PaymentIntent at Stripe and then releases the hold. A TTL index cannot do this: two things have to happen together and neither is a deletion, and cancelling at Stripe is what makes a late payment impossible rather than merely ignored. Stripe is called before the status is written, so a crash in between leaves a cancelled PaymentIntent and a payment that still looks open, which is the harmless direction.

### Policies before payment (PAY-02)

Payment is refused with 403 `POLICIES_NOT_ACCEPTED` until the provider's terms have been accepted. `POST .../accept-policies` requires the `policyVersion` the user was shown, so acceptance can only be given for terms that were really displayed; a stale value is 409 `POLICY_VERSION_MISMATCH`. One acceptance per booking per version is enforced by a unique index, which makes a double click idempotent, keeps the first timestamp and turns a race into the same answer for both requests.

### Refunds (PAY-03)

There is no endpoint to create a refund: one only ever follows a cancellation, so letting a client ask for one directly would be a way to get money back without cancelling anything. The flights and hotels modules call the service when they cancel (FLT-06, FLT-26, HTL-21):

~~~
// your.module.ts
@Module({ imports: [PaymentsModule], providers: [YourCancellationService] })

// when the booking is cancelled
await this.refunds.issueForCancellation({
  bookingType: BookingType.HOTEL,
  bookingId,
  cancelledBy: CancelledBy.USER,            // PROVIDER is always refunded in full
  refundPercentage: tier.refundPercentage,  // from your own policy tiers
  reason: 'Cancelled by the traveller 3 days before check-in',
  policySnapshot: policy,                   // the terms the percentage came from
});
~~~

- You work out the tier, because the tiers belong to the provider (FLT-09, HTL-10). A `PROVIDER` cancellation is refunded in full whatever tier you pass.
- A 0% tier and a booking that was never paid both return `null` and issue nothing: PAY-03 covers a cancellation with a positive refund amount.
- A Stripe failure does **not** throw. The cancellation has already happened, so the refund is recorded as `FAILED` with Stripe's message and shows on the booking details, where it can be retried. Do not undo your cancellation because a refund failed.
- The same booking refuses a second refund (409 `REFUND_ALREADY_ISSUED`).

### Environment and running it locally

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are **optional**: without them every other module works normally and only the payment endpoints answer 503 `PAYMENTS_UNAVAILABLE`, so a teammate who is not working on payments does not need a Stripe account. Use test-mode keys only, never a live key.

To demonstrate a payment end to end, forward Stripe's webhooks to the local server and copy the `whsec_` it prints into `.env`:

~~~
stripe listen --forward-to localhost:3000/api/payments/webhook
~~~

Then confirm the PaymentIntent with a test card, using the `clientSecret` from `POST /api/payments`:

~~~
stripe payment_intents confirm pi_xxx --payment-method pm_card_visa
~~~

The booking is confirmed when the webhook arrives, not when the command returns. `POST /api/payments/webhook` is excluded from Swagger on purpose: a request without Stripe's signature can only ever fail, so a "Try it out" button would be misleading.

### Tests

| File | Covers |
| --- | --- |
| `test/auth.e2e-spec.ts` | The guard's four checks and ACC-08 |
| `test/users-profile.e2e-spec.ts` | ACC-09, ACC-11 |
| `test/account-deactivation.e2e-spec.ts` | ACC-12 |
| `test/admin-accounts.e2e-spec.ts` | ACC-07a, ACC-14, ACC-16 |
| `test/admin-moderators.e2e-spec.ts` | ACC-13 |
| `test/notifications.e2e-spec.ts` | GEN-01 |
| `test/booking-policies.e2e-spec.ts` | PAY-02 |
| `test/payments.e2e-spec.ts` | PAY-01, GEN-11 |
| `test/refunds.e2e-spec.ts` | PAY-03 |

The webhook signature verification is tested for real, because it is local crypto: a delivery signed with the right secret confirms the booking, while an unsigned one, one signed with another secret and one whose body was changed after signing are all refused. Stripe's HTTP API and the `BookingsPort` are stood in for, so these suites need no Stripe account and no booking module.

## Image uploads (GEN-08)

`MediaService` (`src/media/`) is the shared upload service. It accepts one JPG or PNG of at most 5 MB (the type is read from the file's first bytes, not its name), allows 5 images per post, activity or hotel and 1 logo per airline, stores the file under `UPLOADS_DIR` and records it in `mediaMetadata`. The owning module checks access and serves the image from its own route.

~~~
@Module({ imports: [MediaModule] })

@Post(':id/images')
@ApiImageUpload('/api/activities/6720f1c2a1b2c3d4e5f60718/images', 'activity')
addImage(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser,
         @UploadedFile() file: UploadedImage | undefined) { ... }

// in the service, after your own owner check
this.media.storeImage({ ownerId: user.userId, targetType: MediaTargetType.ACTIVITY,
  targetId: id, file, urlFor: (imageId) => `/api/activities/${id}/images/${imageId}` });
~~~

Errors: 400 `FILE_REQUIRED`, `INVALID_FILE_TYPE`, `FILE_TOO_LARGE`, `INVALID_UPLOAD`; 409 `IMAGE_LIMIT_REACHED`; 404 `IMAGE_NOT_FOUND`.

## Audit log (GEN-07)

`AuditService` (`src/audit/`) is the only writer of `auditLogs`; admins read it at `GET /api/admin/audit-logs` (filters: `action`, `entityType`, `entityId`, `actorId`, `from`, `to`). Rows cannot be updated or deleted through the model. Suspend, reactivate, password reset, moderator creation and every moderation decision are recorded. Call `record()` after the action succeeds; like `notify()` it never throws.

~~~
await this.audit.record({
  actorId: admin.userId,
  action: AuditAction.PROVIDER_DEACTIVATED,
  entityType: AuditEntityType.HOTEL,
  entityId: hotelId,
  before: { status: 'ACTIVE' },
  after: { status: 'DEACTIVATED' },
});
~~~

In e2e tests, remove your own audit rows with the driver (`connection.collection('auditLogs').deleteMany({ actorId })`).

## Blog (BLG-01 to BLG-10, BLG-12)

`src/blog/` owns `posts`, `comments` and `likes`. Reading is public; only the author can change a post or comment (ACC-11).

| Endpoint | Requirement |
| --- | --- |
| `POST /api/posts`, `PATCH` / `DELETE /api/posts/:id` | BLG-01, BLG-04, BLG-08 |
| `GET /api/posts` (`keyword`, `tag`, `page`) | BLG-02, BLG-09 |
| `GET /api/posts/mine` | BLG-03 |
| `GET /api/posts/:id`, `GET /api/posts/:id/comments` | BLG-02 |
| `POST /api/posts/:id/comments`, `PATCH` / `DELETE /api/comments/:id` | BLG-05, BLG-07 |
| `POST` / `DELETE /api/posts/:id/like` | BLG-06 |
| `POST /api/posts/:id/images`, `GET` / `DELETE /api/posts/:id/images/:imageId` | BLG-10 |
| `GET /api/tags/:tag/posts` | BLG-08 |
| `GET /api/authors/:id` | BLG-12 |

- Drafts and hidden posts are visible only to the author and admins; anyone else gets 404. Posts of a deactivated account are hidden and its comments show "Deleted user".
- A unique `(postId, userId)` index allows one like per user. Like and comment counters change in the same transaction, and search sorts on their sum.
- Tags are stored lower case without duplicates, at most 5 of 30 characters.
- The author page reads public itineraries through `PublicItinerariesService.listByAuthor`.

Tests: `test/blog.e2e-spec.ts`.

## Reports and moderation (GEN-09, GEN-10)

`src/moderation/` owns the `reports` collection. It never reads or writes the reported content itself: each owner implements `ContentModerationPort` (`src/common/moderation/content-moderation.port.ts`), the same pattern as `BookingsPort`.

| Endpoint | Who | Requirement |
| --- | --- | --- |
| `POST /api/reports` | Any logged-in user | GEN-09 |
| `GET /api/admin/reports?status=OPEN&targetType=` | Admin | GEN-09, GEN-10 |
| `PATCH /api/admin/reports/:id` `{ decision: DISMISS \| HIDE \| DELETE }` | Admin | GEN-10 |
| `PATCH /api/admin/content/:type/:id/hide` and `/restore` | Admin | GEN-10 |
| `DELETE /api/admin/content/:type/:id` | Admin | GEN-10 |

`:type` is `post`, `comment`, `review` or `itinerary`, in any letter case.

Rules worth knowing:

- **Once per item** is a unique `(reporterId, targetType, targetId)` index: a second report answers 409 `ALREADY_REPORTED`. You cannot report your own content (400), or content you cannot see (404, so a report cannot probe for drafts). `reason` is a closed list; `OTHER` requires `details`.
- **States** (`applyModeration`, shared by every owner): VISIBLE and HIDDEN switch both ways; either can become DELETED; DELETED is final (409 `INVALID_MODERATION_CHANGE`). The update filters on the state it read, so two admins acting at once get 409 `MODERATION_CONFLICT` instead of overwriting each other. Repeating an action changes nothing and logs nothing.
- **Hidden** content is visible only to its author and admins; **deleted** content only to admins (a soft delete, so the audit trail still points at something). Only VISIBLE content appears in public lists, search, comment counts and hotel ratings.
- **Resolving** with HIDE or DELETE acts on the item and closes every open report on it; acting on an item directly closes them too. Every decision is written to the audit log (GEN-07).
- **Owners**: posts and comments come from `BlogModule`; reviews and itineraries through two small methods each on `ReviewsService` and `PublicItinerariesService` (`findForModeration`, `moderate`). Hiding a review recomputes the hotel rating. A hidden itinerary drops out of public search, the public view, cloning and author pages; a deleted one also disappears for its owner. Itineraries saved before this change have no `moderationState` and count as VISIBLE.

Tests: `test/moderation.e2e-spec.ts`. Manual pass: `docs/api/POSTMAN-D2.md`.

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