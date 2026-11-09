# Manual API testing with Postman (C2 endpoints)

How to exercise the account, notification and payment endpoints by hand:
ACC-07a, ACC-08, ACC-09, ACC-11, ACC-12, ACC-14, ACC-16, GEN-01, GEN-11 and
PAY-01 to PAY-04.

Swagger UI at `http://localhost:3000/api/docs` is what Milestone 1 is graded
through and is enough for a quick look. Postman is better for a repeatable
pass: it keeps the cookie for you, remembers ids between requests, and the
collection carries an assertion per rule so a run either goes green or tells
you what changed.

Files in this folder:

| File | What it is |
| --- | --- |
| `postman/travel-platform-c2.postman_collection.json` | 58 requests in 10 folders, each with assertions |
| `postman/travel-platform-local.postman_environment.json` | The variables, pointing at `localhost:3000` |

## 1. Set up

~~~
cd backend
npm install
npm run seed
~~~

`npm run seed` loads the reference data; folder 00 asserts the 7 seeded
currencies, so without it the first request fails.

Your `backend/.env` needs `MONGODB_URI` and `JWT_ACCESS_SECRET`. Leave
`NODE_ENV` as `development`: in production the auth cookies are marked
`Secure`, and Postman will not store a `Secure` cookie sent over plain
`http://`.

~~~
npm run start:dev
~~~

Then in Postman: **Import** both JSON files, and pick
*Travel Platform - local* in the environment dropdown, top right.

## 2. How signing in works

The API never puts a token in a response body (ACC-19). It sets two httpOnly
cookies, `access_token` and `refresh_token`. Postman has a cookie jar, so it
stores them from the sign-in response and sends them automatically on every
later request to the same host. **You never copy a token by hand.**

Each folder that needs a particular role starts with its own sign-in request,
so you can run a folder on its own.

One thing to remember: the jar holds **one** cookie per name per host, so
signing in as the admin replaces the user's cookie. After folder 50, sign in
again as the test user before going back to folders 20 to 40.

To start from nothing, clear the jar: the **Cookies** link under the Send
button, then delete the `localhost` entries.

### Blocked on ACC-04

`POST /api/auth/login` is foundation work and is not merged yet. Until it is,
the sign-in requests answer 404 (the collection marks them skipped) and every
folder from 20 onwards answers 401.

`AuthenticatedGuard` runs **before** the validation pipe, so even the
deliberately invalid requests in folders 70 and 80 answer 401 rather than 400
until you can sign in. A red run today is the guard working, not a broken
collection.

The sign-in bodies are written against ACC-01 and ACC-04 as the requirements
describe them:

~~~
POST /api/auth/login
{ "email": "test_c2_user@example.com", "password": "ManualTest123" }
~~~

If the merged DTO uses different field names, fix them in the sign-in requests
only — nothing else in the collection depends on them.

### What works today, with no sign-in at all

Verified against a running server:

| Request | Expected |
| --- | --- |
| `00/01 GET /currencies` | 200, a page of 10 with 7 total |
| `00/02 GET /currencies?limit=50` | 400 `VALIDATION_FAILED` on `limit` |
| `10/01 GET /users/me`, no cookie | 401 `UNAUTHORIZED` |
| `10/02 GET /users/me`, bad cookie | 401 `INVALID_TOKEN` |
| `80/06 POST /payments/webhook`, no signature | 400 `MISSING_WEBHOOK_SIGNATURE` |
| `80/07 POST /payments/webhook`, forged signature | 401 `INVALID_WEBHOOK_SIGNATURE` |
| `90/03 POST /refunds` | 404 `Route not found` — no such route, by design |

That is 7 requests and 12 assertions. The two webhook ones are the most
worthwhile to show anybody: they prove that a body claiming a payment
succeeded is refused unless Stripe signed it.

## 3. The accounts you need

| Variable | How to get the account |
| --- | --- |
| `userEmail` / `userPassword` | Register it: `POST /api/auth/register` (ACC-01) |
| `throwawayEmail` / `throwawayPassword` | Register a second one, only for folder 60 |
| `adminEmail` / `adminPassword` | From the **admin seed** (ACC-18) |

Admins cannot self-register, so there is no way to make one through the API.
ACC-18 seeds them and is owned by B1; until that seed exists, folder 50 cannot
be run and its sign-in request skips itself.

Keep the `test_c2_` prefix on every address. The shared-database rules require
test data to be prefixed, and it makes your rows easy to find and delete.

## 4. The protocol

Run the folders in order. Each row says what the folder proves.

| Folder | Requirement | What to look for |
| --- | --- | --- |
| 00 Public reference data | GEN-05, GEN-12 | A public route needs no cookie; `limit` is rejected because the page size is fixed at 10 |
| 10 Auth guard | ACC-06, ACC-19 | No cookie, a malformed token and a revoked session each give a different code |
| 20 Own profile | ACC-09, ACC-11 | Values are normalised; `null` clears a field; `email`, `role` and `status` are refused outright; no credential field is ever returned |
| 30 Change password | ACC-08 | The current password is required; the rules are enforced; the caller stays signed in while other sessions do not |
| 40 Notifications | GEN-01 | Pages of 10, the unread filter, marking read twice is harmless, another account's notification is a 404 |
| 50 Admin accounts | ACC-07a, ACC-14, ACC-16 | Role enforcement, search and filters, a regex matched literally, suspension revoking sessions, the self and admin refusals, a one-time temporary password |
| 60 Account deactivation | ACC-12 | `confirm: true` is required; the row survives with a date; the cookie dies |
| 70 Policies | PAY-02 | The booking's own terms and the version the user must echo back |
| 80 Payments | PAY-01 | The amount is never taken from the client; the webhook refuses anything Stripe did not sign |
| 90 Refunds | PAY-03 | A refund can be read but never created through the API |

