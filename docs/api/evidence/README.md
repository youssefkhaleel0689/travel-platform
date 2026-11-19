# Swagger UI evidence — C2 (accounts, notifications, payments)

Screenshots of every endpoint C2 owns, taken in Swagger UI at
`http://localhost:3000/api/docs` against the shared MongoDB Atlas cluster.
Each one shows the endpoint, the request body or parameters, the **Request
URL**, the response **code** and the response **body**.

Every endpoint C2 owns is here. The payment shots were taken **live**: a real
Stripe PaymentIntent in test mode, a real test-card charge, Stripe's signed
webhook forwarded back to the local backend, and a real refund. See
["Paying for a booking, live"](#paying-for-a-booking-live-pay-01-pay-02-pay-03).

`CAPTURE-RUN.md` is the run that produced these, in the order that works: each
step only needs state an earlier step created, and the sign-ins are grouped so
the session cookie is never replaced mid-group. Following it by hand gives the
same shots; this set was taken by driving the same page in Chrome, so the run
can be repeated exactly when an endpoint changes. Every request is a real one
against the running server - the responses are whatever the API actually
returned. Re-capturing overwrites the same filename, so this folder never holds
two versions of one shot.

## What is here

23 screenshots and one webhook log, covering all 20 endpoints C2 owns. The table
lists 21 because shot 16 also calls `GET /api/users/me` (the Leader's route,
ACC-04) to prove that a deactivated account's cookie stops working.

| Requirement | Endpoint | Shows | File |
| --- | --- | --- | --- |
| ACC-14 | `GET /api/admin/accounts` | `200` + the page of accounts | `01_ACC-14_list-accounts_200.png` |
| ACC-16 | `PATCH /api/admin/accounts/{id}/suspend` | `200`, `status: SUSPENDED` | `02_ACC-16_suspend_200.png` |
| ACC-16 | `PATCH /api/admin/accounts/{id}/reactivate` | `200`, `status: ACTIVE` | `03_ACC-16_reactivate_200.png` |
| ACC-07a | `POST /api/admin/users/{id}/reset-password` | `200` + the one-time temporary password | `04_ACC-07a_reset-password_200.png` |
| ACC-13 | `POST /api/admin/moderators` | `201` + the account, its provider and its temporary password | `05_ACC-13_create-moderator_201.png` |
| ACC-07a | any route, on a temporary password | `403 PASSWORD_CHANGE_REQUIRED` | `06_ACC-07a_password-change-required_403.png` |
| ACC-08 | `PATCH /api/auth/change-password` | `200`, and the lockout above is over | `07_ACC-08_change-password_200.png` |
| GEN-01 | `GET /api/notifications/unread-count` | `200`, `unreadCount: 4` | `08_GEN-01_unread-count_200_four-unread.png` |
| GEN-01 | `GET /api/notifications?page=1&unreadOnly=true` | `200`, the unread ones, newest first | `09_GEN-01_list-notifications_200.png` |
| GEN-01 | `PATCH /api/notifications/{id}/read` | `204` | `10_GEN-01_mark-one-read_204.png` |
| GEN-01 | `GET /api/notifications/unread-count` | `200`, `unreadCount: 3` — the 204 above did something | `11_GEN-01_unread-count_200_three-unread.png` |
| GEN-01 | `PATCH /api/notifications/read-all` | `204` | `12_GEN-01_mark-all-read_204.png` |
| GEN-01 | `GET /api/notifications/unread-count` | `200`, `unreadCount: 0` | `13_GEN-01_unread-count_200_none-unread.png` |
| ACC-09 | `PATCH /api/users/me` | `200`, name, phone and currency changed | `14_ACC-09_update-profile_200.png` |
| ACC-12 | `DELETE /api/users/me` | `200`, `status: DEACTIVATED`, the row kept | `15_ACC-12_deactivate_200.png` |
| ACC-12 | `GET /api/users/me` after it | `401` — the cookie died with the account | `16_ACC-12_cookie-revoked_401.png` |
| PAY-02 | `GET /api/bookings/{type}/{id}/policies` | `200`, the hotel's terms snapshot, `accepted: false` | `17_PAY-02_booking-policies_200.png` |
| PAY-02 | `POST /api/bookings/{type}/{id}/accept-policies` | `200`, `accepted: true`, version 5 stored with its snapshot | `18_PAY-02_accept-policies_200.png` |
| PAY-01 | `POST /api/payments` | `201`, a real Stripe PaymentIntent for `240.00` USD, `REQUIRES_PAYMENT_METHOD` | `19_PAY-01_create-payment_201.png` |
| PAY-01 | `POST /api/payments/{id}/retry` | `200`, the still-open attempt returned as it stands — same intent, attempt 1 | `20_PAY-01_retry-payment_200.png` |
| PAY-01 | `POST /api/payments/webhook` | Stripe's `payment_intent.succeeded`, forwarded by the Stripe CLI, answered `200` | `24_PAY-01_webhook-via-stripe-cli.txt` |
| PAY-01 | `GET /api/payments/{id}` | `200`, `SUCCEEDED` — the webhook confirmed it seven seconds after it was opened | `21_PAY-01_get-payment_200.png` |
| PAY-03 | `GET /api/refunds/{id}` | `200`, a real Stripe refund of `240.00` USD, `REFUNDED`, at the 100% tier | `22_PAY-03_get-refund_200.png` |
| ACC-17 | `GET /api/admin/bookings` | `200`, an empty page — no booking module implements `listForAdmin` yet | `23_ACC-17_admin-bookings_200.png` |

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

Needs `confirm: true` in the body. Nothing is deleted: the response still
carries the account's id, name and email, and only `status` has changed, so past
bookings, payments and refunds keep pointing at a real account. The row also
records a `deactivatedAt`, which is kept for the admin list (ACC-14) and is not
part of this response — the shot shows `status: DEACTIVATED`, not that field.

The session stops working at once for two reasons: the guard reloads the account
on every request, and since ACC-06 deactivation also revokes every session the
account had, which is what stops its refresh token as well.

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

The notices came from the suspensions above (only suspending notifies, not
reactivating). The count starts at **4** rather than 2 because this account had
also been suspended during an earlier capture run and those notices were still
unread — the number is whatever the account has, and nothing here depends on it
being a particular value.

What matters is the shape. The two `PATCH` routes answer `204` with an empty
body by design, so the proof that they worked is the count before and after:
**4**, then **3** after one is marked read, then **0** after mark-all-read.

![Four unread](08_GEN-01_unread-count_200_four-unread.png)

![The notifications themselves](09_GEN-01_list-notifications_200.png)

![Marking one read](10_GEN-01_mark-one-read_204.png)

![Three unread left](11_GEN-01_unread-count_200_three-unread.png)

![Marking the rest read](12_GEN-01_mark-all-read_204.png)

![None unread](13_GEN-01_unread-count_200_none-unread.png)

## Paying for a booking, live (PAY-01, PAY-02, PAY-03)

One booking, followed from hold to refund. A throwaway traveller booked two
nights at a seeded hotel (2 nights at $120, so `240.00`) and the booking went on
its 10-minute hold, `PENDING_PAYMENT`. Everything below happened inside that hold.

**PAY-02, the policies first.** The booking carries the hotel's terms as they
were when it was made, so a later edit by the hotel never changes them. Payment is
refused until these exact terms are accepted, by version.

![The booking's policies](17_PAY-02_booking-policies_200.png)

![Accepting them](18_PAY-02_accept-policies_200.png)

**PAY-01, the payment.** The amount comes from the booking, never from the
request. The response carries the Stripe PaymentIntent and its `clientSecret`,
which the card form would use to send the card straight to Stripe; no card
detail ever reaches this backend. `policyAcceptanceId` is the acceptance from 18.

![A real Stripe PaymentIntent](19_PAY-01_create-payment_201.png)

Retrying an attempt that is still open returns that attempt as it stands — the
same intent, still attempt 1 — instead of opening a second one, so a double click can
never charge twice.

![Retrying an open attempt](20_PAY-01_retry-payment_200.png)

**The webhook.** The test card `pm_card_visa` was charged through the Stripe CLI,
and Stripe sent its signed `payment_intent.succeeded` back through `stripe listen`.
This route is not in Swagger: the signature is checked against the raw request
bytes, so a "Try it out" call could only be refused. The forwarder's own log is
the evidence, in [`24_PAY-01_webhook-via-stripe-cli.txt`](24_PAY-01_webhook-via-stripe-cli.txt):

~~~
2026-11-19 18:25:19   --> payment_intent.succeeded [evt_3UdY96KCXO24LpU91uuCGkUx]
2026-11-19 18:25:20  <--  [200] POST http://localhost:3000/api/payments/webhook [evt_3UdY96KCXO24LpU91uuCGkUx]
~~~

Only that verified webhook confirms a booking. 18:25:19 there is local time
(UTC+2) — 16:25:19 UTC, the `succeededAt` below.

![The payment, succeeded](21_PAY-01_get-payment_200.png)

**PAY-03, the refund.** The traveller then cancelled the confirmed booking. The
hotel refunds 100% when a booking is cancelled at least 7 days before check-in, and
check-in was 60 days away, so the whole `240.00` went back through Stripe: a real
refund, `re_3UdY96…`, completed about a second after it was requested. The tier
that applied and the terms it came from are stored on the refund.

![The refund](22_PAY-03_get-refund_200.png)

## ACC-17 — the admin's list of every booking

The request has no filter at all, and the page is empty on purpose. The bookings
live in the flights and hotels modules, and each appears here once that module
implements the optional `listForAdmin` on `BookingsPort`; neither has yet. Until
then the route still answers a page, never a 501, so an admin list does not break
while a module is still being built. This shows the route, the admin guard and the
paging working; it will fill up as those two modules land.

![The admin booking list](23_ACC-17_admin-bookings_200.png)

## Note on the screenshots

Shots 19 and 20 show a `clientSecret`. That is a PaymentIntent client secret, not
an API key: Stripe designs it to be handed to the customer's browser, it belongs to
a test-mode intent that has since succeeded and been refunded, and it cannot be used
without the account's own keys, which appear nowhere in this folder.

The `curl` preview is cropped out of every shot. It repeats the request body,
which after an admin sign-in contains `ADMIN_PASSWORD` in plain text. The
temporary passwords visible in the ACC-07a and ACC-13 responses belong to
throwaway `test_c2_*` accounts created for these captures and deleted
afterwards.
