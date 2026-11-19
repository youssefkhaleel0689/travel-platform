# Manual API testing with Postman (C2 endpoints)

How to exercise the account, notification and payment endpoints by hand:
ACC-07a, ACC-08, ACC-09, ACC-11, ACC-12, ACC-14, ACC-16, ACC-17, GEN-01,
GEN-11 and PAY-01 to PAY-04.

Swagger UI at `http://localhost:3000/api/docs` is what Milestone 1 is graded
through and is enough for a quick look. Postman is better for a repeatable
pass: it keeps the cookie for you, remembers ids between requests, and the
collection carries an assertion per rule so a run either goes green or tells
you what changed.

Files in this folder:

| File | What it is |
| --- | --- |
| `postman/travel-platform-c2.postman_collection.json` | 91 requests in 12 folders, 210 assertions |
| `postman/travel-platform-local.postman_environment.json` | The variables, pointing at `localhost:3000` |

## 1. Set up

~~~
cd backend
npm install
npm run seed
~~~

`npm run seed` loads the reference data; folder 00 asserts the 7 seeded
currencies, so without it the first request fails.

Your `backend/.env` needs `MONGODB_URI` and `JWT_SECRET`. Leave
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

### What you need before the first run

~~~
cd backend
npm run seed
~~~

~~~
cd backend
npm run seed:admin
~~~

The first loads the reference data, which folder 00 checks. The second creates
the ADMIN account folder 50 needs: admins cannot self-register (ACC-18), so the
seed is the only way to get one. It reads `ADMIN_EMAIL` and `ADMIN_PASSWORD`
from `backend/.env`.

Then start the server and import both JSON files:

~~~
cd backend
npm run start:dev
~~~

### One answer for every authentication failure

The guard replies `401 UNAUTHENTICATED` to all of these: no cookie, a malformed
token, an expired one, an unknown user, and an account that is suspended or
deactivated. That is deliberate, so a response never reveals which. The
exceptions are the two it can safely be specific about:

| Code | Status | When |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | Any authentication failure, including a non-active account |
| `FORBIDDEN` | 403 | Logged in, but the role is not allowed (ACC-11) |
| `PASSWORD_CHANGE_REQUIRED` | 403 | The account is on a temporary password (ACC-07a) |

`ACCOUNT_SUSPENDED` and `ACCOUNT_DEACTIVATED` (403) come from **login** only,
where naming the reason is useful and safe.

## 3. The accounts you need

