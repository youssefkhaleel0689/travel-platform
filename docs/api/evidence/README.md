# Swagger UI evidence — C2 (accounts, notifications, payments)

Screenshots of every endpoint C2 owns, taken in Swagger UI at
`http://localhost:3000/api/docs` against the shared MongoDB Atlas cluster.
Each one shows the endpoint, the request body or parameters, the **Request
URL**, the response **code** and the response **body**.

This folder grows over time. Endpoints that depend on a module nobody has
merged yet are listed under ["Waiting on another module"](#waiting-on-another-module);
their screenshots are added here once that module lands and the integration is
tested locally.

`CAPTURE-RUN.md` is the run that produced these, in the order that works: each
step only needs state an earlier step created, and the sign-ins are grouped so
the session cookie is never replaced mid-group. Following it by hand gives the
same shots; this set was taken by driving the same page in Chrome, so the run
can be repeated exactly when an endpoint changes. Every request is a real one
against the running server - the responses are whatever the API actually
returned. Re-capturing overwrites the same filename, so this folder never holds
two versions of one shot.

## What is here

16 screenshots covering the 12 endpoints that work end to end today.

| Requirement | Endpoint | Shows | File |
| --- | --- | --- | --- |
| ACC-14 | `GET /api/admin/accounts` | `200` + the page of accounts | `01_ACC-14_list-accounts_200.png` |
| ACC-16 | `PATCH /api/admin/accounts/{id}/suspend` | `200`, `status: SUSPENDED` | `02_ACC-16_suspend_200.png` |
| ACC-16 | `PATCH /api/admin/accounts/{id}/reactivate` | `200`, `status: ACTIVE` | `03_ACC-16_reactivate_200.png` |
| ACC-07a | `POST /api/admin/users/{id}/reset-password` | `200` + the one-time temporary password | `04_ACC-07a_reset-password_200.png` |
| ACC-13 | `POST /api/admin/moderators` | `201` + the account, its provider and its temporary password | `05_ACC-13_create-moderator_201.png` |
| ACC-07a | any route, on a temporary password | `403 PASSWORD_CHANGE_REQUIRED` | `06_ACC-07a_password-change-required_403.png` |
| ACC-08 | `PATCH /api/auth/change-password` | `200`, and the lockout above is over | `07_ACC-08_change-password_200.png` |
| GEN-01 | `GET /api/notifications/unread-count` | `200`, `unreadCount: 2` | `08_GEN-01_unread-count_200_two-unread.png` |
| GEN-01 | `GET /api/notifications` | `200`, a page of 10, newest first | `09_GEN-01_list-notifications_200.png` |
| GEN-01 | `PATCH /api/notifications/{id}/read` | `204` | `10_GEN-01_mark-one-read_204.png` |
| GEN-01 | `GET /api/notifications/unread-count` | `200`, `unreadCount: 1` — the 204 above did something | `11_GEN-01_unread-count_200_one-unread.png` |
| GEN-01 | `PATCH /api/notifications/read-all` | `204` | `12_GEN-01_mark-all-read_204.png` |
| GEN-01 | `GET /api/notifications/unread-count` | `200`, `unreadCount: 0` | `13_GEN-01_unread-count_200_none-unread.png` |
| ACC-09 | `PATCH /api/users/me` | `200`, name, phone and currency changed | `14_ACC-09_update-profile_200.png` |
| ACC-12 | `DELETE /api/users/me` | `200`, `deactivatedAt` set and nothing deleted | `15_ACC-12_deactivate_200.png` |
| ACC-12 | `GET /api/users/me` after it | `401` — the cookie died with the account | `16_ACC-12_cookie-revoked_401.png` |

## ACC-07a — admin resets an account to a temporary password

The password is shown once and stored only as a bcrypt hash. The account then
owes a password change and can reach nothing else until it sets its own.

![Admin resets an account's password](04_ACC-07a_reset-password_200.png)

![Every route answers 403 PASSWORD_CHANGE_REQUIRED](06_ACC-07a_password-change-required_403.png)

## ACC-08 — change your own password

The current password is required, and the new one goes through the shared
password rules. This is also the way out of the 403 above.

![Changing the password](07_ACC-08_change-password_200.png)

## ACC-09 — edit your own profile

Name, phone and preferred currency. The currency must be one of the seeded
ones; `email`, `role` and `status` are refused as unknown fields.

![Editing the profile](14_ACC-09_update-profile_200.png)

## ACC-12 — deactivate your own account

Needs `confirm: true` in the body. Nothing is deleted: the row keeps a
deactivation date, and the session stops working at once because the guard
reloads the account on every request.

![Deactivating the account](15_ACC-12_deactivate_200.png)

![The cookie no longer authenticates](16_ACC-12_cookie-revoked_401.png)

## ACC-13 — admin creates a provider moderator

The account is created and linked to exactly one airline, with a temporary
password it must replace at first login. The provider is named by role:
`airlineId` for an `AIRLINE_MODERATOR`.

![Creating an airline moderator](05_ACC-13_create-moderator_201.png)

## ACC-14 — list every account

Paginated, searchable and filterable by role and status.

![Listing accounts](01_ACC-14_list-accounts_200.png)

## ACC-16 — suspend and reactivate an account

Suspending notifies the owner (ACC-15) and stops its session working;
reactivating puts the status back. Bookings are untouched.

![Suspending an account](02_ACC-16_suspend_200.png)

![Reactivating it](03_ACC-16_reactivate_200.png)

## GEN-01 — in-app notifications

Two notices came from the suspensions above. The two `PATCH` routes answer
`204` with an empty body by design, so the proof that they worked is the unread
count before and after: 2, then 1, then 0.

![Two unread](08_GEN-01_unread-count_200_two-unread.png)

![The notifications themselves](09_GEN-01_list-notifications_200.png)

![Marking one read](10_GEN-01_mark-one-read_204.png)

![One unread left](11_GEN-01_unread-count_200_one-unread.png)

![Marking the rest read](12_GEN-01_mark-all-read_204.png)

![None unread](13_GEN-01_unread-count_200_none-unread.png)

## Waiting on another module

These seven are implemented and unit- and e2e-tested, but no module provides
`BookingsPort` yet, so there is no booking for them to act on. Today they
answer a documented `501 BOOKING_TYPE_UNAVAILABLE` or `404` rather than a
`500`, which is deliberate. Screenshots go here once a booking module is
merged and integration is tested locally.

| Requirement | Endpoint | Answers today | Waiting on |
| --- | --- | --- | --- |
| PAY-02 | `GET /api/bookings/{type}/{id}/policies` | `501 BOOKING_TYPE_UNAVAILABLE` | a `BookingsPort` from flights (A1) or hotels (B2) |
| PAY-02 | `POST /api/bookings/{type}/{id}/accept-policies` | `501 BOOKING_TYPE_UNAVAILABLE` | the same |
| PAY-01 | `POST /api/payments` | `501 BOOKING_TYPE_UNAVAILABLE` | the same |
| PAY-01 | `POST /api/payments/{id}/retry` | `404` — no payment of yours exists | the same |
| PAY-01 | `GET /api/payments/{id}` | `404` | the same |
| PAY-03 | `GET /api/refunds/{id}` | `404` | the same |
| PAY-01 | `POST /api/payments/webhook` | — | not callable from Swagger at all: Stripe signs it and the signature is checked against the raw request bytes. It is proved with the Stripe CLI (`docs/api/POSTMAN.md` §6) |

Until then, the payment flow is covered by `backend/test/payments.e2e-spec.ts`,
`refunds.e2e-spec.ts` and `booking-policies.e2e-spec.ts`, which drive it
against a mocked port — `npm run test:e2e`, 328 tests over 27 suites.

## Note on the screenshots

The `curl` preview is cropped out of every shot. It repeats the request body,
which after an admin sign-in contains `ADMIN_PASSWORD` in plain text. The
temporary passwords visible in the ACC-07a and ACC-13 responses belong to
throwaway `test_c2_*` accounts created for these captures and deleted
afterwards.
