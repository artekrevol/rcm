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