| Variable | How the collection gets it |
| --- | --- |
| `userEmail` / `userPassword` | Folder 20 request 01 registers it for you |
| `targetEmail` / `targetPassword` | Folder 50 request 01 registers it, on a **generated** address; the folder suspends and resets this one, never your test user |
| `throwawayEmail` / `throwawayPassword` | Folder 60 request 01 registers it, on a **generated** address; the folder deactivates it for good |
| `bookingsUserEmail` / `bookingsUserPassword` | Folder 65 request 01 registers it, on a **generated** address; it only proves a traveller cannot read the admin booking list |
| `adminEmail` / `adminPassword` | Copy them from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env` after `npm run seed:admin` |

Keep the `test_c2_` prefix on every address: the shared-database rules require
test data to be prefixed, and it makes your rows easy to find and delete.

`targetEmail`, `throwawayEmail`, `bookingsUserEmail` and the two moderator
addresses are generated per run, so folders 50, 55, 60 and 65 need no editing
between runs. They have to
be: folder 50 leaves its target on a temporary password and folder 60
deactivates its account permanently, so a fixed address makes each folder work
exactly once. With a fixed one, folder 60 then fails outright with
`409 EMAIL_ALREADY_REGISTERED`, and folder 50 - which tolerates the 409 -
quietly skipped its suspend, reactivate and reset requests and still reported
green. That is why they generate.

The cost is one extra `test_c2_` row per run on the shared cluster, which
section 9 tells you how to sweep.

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
| 55 Create a moderator | ACC-13 | An account linked to exactly one airline, on a temporary password it cannot use for anything else until it replaces it; the body names the provider by role (`airlineId` or `hotelId`) and refuses the other one; the route cannot mint an ADMIN; hotel moderators answer 501 until HTL-01 |
| 60 Account deactivation | ACC-12 | `confirm: true` is required; the row survives with a date; the cookie dies |
| 65 Admin bookings | ACC-17 | One list over both booking collections: the row shape (reference, user, provider, dates, amount, status), the type, status, day-range and reference filters, and a traveller refused with 403 |
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
  Folder 55 drives the same thing end to end for a moderator (requests 13 to
  16), which is the case the requirement actually names.
- **Check that a failed moderator creation leaves nothing behind.** Run folder
  55 request 06 (a 404 for an airline that does not exist), then request 03
  again with that same email in `moderatorEmail`. It succeeds, which it could
  not do if a half-made account were holding the address.
- **Look at the link itself.** After folder 55 request 03, open the
  `airlineModeratorAssignment` collection in Atlas: there is exactly one
  document for that `moderatorId`, and the moderator's own `users` row says
  nothing about which airline it manages. That is deliberate (schema section
  2.2): one place holds the link.
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

### Folder 65 and the optional port method

The admin list is the one C2 endpoint whose rows come from somebody else's
collections: flight bookings (A1) and hotel reservations (B2), read through
`BookingsPort` and merged into one page, newest first.

`listForAdmin` is **optional** on that port, and neither shipped adapter
implements it yet, so **today every request in folder 65 returns an empty
page** - and that is what the folder asserts. The route still answers `200`
with the GEN-05 `meta`, never a 501: a module that cannot list yet has no
bookings to report, and an admin list must not break because a module is still
being built.

Rows appear as soon as A1 or B2 implements `listForAdmin` (the contract is in
the README under "Booking lifecycle and the BookingsPort"). The folder is
written for that day too: its shape and filter assertions run over whatever
rows come back, so nothing in it needs changing then - only the "empty today"
assertion in request 05 will start failing, and that is the signal to delete
it. The rows this folder reads are never changed by it: ACC-17 is read-only,
and a booking is cancelled through the module that owns it.

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

A clean full run is **77 requests, 174 assertions, 0 failures** and exits 0.
One assertion skips itself and says so: folder 40 request 06 needs a
notification to mark as read, and the test user has none until an admin
suspends it in folder 50, which runs later. Marking one read is covered by
`test/notifications.e2e-spec.ts` and by shots 10 and 11 in
`docs/api/evidence/`. Any other skip means a variable was not set, which is a
defect rather than a design choice - that is what the generated addresses
above fixed.

## 8. Troubleshooting

| What you see | Why |
| --- | --- |
| `401 UNAUTHENTICATED` everywhere | Not signed in, or the cookie was not kept. Run the folder’s own sign-in request first |
| Sign-in answers 200 but the next request is 401 | Postman did not keep the cookie. Check `NODE_ENV` is not `production`, since a `Secure` cookie is not stored over `http://` |
| `401 UNAUTHENTICATED` after it worked | The account was suspended, deactivated, or had its password reset by an admin. The guard reloads the user every request, so it applies at once |
| `403 FORBIDDEN` | A `USER` cookie on an admin route. Sign in as the seeded admin |
| `403 PASSWORD_CHANGE_REQUIRED` | The account is on a temporary password. Call `PATCH /api/auth/change-password` first |
| `403 ACCOUNT_SUSPENDED` / `ACCOUNT_DEACTIVATED` on login | Exactly what it says; a deactivated account cannot be brought back by an admin |
| `501 BOOKING_TYPE_UNAVAILABLE` | No booking module is wired in. Expected until A1 or B2 lands |
| `501 PROVIDER_TYPE_UNAVAILABLE` | Folder 55 asked for a `HOTEL_MODERATOR`. Expected until the hotels module lands (HTL-01) |
| `409` on folder 55 request 02 | The random two-character IATA code was already taken. Send the request again |
| `400` on `providerId` | Correct since the role-specific body landed: name the provider with `airlineId` or `hotelId` instead, matching `role` |
| `503 PAYMENTS_UNAVAILABLE` | `STRIPE_SECRET_KEY` is not set. Expected unless you are working on payments |
| `400` on `role`, `email` or `amount` | Correct: the global pipe runs `forbidNonWhitelisted`, so an unknown field is refused rather than ignored |
| `404` where you expected `403` | Correct: another account's row is indistinguishable from one that does not exist, so ids cannot be probed (ACC-11) |
| Folder 00 says 7 currencies but got 0 | `npm run seed` has not been run |
| `JWT_SECRET is required` | Copy `backend/.env.example` to `.env` and generate one (see the README) |

## 9. Cleaning up after yourself

Everything you create is on the **shared** Atlas database. Accounts named
`test_c2_*` are yours; delete them when you are done, along with their
sessions and notifications. Never drop a collection, and never delete a row
you did not create.

Folder 55 creates three things that are easy to forget, because two of them
are outside the `users` collection:

- the two moderator accounts (`test_c2_mod_*` and `test_c2_mod2_*`);
- their rows in `airlineModeratorAssignment`, matched on `moderatorId`;
- the airline it made, named `test_c2_acc13 Airline`. Delete the assignment
  rows first, then the airline, then the accounts. The airline holds a
  two-character IATA code, and the pool is small, so leaving it behind makes
  the next run collide more often.

Folder 65 creates one plain account (`test_c2_acc17_*`) and nothing else: it
only reads bookings, so it leaves no bookings, airlines or hotels behind.

**Keep the seeded admin.** `ADMIN_EMAIL` in `backend/.env` is itself a
`test_c2_*` address, so a sweep of "every `test_c2_` account" takes the admin
with it and the next run dies on request 01 with `INVALID_CREDENTIALS` instead
of signing in. Either leave that one account alone, or run
`npm run seed:admin` again afterwards - it is idempotent.
