# Resolta marketing staging

Independent marketing foundation for Resolta, formerly ClaimShield. This directory does not import or start the existing application, use its database, run its jobs, or modify its auth/callback routes. Rivana capabilities are excluded.

## Run and verify

Use Node 22 or later from this directory:

```sh
node server.mjs
node --test test/*.test.mjs
```

Open http://127.0.0.1:4173. No dependency installation is needed. The 12 routes include the home page, Home Care, Claims Platform, Pricing, workflow review, resources, methodology, About, checklist, state map, exception taxonomy and calculator. The illustrative workflow is not a product demonstration or customer evidence.

## Stage from Git

Use repository `artekrevol/rcm`, branch `codex/resolta-gtm-staging`, and service root `/marketing`. Explicitly select `marketing/railway.staging.json` or equivalent overrides, `node server.mjs`, health path `/healthz`, and `HOST=0.0.0.0`. Never use the root application Railway startup: it can modify the database and seed data. Do not copy production environment variables or a production database into this service.

No existing hosted staging target was confirmed. This branch is reviewable staging work, not a production release or an assertion of a deployed staging URL.

## Release controls

By default, all pages are noindex, intake is disabled and analytics events remain in the browser as `resolta:analytics` events. See `.env.example`. Public canonicals and sitemap require `PUBLIC_RELEASE_APPROVED=true` plus a valid HTTPS `PUBLIC_ORIGIN`. This switch is not a substitute for product/copy/legal review.

Review requests require `REVIEW_INTAKE_APPROVED=true`, a real approved `REVIEW_PRIVACY_URL`, and `REVIEW_STORAGE_DIR` on a protected durable volume outside the web root. A designated reviewer, privacy/retention policy, authorized retrieval/export and notification process must exist first. The server stores business contact information only; it rejects unknown fields and has no file-upload endpoint. It does not log request bodies. Never submit patient information.

The initial request store and idempotency lock support one process/instance. Use a transactional shared store and distributed/edge abuse controls before scaling. The process-local limiter uses socket IP; configure provider edge controls before public intake behind a shared proxy. Request submission records a request, not a completed assessment or qualified lead.

## Domain safety

The current app remains on its verified login host. Marketing links to `https://www.resolta.ai/auth/login`; do not change that until application migration is tested. `www.resolta.ai` marketing and `app.resolta.ai` application are future targets. Inventory cookies, sessions, CSRF/CORS, OAuth, callbacks, webhooks, email links, indexed URLs and redirects before cutover. Preserve old callback endpoints until senders are reconfigured and tested. Never blanket-redirect app paths or POST callbacks to marketing.

## Source of truth

The companion GTM package is in the existing Resolta Drive folder:
https://drive.google.com/drive/folders/1DxS80pvY0qicMB1CKOdQ7yacU_WgZLoc

Read the canonical memory and governing prompt before expanding claims or content. Payer coverage, customer outcomes, pricing rates, integrations and security attestations are evidence-gated. No production claims submission was performed for this change.

## Public deployment — October 6, 2026

The user authorized public release and directed the application to `https://app.resolta.ai`. Marketing login links use that host. The separate `resolta-website` Railway service contains no application database credentials. Intake remains disabled pending its independent handling setup.

Railway rejects the legacy `railwayConfigFile` setting. Publish a clean deployment branch containing only this directory with `git subtree split --prefix=marketing -b codex/resolta-website-production`; push that branch and connect the website service to it. Use repository root `/`, the checked-in Dockerfile, start `node server.mjs`, health `/healthz`, and public environment settings. The source branch remains the reviewable full-repository change. Do not point the website service at the application's root build or startup commands.

Enable `LEGACY_APP_PROXY_ENABLED=true` during migration: existing `/api/*` and `/assets/*` requests stream to the fixed HTTPS application origin without changing request method/body; known application page links redirect to app.resolta.ai. Marketing APIs use `/marketing-api/*`. The old ClaimShield callback hostname remains on the original service. No secrets or request bodies are logged by the website. Existing users may need to sign in again because session cookies are host-only.

Main-domain publishing uses `https://www.resolta.ai` with existing GoDaddy root forwarding from `resolta.ai`. GoDaddy root HTTPS must be separately checked. DNS does not affect application data. Rollback the website service to its previous deployment for code issues; restore the saved www domain mapping only if app separation itself fails.
