# Manual API testing with Postman (D2 endpoints)

How to exercise the blog, image uploads, reports, moderation and the audit log
by hand: BLG-01 to BLG-10, BLG-12, GEN-07 to GEN-10. Swagger UI at
`http://localhost:3000/api/docs` is what Milestone 1 is graded through; this
collection is the repeatable pass, with an assertion per rule.

File: `postman/travel-platform-d2.postman_collection.json` (39 requests in 6
folders). Import it in Postman (File > Import). The variables live on the
collection, so no environment is needed.

## 1. Set up

~~~
cd backend
npm install
npm run start:dev
~~~

`backend/.env` needs `MONGODB_URI` and `JWT_SECRET` (see the README).

Folder 40 needs an ADMIN account. Use the seeded admin (ACC-18) and put its
email and password in the collection variables `adminEmail` and
`adminPassword` (Variables tab; never save them in a file you commit). If you do
not have the seeded admin's password, register a throwaway `test_` account,
set its `role` to `ADMIN` in Atlas (collection `users`), and sign in with it;
delete that account when you are done.

## 2. Run

Run the folders in order (Collection Runner, or one request at a time):

| Folder | Covers |
| --- | --- |
| 00 Accounts | Registers the two `test_d2_` accounts (409 on later runs is fine) |
| 10 Posts as the author | BLG-01, BLG-03, BLG-04, BLG-08: draft, tag rules, my posts, publish, empty edit |
| 20 Images | BLG-10, GEN-08. **Choose a JPG/PNG file in request 01 (Body > form-data > file) and a .txt or .gif in request 03 first** |
| 30 Reader | BLG-02, BLG-05 to BLG-09, BLG-12, GEN-09: open, like twice, comment, edit, owner-only 404, search, tag page, author page, report, duplicate report, own content, 403 on the admin queue |
| 40 Admin | GEN-07, GEN-10: queue, resolve with HIDE, resolve twice (409), audit row, restore, hide a comment, soft delete, restore refused (409), audit log |
| 50 Author after moderation | The deleted post is 404 for its author too |

Each run uses a new `runTag` word in the title and tags, so searches find only
that run's post. The run leaves one soft-deleted post and its comment; delete
them in Atlas (collections `posts`, `comments`, `likes`, `reports`) when you
clean up, and remove the two `test_d2_` accounts the same way as any test user.

## 3. Troubleshooting

| Symptom | Cause |
| --- | --- |
| 401 everywhere after a sign-in | The cookie is per host: `baseUrl` must be the same host you signed in on |
| 403 `PASSWORD_CHANGE_REQUIRED` | The account must change its password first (ACC-07a) |
| 400 `FILE_REQUIRED` in folder 20 | No file was chosen for the `file` key |
| 404 `POST_NOT_FOUND` in folder 30 | Folder 10 request 04 (publish) did not run |
| 403 in folder 40 | The signed-in account is not an ADMIN |
