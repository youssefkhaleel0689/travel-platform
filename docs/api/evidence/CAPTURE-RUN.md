# The capture run

How the screenshots in this folder were produced, in an order that works in one
sitting: every step only needs state an earlier step created, and the sign-ins
are grouped so Swagger UI's single session cookie is never replaced in the
middle of a group.

This run covers the 12 endpoints that work end to end today. The seven waiting
on a booking module are listed in `README.md`; they get captured the same way
once that module is merged.

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

## 5. Worth adding if the TA wants refusals

Not in this folder yet, and not required — one screenshot each if asked for.
Run them as the test account from §3 unless noted.

| Endpoint | Send | Expect |
| --- | --- | --- |
| `GET /api/admin/accounts` | — | `403 FORBIDDEN` — the role guard |
| `DELETE /api/users/me` | `{"confirm": false}` | `400`, `confirm must be true` |
| `POST /api/admin/moderators` (as admin) | `role: "ADMIN"` | `400` on `role` — this route cannot mint an admin |
| `POST /api/admin/moderators` (as admin) | `providerId` instead of `airlineId` | `400`, unknown field refused rather than ignored |
| `PATCH /api/users/me` | `{"role":"ADMIN"}` | `400`, unknown field |

## 6. Clean up afterwards

Everything above lands on the **shared** Atlas database. Delete the accounts
you made (`test_c2_evidence`, `test_c2_throwaway`, the moderator), the
moderator's row in `airlineModeratorAssignment`, and the airline — and **leave
the seeded admin alone**: `ADMIN_EMAIL` is itself a `test_c2_` address, so a
sweep of every `test_c2_` account takes it with it and the next run dies on
sign-in. `docs/api/POSTMAN.md` §9 has the full list.
