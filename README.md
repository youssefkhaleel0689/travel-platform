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
| `BCRYPT_COST` | No | bcrypt cost for password hashes, defaults to 12. Must be a whole number from 4 to 15; any other value (including an empty `BCRYPT_COST=`) stops the app at startup |

`.env` is ignored by Git. **Never commit it**, never paste the connection string into an AI tool, a chat, an issue or a pull request. If the password contains special characters (`@`, `#`, `/`), URL-encode them (`@` becomes `%40`).

### Useful scripts (run inside `backend/`)

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Run in watch mode (needs `.env`) |
| `npm run build` | Compile and catch TypeScript errors |
| `npm run seed` | Build, then load the reference data into MongoDB (needs `.env`) |

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

Rules:

- Use codes and messages the endpoint really returns (read your service and the filter), and the endpoint's real path with an example id.
- When one status can return several codes, give one example per code; Swagger UI shows them in a dropdown named by code. Two examples with the same code in one response are refused.
- `test/swagger-docs.e2e-spec.ts` (part of `npm run test:e2e`; it boots the app, so it needs `MONGODB_URI`) fails for any error response without its own example whose `statusCode` matches the response status. The failure names the endpoint and status, for example `GET /api/airlines/{id} 404: no example (use ApiErrorResponse)`.
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

Shared code: `src/common/` holds code used by several modules. It contains `auth/` (the shared `Role` and `UserStatus` enums; `@Roles`, `@Public` and `@CurrentUser` will be added in PR 2), `dto/` (`ErrorResponseDto`), `filters/` (`AllExceptionsFilter`), `pagination/`, `reference-data/`, `swagger/` (`ApiErrorResponse`), `time/` (airport time zones) and `validation/` (`validationExceptionFactory`); `notifications/` and `uploads/` are planned. Feature modules may import `common/`, but `common/` never imports a feature module, so there are no import cycles.

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
- Swagger: every endpoint has `@ApiTags`, a summary, `@ApiOkResponse` or `@ApiPaginatedResponse`, error responses using `ErrorResponseDto`, and `@ApiCookieAuth` when it is protected.
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

## Accounts and passwords (ACC-01, GEN-13)

A traveller creates an account with `POST /api/auth/register`. Passwords are stored only as bcrypt hashes, and the rules for a new password are shared by every endpoint that sets one.

| Endpoint | Requirement | Access |
| --- | --- | --- |
| `POST /api/auth/register` | ACC-01, GEN-13 | Public |

Request body:

| Field | Rules |
| --- | --- |
| `name` | String, trimmed, not empty, at most 100 characters |
| `email` | Valid email, trimmed and lower-cased, at most 254 characters, not registered yet |
| `password` | The password rules below; used exactly as sent (not trimmed) |
| `acceptTerms` | Must be the boolean `true` (terms and privacy consent); `false`, a missing value or `"true"` fails with `acceptTerms must be true to register` |

~~~
{ "name": "Sara Ahmed", "email": "sara@example.com", "password": "Travel2026", "acceptTerms": true }
~~~

201 response (`UserResponseDto`, never `passwordHash`):

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

The role is always `USER`; it is set by the server, never read from the request. Admins cannot register: admin accounts are only seeded (ACC-18; the admin seed is not written yet), and moderators are created by an admin (ACC-13).

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

`UserProfile` has `id`, `name`, `email`, `phone`, `preferredCurrency`, `role`, `status`, `mustChangePassword` and `createdAt`; it never contains `passwordHash` or the lockout fields.

Rules:

- Never call bcrypt yourself and never store a hash you computed: create users with `UsersService.create()`, which hashes. `PasswordService` is the only file that calls bcrypt.
- Never inject the `User` model outside `src/auth/`; import `AuthModule` and use `UsersService` (see "Module structure and conventions").
- `passwordHash` has `select: false`, so normal queries never load it. Only login (PR 2) will select it explicitly.
- Email uniqueness is guaranteed by the unique index on `users.email`, not by a lookup before the insert, so two parallel registrations with the same email give one 201 and one 409.
- `Role` (`USER`, `ADMIN`, `AIRLINE_MODERATOR`, `HOTEL_MODERATOR`) and `UserStatus` (`ACTIVE`, `SUSPENDED`, `DEACTIVATED`) come from `src/common/auth/auth.enums.ts`. Use them instead of string literals; the flights `ActorRole` type in `airline-actor.ts` should switch to `Role` later.
- `trimText` and `trimLower` for `@Transform` are in `src/common/validation/text-transforms.ts`. Import them from there, not from another module's DTO files.
- Not available yet: login, cookies, guards and `/auth/me` come in PR 2 (ACC-04, ACC-19). Until then, protected endpoints keep their placeholders (for example the placeholder admin in `airline-actor.ts`).
- `test/auth-register.e2e-spec.ts` registers real users in the database from `MONGODB_URI`. Every email starts with a prefix unique to the run (`e2e-register-<timestamp>-`), and the test deletes those users when it finishes.

The endpoint, `UsersService`, `PasswordService` and the `User` schema are in `src/auth/`; the enums are in `src/common/auth/`, and the password rules and text transforms in `src/common/validation/`.

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