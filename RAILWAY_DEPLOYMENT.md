# Railway Deployment Guide

## Environment Variables

Set these in your Railway project:

1. `DATABASE_URL` - PostgreSQL connection string (Railway will provide this when you provision a database)
2. `VAPI_API_KEY` = `4f23345b-0a09-4e42-9a9a-661e30c0c8fe`
3. `VAPI_ASSISTANT_ID` = `20f87e19-f86e-4055-b9fd-aa18e5eb1c9f`
4. `VAPI_PHONE_NUMBER_ID` = `20617765-2d18-4206-91dc-5212a67c59f9`

## Seeding the Database

After deployment, you need to seed the database with dummy data. You have two options:

### Option 1: Run via Railway CLI (Recommended)

```bash
railway run npm run seed
```

### Option 2: Run via Railway Shell

1. Go to your Railway project
2. Open the service shell/console
3. Run: `npm run seed`

### Option 3: Add as Post-Deploy Hook

In Railway, you can add a post-deploy script:
- Go to your service settings
- Add a post-deploy command: `npm run seed`

**Note:** The seed script is idempotent - it will check if data already exists and skip seeding if the database is already populated. To re-seed, you'll need to clear the database first.

## Build Process

The build process automatically:
1. Builds the client (React app) to `dist/public`
2. Builds the server to `dist/index.cjs`
3. Builds the seed script to `dist/seed.cjs`

## Database Schema

The database schema is managed via Drizzle ORM. To push schema changes:

```bash
railway run npm run db:push
```

Or in Railway shell:
```bash
npm run db:push
```


