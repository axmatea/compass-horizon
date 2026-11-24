# Consulting CRM

A React and TypeScript application with clients, contacts, deals, follow-ups, proposals, and a revenue dashboard. A Node server provides separate Better Auth sessions and a SQLite database for each installation. Records belong to the signed-in account.

## Run from source

Use Node 22.16 or later. Run `npm ci --ignore-scripts` and `npm run build`. Set a new private `BETTER_AUTH_SECRET` of at least 32 random characters, then run `npm start` and open the printed URL. The default port is 3000 and the database path is `data/crm.sqlite`.

Create a local account with an address ending in `.test` and a password of at least 12 characters. Email delivery, recovery, and social sign-in require separate provisioning. Neither records nor credentials are included in a source export.

Run `npm test` after the build. Its disposable database exercises sign-in, persistent records and relationships, optimistic updates, and owner isolation.

## Host an instance

The included Dockerfile builds from pinned dependencies and runs as a non-root user. Set `NODE_ENV=production`, `HOST=0.0.0.0`, an exact HTTPS `APP_ORIGIN`, and `APP_DATABASE` on a private persistent writable volume. Use a distinct origin, database and authentication secret for every installation. Configure backup and restore and an appropriate registration policy before customer use.

Use the CRM's private account API for business data. **Won revenue** sums deals in the Won stage. **Open pipeline** excludes Won and Lost deals. Proposal totals do not count as revenue a second time.
