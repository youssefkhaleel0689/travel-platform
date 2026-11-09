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
| `MONGODB_URI` | Yes | Shared MongoDB Atlas connection string, including the database name |
| `JWT_ACCESS_SECRET` | Yes | Signing secret for the access-token cookie (ACC-19). Generate your own: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The app refuses to start without it, because a default would let anyone forge a token |
| `PORT` | No | Server port, defaults to 3000 |
| `NODE_ENV` | No | Set to `production` only when deployed; it makes the auth cookies `Secure`, which a browser will not send over plain `http://localhost` |
| `STRIPE_SECRET_KEY` | No | Stripe **test mode** secret key (`sk_test_...`). Without it the payment endpoints answer 503 and everything else works, so only the people demonstrating payments need one |
| `STRIPE_WEBHOOK_SECRET` | No | The `whsec_...` printed by `stripe listen`. Without it every webhook delivery is rejected, because an unverified event is never trusted |

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
| `Configuration key "JWT_ACCESS_SECRET" does not exist` | The same, for the auth secret. Copy the new `.env.example` and fill it in |
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

Shared code: `src/common/` holds code used by several modules. It contains `bookings/` (the GEN-11 lifecycle and `BookingsPort`), `dto/` (`ErrorResponseDto`), `filters/` (`AllExceptionsFilter`), `money/` (the platform currency and the Stripe conversion), `pagination/`, `reference-data/` and `validation/` (`validationExceptionFactory`); `uploads/` is planned. Feature modules may import `common/`, but `common/` never imports a feature module, so there are no import cycles.

Notifications were planned for `src/common/notifications/` but live in the feature module `src/notifications/` instead: GEN-01 has three endpoints, those endpoints need `AuthenticatedGuard`, and `common/` must not import a feature module. Other modules use it the normal way, through its exported `NotificationsService`.

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
- Time: store dates in UTC and return ISO 8601; each airport has an IANA `timeZone` (`CAI` is `Africa/Cairo`).
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

## Authentication and access control (ACC-05 to ACC-12, ACC-19)

The `auth` module owns the `users` and `sessions` collections and the access control every other module uses.

Tokens never reach JavaScript (ACC-19). Login issues two httpOnly, SameSite cookies, Secure outside development:

| Cookie | Lifetime | Contents |
| --- | --- | --- |
| `access_token` | 15 minutes | A JWT with the user id, the session id and the role |
| `refresh_token` | 7 days | 32 random bytes; only its SHA-256 hash is stored |

Nothing about a password or a token is stored in readable form: passwords are bcrypt hashes at 12 rounds (which embed their own salt), and the refresh token is only ever compared against its hash, so a database leak cannot be replayed as a login. SHA-256 is enough for the refresh token, unlike for a password, because the token is 256 bits of randomness with nothing to guess.

### Using the guards in your module

~~~
// your.module.ts
@Module({ imports: [AuthModule], controllers: [YourController] })
export class YourModule {}

// your.controller.ts
@UseGuards(AuthenticatedGuard, RolesGuard)   // this order: the first fills in the user
@Roles(Role.ADMIN)                           // omit for "any signed-in account"
@Controller('things')
export class YourController {
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.things.listFor(user.id);     // never take an id from the client
  }
}
~~~

`AuthenticatedGuard` runs four checks on every request, because each one can invalidate a token that is still cryptographically valid:

1. the JWT verifies and has not expired;
2. the session exists, is not revoked and has been active in the last 30 minutes, and the same atomic update records this request as activity, so the window slides with real use (ACC-06);
3. the account still exists and its status is `ACTIVE`, so a suspension (ACC-16) or a deactivation (ACC-12) takes effect at once rather than when the token expires;
4. the account is not sitting on a temporary password (ACC-07a).

The role is read from the database, never from the token, so an account that loses a role cannot keep using an old cookie. `@CurrentUser()` throws a 500 if the route has no `AuthenticatedGuard`, rather than handing the controller `undefined`, which would look like a missing user and skip an ownership check.

