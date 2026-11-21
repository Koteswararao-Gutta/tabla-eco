# Backups of the Tabla database

All orders, payments, menus, pictures and staff weeks live in one Firestore database (project `tabla-eco-2e94b`).

## Turn backups on (once)

1. In Google Cloud console > **IAM**, find the service account used by the `FIREBASE_SERVICE_ACCOUNT` secret and give it the role **Cloud Datastore Owner** (it can then change backup settings).
2. On GitHub: **Actions > Set up database backups > Run workflow**.
3. It turns on:
   - **Point-in-time recovery:** the database can be read as it was at any minute of the last 7 days.
   - **Delete protection:** the database itself can't be deleted by mistake.
   - **A daily backup**, each kept for 12 weeks.

Running it again is safe: it only adds what is missing. If it stops with "give it the Cloud Datastore Owner role", do step 1 and run it again.

Cost: a few cents a month for a database this size.

The app itself never deletes an order, payment or estimate: "Delete" only hides it (and the server refuses deletes from the app), and payments keep a list of every change.

## Restore

A restore always goes into a **new** database (for example `restore-2026-11-21`); the live one is never overwritten. Then copy back only what you need. Ask a developer for help with the copy step.

### From a daily backup (up to 12 weeks back)

1. Google Cloud console > **Firestore** > **Disaster recovery** (or Backups). Pick the backup from the day you want.
2. Press **Restore**, give the new database a name, start. Or in Cloud Shell:
   ```
   gcloud firestore backups list --project tabla-eco-2e94b
   gcloud firestore databases restore --source-backup=<backup name from the list> --destination-database=restore-2026-11-21 --project tabla-eco-2e94b
   ```
3. Open the new database in the Firestore console, find the order or payment, and copy what was lost back into the live `(default)` database.
4. Delete the restored database when you are done (it costs a little each day).

### To a minute in the last 7 days (point-in-time recovery)

In Cloud Shell, with the time in UTC (Arizona time + 7 hours), rounded to a whole minute:

```
gcloud firestore databases clone --source-database='projects/tabla-eco-2e94b/databases/(default)' --snapshot-time=2026-11-21T22:00:00Z --destination-database=restore-2026-11-21 --project tabla-eco-2e94b
```

Then do steps 3 and 4 above.