### Things worth doing by hand, which the folders only hint at

- **Re-send a request twice.** `PATCH /notifications/:id/read`, the suspend
  route and `POST .../accept-policies` are all meant to be safe to repeat. The
  second call should succeed and change nothing.
- **See a real notification.** Have the admin suspend your test account
  (50/06) and reactivate it (50/07), then sign in as that account and run
  folder 40. The suspension leaves an `ACCOUNT_SUSPENDED` notification.
- **See the temporary-password lockout.** Run 50/10, then sign in as that
  account and call `GET /users/me`: 403 `PASSWORD_CHANGE_REQUIRED`. Only
  `PATCH /api/auth/change-password` works until it sets its own password.
- **Watch a password change end other sessions.** Sign in twice (two
  browsers, or Postman plus Swagger), change the password in one, and the other
  cookie stops working while yours keeps going.

## 5. What needs a booking module

Folders 70 to 90 reach bookings through `BookingsPort`, which neither the
flights nor the hotels module provides yet. Once you can sign in, they answer:

~~~
501  { "code": "BOOKING_TYPE_UNAVAILABLE",
       "message": "HOTEL bookings are not available yet: the module that owns
                   them has not been connected to payments" }
~~~

That is deliberate — a clear 501 rather than a 500 that looks like a bug in
payments. The collection asserts the 501 so a run stays green; each request's
description says what to change when A1 or B2 wires its port in.

## 6. Driving the webhook for real

Postman cannot produce a valid Stripe signature, so the two webhook requests
only cover the refusals. For the success path, use the Stripe CLI with
test-mode keys:

~~~
stripe listen --forward-to localhost:3000/api/payments/webhook
~~~

Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET` in `backend/.env`
and restart the server. Then, with the `clientSecret` from `POST /api/payments`:

~~~
stripe payment_intents confirm pi_xxx --payment-method pm_card_visa
~~~

The booking is confirmed when the webhook arrives, not when that command
returns. `POST /api/payments/webhook` is deliberately excluded from Swagger: a
request without Stripe's signature can only fail, so a "Try it out" button
would mislead.

## 7. Running the whole collection at once

The Collection Runner (or `newman`, which needs no Postman account) runs every
folder and reports each assertion:

~~~
npx newman run docs/api/postman/travel-platform-c2.postman_collection.json --env-var baseUrl=http://localhost:3000/api
~~~

Pass the accounts in as variables to avoid editing the file:

~~~
npx newman run docs/api/postman/travel-platform-c2.postman_collection.json --env-var baseUrl=http://localhost:3000/api --env-var userEmail=test_c2_user@example.com --env-var userPassword=ManualTest123
~~~

Run a single folder with `--folder "00 Public reference data (no sign-in)"`.

## 8. Troubleshooting

| What you see | Why |
| --- | --- |
| `401 UNAUTHORIZED` everywhere | Not signed in. Today that is expected: ACC-04 is not merged |
| Sign-in answers `404` | `POST /api/auth/login` does not exist yet |
| Sign-in answers 200 but the next request is 401 | Postman did not keep the cookie. Check `NODE_ENV` is not `production`, since a `Secure` cookie is not stored over `http://` |
| `401 SESSION_EXPIRED` after it worked | The session was revoked (logout, a password change, a suspension, an admin password reset) or idle for 30 minutes. Sign in again |
| `403 FORBIDDEN_ROLE` | A `USER` cookie on an admin route. Sign in as the admin |
| `403 PASSWORD_CHANGE_REQUIRED` | The account is on a temporary password. Call `PATCH /api/auth/change-password` first |
| `403 ACCOUNT_SUSPENDED` / `ACCOUNT_DEACTIVATED` | Exactly what it says; a deactivated account cannot be brought back by an admin |
| `501 BOOKING_TYPE_UNAVAILABLE` | No booking module is wired in. Expected until A1 or B2 lands |
| `503 PAYMENTS_UNAVAILABLE` | `STRIPE_SECRET_KEY` is not set. Expected unless you are working on payments |
| `400` on `role`, `email` or `amount` | Correct: the global pipe runs `forbidNonWhitelisted`, so an unknown field is refused rather than ignored |
| `404` where you expected `403` | Correct: another account's row is indistinguishable from one that does not exist, so ids cannot be probed (ACC-11) |
| Folder 00 says 7 currencies but got 0 | `npm run seed` has not been run |
| `Configuration key "JWT_ACCESS_SECRET" does not exist` | Copy `backend/.env.example` to `.env` and fill it in |

## 9. Cleaning up after yourself

Everything you create is on the **shared** Atlas database. Accounts named
`test_c2_*` are yours; delete them when you are done, along with their
sessions and notifications. Never drop a collection, and never delete a row
you did not create.