| Error code | Status | When |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | No cookie at all |
| `INVALID_TOKEN` | 401 | Expired or tampered-with token |
| `SESSION_EXPIRED` | 401 | Logged out, revoked, or 30 minutes idle |
| `ACCOUNT_SUSPENDED` | 403 | An admin suspended the account |
| `ACCOUNT_DEACTIVATED` | 403 | The owner deactivated the account |
| `PASSWORD_CHANGE_REQUIRED` | 403 | A temporary password has not been replaced |
| `FORBIDDEN_ROLE` | 403 | `@Roles` does not include the account's role |

Mark the one route an account on a temporary password may reach with `@AllowPasswordChangePending()`; `PATCH /api/auth/change-password` has it.

### Ownership

An owner-only route reads the id from the cookie and never from the path or the body, so there is nothing to tamper with. Where an id has to be in the path (`/api/payments/:id`, `/api/refunds/:id`, `/api/notifications/:id/read`), another account's row answers **404**, exactly like one that does not exist, so ids cannot be probed for which are real. ACC-11 allows 403 or 404; the whole API uses 404 for this.

### Account endpoints

| Endpoint | Requirement | Notes |
| --- | --- | --- |
| `PATCH /api/auth/change-password` | ACC-08 | Needs the current password; revokes the account's other sessions and keeps this one |
| `GET /api/users/me` | ACC-11 | No credential or lockout field is ever returned |
| `PATCH /api/users/me` | ACC-09 | Name, phone, preferred currency; `null` clears the last two |
| `DELETE /api/users/me` | ACC-12 | Needs `confirm: true`; blocked while an upcoming confirmed booking exists |
| `GET /api/admin/accounts` | ACC-14 | Admin only; search by name or email, filter by role and status |
| `PATCH /api/admin/accounts/:id/suspend` | ACC-16, ACC-15 | Ends the account's sessions, keeps its bookings, notifies the owner |
| `PATCH /api/admin/accounts/:id/reactivate` | ACC-16, ACC-15 | Also clears a login lockout |
| `POST /api/admin/users/:id/reset-password` | ACC-07a | Returns a temporary password once; stored only as a hash |

`PATCH /api/users/me` rejects `email`, `role` and `status` with a 400 rather than ignoring them, because the global pipe runs `forbidNonWhitelisted`. An admin can neither act on their own account nor on another admin account: both are ways to lock the platform out of its own administration, and admin accounts are seeded (ACC-18). An account its owner deactivated is not reactivated by an admin either, because that was the owner's decision.

The search term in `GET /api/admin/accounts` is escaped before it becomes a regular expression, so `(.*)+$` is matched as text instead of being compiled as a pattern that could stall the server.

**Registration, login, logout and `/auth/me` (ACC-01, ACC-04, ACC-06) are not in this module yet.** The services they need are exported and ready: `UsersService.create`, `findByEmailWithPassword`, `isLockedOut`, `registerFailedLogin` (atomic `$inc`, 15-minute lock on the fifth failure), `registerSuccessfulLogin`, `SessionsService.create` and `AuthCookiesService.setAuthCookies`. Until the login endpoint exists, an e2e test signs an account in with `test/support/auth-test-helper.ts`, which builds exactly the state login will, so only that one file changes when ACC-04 lands.

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
// flights.module.ts (A1). hotels.module.ts (B2) is the same with HOTEL_BOOKINGS_PORT.
@Module({
  providers: [
    FlightBookingsPortAdapter,
    { provide: FLIGHT_BOOKINGS_PORT, useExisting: FlightBookingsPortAdapter },
  ],
  exports: [FLIGHT_BOOKINGS_PORT],
})
export class FlightsModule {}
~~~

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
| `test/notifications.e2e-spec.ts` | GEN-01 |
| `test/booking-policies.e2e-spec.ts` | PAY-02 |
| `test/payments.e2e-spec.ts` | PAY-01, GEN-11 |
| `test/refunds.e2e-spec.ts` | PAY-03 |

The webhook signature verification is tested for real, because it is local crypto: a delivery signed with the right secret confirms the booking, while an unsigned one, one signed with another secret and one whose body was changed after signing are all refused. Stripe's HTTP API and the `BookingsPort` are stood in for, so these suites need no Stripe account and no booking module.

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