# The capture run

How the screenshots in this folder were produced, in an order that works in one
sitting: every step only needs state an earlier step created, and the sign-ins
are grouped so Swagger UI's single session cookie is never replaced in the
middle of a group.

Sections 1 to 4 cover the 12 account and notification endpoints and need
nothing from another module. Section 5 is the payment run, which is live:
it needs a real Stripe test key and the Stripe CLI, and a booking on hold
made through the hotels module first.

## 0. Before you start

```bash
cd backend && npm run seed && npm run seed:admin && npm run start
```

Open <http://localhost:3000/api/docs>. Press `Ctrl+-` once or twice so an
endpoint's request **and** response fit in one shot.

Capture with `Win+Shift+S` (region), save as PNG, and use the filenames in
`README.md` — the numbers are this run's order, so a reader can follow the
chain.

**Every shot must show:** the method and path, what you sent, the **Request
URL** box, the response **Code** and the response **body**. Swagger prints all
of it in one column after Execute.

**Crop out the `curl` box.** It repeats the request body, so after an admin
sign-in it shows `ADMIN_PASSWORD`. Never capture a `.env`, `JWT_SECRET`, a
Stripe key or the Atlas URI.

## 1. Two accounts, no capture

Registering signs you in, which replaces whatever cookie you hold — so both
registrations happen before anything is captured. `POST /api/auth/register`
(the Leader's endpoint, ACC-01), `acceptTerms: true`:

| Account | Password | Used for |
| --- | --- | --- |
| `test_c2_evidence@example.com` | `ManualTest123` | every admin route below acts on it |
| `test_c2_throwaway@example.com` | `ManualTest123` | ACC-12 only, because deactivation is permanent |

## 2. As the admin — 5 captures

`POST /api/auth/login` with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from
`backend/.env`. **Do not capture this**: the curl box carries the password.

| # | Endpoint | Req | Send | Expect |
| --- | --- | --- | --- | --- |
| 01 | `GET /api/admin/accounts?search=test_c2_evidence` | ACC-14 | — | `200`, one row. **Copy its `id`** |
| 02 | `PATCH /api/admin/accounts/{id}/suspend` | ACC-16 | no body | `200`, `status: SUSPENDED` |
| 03 | `PATCH /api/admin/accounts/{id}/reactivate` | ACC-16 | no body | `200`, `status: ACTIVE` |
| — | run 02 and 03 **once more** | — | no body | no capture. Only *suspend* notifies, so a second pass leaves GEN-01 with more than one notice to work with |
| 04 | `POST /api/admin/users/{id}/reset-password` | ACC-07a | no body | `200`. **Copy `temporaryPassword`** |
| — | `POST /api/airlines` | FLT-01 (A2's, prerequisite) | `{"name":"test_c2_evidence Airline","iataCode":"E7"}` | `201`. **Copy `id`**. A `409` means that two-character code is taken — try another |
| 05 | `POST /api/admin/moderators` | ACC-13 | the **Airline moderator** example from the dropdown, with that `airlineId` and a fresh email | `201` |

Suspending is what notifies the account (ACC-15); reactivating only puts the
status back and sends nothing. That is why the pair runs twice, and why it has
to happen before §3.

## 3. As the test account — 9 captures

`POST /api/auth/login` as `test_c2_evidence@example.com` with the temporary
password from 04. This is the only identity change in the run.

Sign in **after** the reset, not before: since ACC-06 the reset ends every
session the account had, so a cookie from earlier answers 401 rather than the
403 that capture 06 is there to show.

| # | Endpoint | Req | Send | Expect |
| --- | --- | --- | --- | --- |
| 06 | `GET /api/notifications/unread-count` | ACC-07a | — | `403 PASSWORD_CHANGE_REQUIRED`. The reset really does lock the account out of everything |
| 07 | `PATCH /api/auth/change-password` | ACC-08 | `{"currentPassword":"<temporary>","newPassword":"NewPass123"}` | `200`, and the lockout is over |
| 08 | `GET /api/notifications/unread-count` | GEN-01 | — | `200`. **Write the number down**; it is whatever this account has unread, not a fixed 2 |
| 09 | `GET /api/notifications` | GEN-01 | `page=1`, `unreadOnly=true` | `200`, the unread ones, newest first. **Copy one `id`** |
| 10 | `PATCH /api/notifications/{id}/read` | GEN-01 | no body | `204`, empty body by design |
| 11 | `GET /api/notifications/unread-count` | GEN-01 | — | `200`, exactly one less than 08 |
| 12 | `PATCH /api/notifications/read-all` | GEN-01 | no body | `204` |
| 13 | `GET /api/notifications/unread-count` | GEN-01 | — | `200`, `unreadCount: 0` |
| 14 | `PATCH /api/users/me` | ACC-09 | `{"name":"Taher Khalaf","phone":"+201234567890","preferredCurrency":"USD"}` | `200` |

10 and 12 answer `204` with nothing in the body, so on their own they prove
little. 08, 11 and 13 are the evidence that they did something — it is the one
place in the run where a response body is not enough by itself.

Do not expect a particular starting number. An account used in an earlier run
still carries its unread notices, so 08 can be any count; what the three shots
have to show is that it drops by exactly one after 10, and to zero after 12.
The committed set runs 4, 3, 0.

## 4. ACC-12, last — 2 captures

Deactivation is permanent and kills the cookie, so it goes at the end on the
throwaway account. `POST /api/auth/login` as `test_c2_throwaway@example.com` /
`ManualTest123`.

| # | Endpoint | Req | Send | Expect |
| --- | --- | --- | --- | --- |
| 15 | `DELETE /api/users/me` | ACC-12 | `{"confirm": true}` | `200`, `status: DEACTIVATED`; the id, name and email are still returned, so nothing was deleted |
| 16 | `GET /api/users/me` | ACC-12 | — | `401`. The guard reloads the account every request, so the cookie stops working at once |

## 5. Payments, live — 7 captures and a webhook log

This is the one section that talks to Stripe for real, so it needs two things
the placeholders in `.env.example` cannot provide.

**A Stripe test-mode secret key.** Stripe dashboard in **Test mode** →
Developers → API keys → Secret key (`sk_test_…`, about 100 characters). Put it in
`backend/.env` as `STRIPE_SECRET_KEY` yourself; never paste it into a chat or a
screenshot. Test mode moves no real money.

**The Stripe CLI** (`npm install -g @stripe/cli`, Stripe's own package), to
forward Stripe's webhook to `localhost`. It signs in with the same key, so there
is no browser login: load the key into `STRIPE_API_KEY` for the shell, then

~~~
stripe listen --print-secret
~~~

prints the webhook signing secret: that goes in `backend/.env` as
`STRIPE_WEBHOOK_SECRET`. Then leave this running:

~~~
stripe listen --events payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled               --forward-to localhost:3000/api/payments/webhook
~~~

Newer CLIs refuse to start without `--events`. Restart the backend afterwards so
it reads the new values.

**Pick a hotel that refunds something.** A refund is created only when the
cancellation tier gives more than 0%, and a hotel with no cancellation policy gives
0%. On the shared cluster that is "Nile View Hotel" (100% when cancelled 7 or more
days before check-in); the seeded "Cairo Nile View Hotel" has no policy and would
refund nothing. Book far enough ahead to be well past that tier.

Sign in as a throwaway traveller and `POST /api/hotel-bookings` (B2's endpoint,
not captured). The booking is `PENDING_PAYMENT` on a **10-minute hold**, and every
step down to 20 has to happen inside it.

| # | Endpoint | Req | Send | Expect |
| --- | --- | --- | --- | --- |
| 17 | `GET /api/bookings/{type}/{id}/policies` | PAY-02 | `type: hotel`, the booking id | `200`, `accepted: false`. **Note `policyVersion`** |
| 18 | `POST /api/bookings/{type}/{id}/accept-policies` | PAY-02 | `{"accepted": true, "policyVersion": <from 17>}` | `200`, `accepted: true` |
| 19 | `POST /api/payments` | PAY-01 | `{"bookingType": "HOTEL", "bookingId": "<id>"}` | `201`, `REQUIRES_PAYMENT_METHOD`. **Note the payment `id` and `stripePaymentIntentId`** |
| 20 | `POST /api/payments/{id}/retry` | PAY-01 | no body | `200`, the same intent, still attempt 1 |
| — | charge the test card | — | `stripe payment_intents confirm <pi_…> --payment-method=pm_card_visa --return-url=https://example.com/return` | `"status": "succeeded"`, and `stripe listen` logs `[200] POST …/api/payments/webhook` |
| 21 | `GET /api/payments/{id}` | PAY-01 | the payment id | `200`, `SUCCEEDED` |
| — | `POST /api/hotel-bookings/{id}/cancel` | — | `{"confirm": true}` | not captured; issues the refund |
| 22 | `GET /api/refunds/{id}` | PAY-03 | the refund's id | `200`, `REFUNDED` |

The `--return-url` is required because our PaymentIntents use automatic payment
methods; a card never actually redirects. No route returns a refund's id, so read
it from the `refunds` collection by `paymentId` (read-only). Copy the two
`payment_intent.succeeded` lines from the `stripe listen` output into the log file,
with the signing secret it prints on start-up redacted.

Then, as the admin:

| # | Endpoint | Req | Send | Expect |
| --- | --- | --- | --- | --- |
| 23 | `GET /api/admin/bookings` | ACC-17 | **clear** the `from`, `to` and `reference` fields | `200`, flight bookings and hotel reservations in one page, newest first |

Swagger UI pre-fills those optional fields with the DTO's examples, including a
made-up reference, `K7M2QX`. Left as they are, the request filters on a booking that
does not exist, and the empty page then proves nothing about the route. The page
shows a flight row only if the database holds a flight booking; on a cluster with
none, hold a seat on a test flight first (FLT-22) and take the shot inside its
10 minutes.

## 6. Worth adding if the TA wants refusals

Not in this folder yet, and not required — one screenshot each if asked for.
Run them as the test account from §3 unless noted.

| Endpoint | Send | Expect |
| --- | --- | --- |
| `GET /api/admin/accounts` | — | `403 FORBIDDEN` — the role guard |
| `DELETE /api/users/me` | `{"confirm": false}` | `400`, `confirm must be true` |
| `POST /api/admin/moderators` (as admin) | `role: "ADMIN"` | `400` on `role` — this route cannot mint an admin |
| `POST /api/admin/moderators` (as admin) | `providerId` instead of `airlineId` | `400`, unknown field refused rather than ignored |
| `PATCH /api/users/me` | `{"role":"ADMIN"}` | `400`, unknown field |

## 7. Clean up afterwards

Everything above lands on the **shared** Atlas database. Delete the accounts
you made (`test_c2_evidence`, `test_c2_throwaway`, the moderator), the
moderator's row in `airlineModeratorAssignment`, and the airline — and **leave
the seeded admin alone**: `ADMIN_EMAIL` is itself a `test_c2_` address, so a
sweep of every `test_c2_` account takes it with it and the next run dies on
sign-in. `docs/api/POSTMAN.md` §9 has the full list.

Section 5 leaves a traveller account, its cancelled booking (in the hotels
module's collection), the payment, its policy acceptance and the refund. The
payment and refund also exist in your Stripe test dashboard, where they can stay:
test mode is meant to accumulate them.
