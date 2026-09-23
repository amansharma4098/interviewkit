# interviewkit

PrepTrick is an interview-preparation PDF storefront built for Cloudflare Workers, D1, and private R2 storage. The frontend uses Vite, JavaScript, locally hosted fonts, and Lucide icons. Razorpay payment support remains in the codebase but is disabled while the catalog is free. The seller brand is PrepTrick; this repository is `interviewkit`.

Live site: https://preptrick.amansharma4098.workers.dev

The catalog, expanded samples, free downloads, and D1-backed forms are deployed. Paid checkout remains disabled while Razorpay's website review is resolved; every catalog kit is free for now.

Every zero-price kit card and detail page displays a Download free button. Paid checkout code remains available for later, but it is not offered while all catalog prices are zero.

Public review links are `/about`, `/pricing`, `/contact`, `/terms`, `/privacy`, and `/refunds`. These routes open directly and are linked from the footer. The contact form saves requests in D1; it does not send email. No seller identity or support email is invented when those details have not been provided. Razorpay website review is separate from API credentials and does not generate a new secret for each website.

## Included

| Kit | Experience | Price | Q&As | Pages |
| --- | --- | ---: | ---: | ---: |
| Software Engineer | 0-1 years | Free | 80 | 28 |
| Senior Software Engineer | 2-4 years | Free | 80 | 28 |
| AI Engineer | Experienced | Free | 90 | 28 |
| System Design Round | All levels | Free | 80 | 28 |
| Frontend Engineer | 0-3 years | Free | 80 | 28 |
| Backend Engineer | 1-4 years | Free | 80 | 28 |
| Prompt Engineering | All levels | Free | 70 | 28 |
| LLM App Developer | 1-4 years | Free | 70 | 28 |
| Machine Learning Engineer | Experienced | Free | 70 | 28 |
| Data Scientist | 0-4 years | Free | 70 | 28 |
| Fundamentals | All levels | Free | 50 | 28 |

Content is original practice material, not claimed to be collected from employers. Full PDFs live locally in `output/pdf` and remotely in the private `preptrick-kits` R2 bucket. D1's `kit_files` table stores each kit's object key, byte size, SHA-256 checksum, and update time. Cover previews are generated from the real PDFs. Catalog metadata is in `src/catalog.js`; both private answer banks, `content/questions.json` and `content/technical-questions.json`, are git-ignored. Only `content/samples.json`, cover previews, and the free fundamentals PDF are committed to this public repository. Newly added AI tracks currently reuse the existing AI Engineer PDF object until dedicated PDFs are generated and uploaded.

## Local development

Requires Node.js 24+.

```sh
npm ci
npm run build
npm run pdfs:local
npm run dev
```

Open http://127.0.0.1:8787. On a fresh public-source clone without the private PDFs, replace `npm run pdfs:local` with `node scripts/cloudflare.mjs upload-pdfs --local --sample-only`; paid delivery will be unavailable. Application builds do not bundle PDFs: existing R2 files survive frontend deployments. For frontend hot reload, run `npm run dev:ui` in another terminal; it proxies APIs to port 8787. Rebuild before running the Worker preview after frontend changes. `.dev.vars.example` documents the local secret names. Copy it to the ignored `.dev.vars` and fill in test credentials to test checkout. Never commit that file.

```sh
npm test
npm run build
```

Tests use Node's SQLite engine and mocked Razorpay responses. They cover server-owned prices, forged callbacks, capture state, amount/currency matching, direct-file bypasses, recovery, duplicate webhooks, refund ordering, origin checks, persistence, and abuse limits. They do not replace a real Razorpay sandbox acceptance test.

Run `npx playwright install chromium --only-shell` once, then `npm run test:browser` with the local Worker running. The browser suite exercises catalog filtering, previews, absence of starter-PDF promotions and notification signup, support submissions, 50-question practice progress, the purchase library, the PDF endpoint, and desktop/tablet/mobile layouts. Set `SITE_URL` to a deployed origin for a read-only smoke run. Browser screenshots are kept in the ignored `test-results` folder. Starter-PDF download links are intentionally hidden from the UI; the stored PDF and its existing endpoint are retained.

## Cloudflare deployment

Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your shell or CI secrets. They are never required in the website source. The token needs Workers Scripts edit, D1 edit, and R2 storage edit access for this account. `scripts/cloudflare.mjs` can also prompt for the token without echoing or persisting it.

```sh
npx wrangler d1 create preptrick-db
```

Put the returned database ID into `wrangler.jsonc`, then:

```sh
npm run pdfs:upload
npm run deploy
```

The `preptrick` Worker serves the frontend and API, with `DB` bound to D1 and `PDFS` bound to private R2. `pdfs:upload` creates the bucket when needed, checks that public access is disabled, applies D1 migrations, uploads every PDF to a checksum-versioned object key, downloads each object to verify its checksum, and only then updates D1 metadata. It does not delete older versions. Keep both the R2 public development URL and custom domains disabled.

`assets.run_worker_first` must remain `true`. The Worker checks the purchase before streaming a paid PDF from R2 and sends `Cache-Control: private, no-store`. The free PDF is explicitly exposed at `/samples/fundamentals.pdf`; paid files are available only through authenticated `/downloads/:kitId` requests. There is no static-file fallback. Do not publish the paid files through another host.

## Enable paid checkout

The deployment deliberately has `CHECKOUT_ENABLED=false`. Free downloads, content previews, and support forms work while payments are being configured. The owner selected the API key ID `rzp_live_SbfPAbtHNgFB2D`, recorded in `wrangler.jsonc`. It is a public identifier, not enough to accept payments by itself. Its matching secret has not been supplied. The other project's web key must not be mixed with this key's server secret.

1. Finish Razorpay merchant onboarding and automatic capture settings.
2. Keep the public `RAZORPAY_KEY_ID` in `wrangler.jsonc`. Set its matching secret using `npx wrangler secret put RAZORPAY_KEY_SECRET`, and separately set `RAZORPAY_WEBHOOK_SECRET`. Use a matching test key pair first, then the selected live pair after sandbox verification. The browser receives the key ID from the same server that creates the order, so no separate frontend key is needed.
3. In Razorpay, add `https://YOUR-HOST/api/webhooks/razorpay` and subscribe to `payment.captured`, `order.paid`, and `refund.processed`. Use the matching webhook secret.
4. Set a real monitored `SUPPORT_EMAIL` in `wrangler.jsonc`. Add the seller's legal identity, business contact/address, and any applicable tax details to the site policies before launch. Have the owner review the draft privacy, terms, refund, and delivery policies in `src/app.js`.
5. Set `CHECKOUT_ENABLED` to `true`, deploy, and complete the sandbox checks below. Only then switch to live keys.

Checkout remains unavailable unless the enable flag, key ID, both payment secrets, and a valid support email are configured. No fake purchases are marked paid, and no live transaction is performed by automated tests.

### Sandbox acceptance

- Complete a captured test payment; confirm download and recovery on another browser.
- Dismiss checkout; confirm the order stays unpaid.
- Close the browser after paying; confirm library reconciliation or the webhook recovers delivery.
- Replay a webhook and confirm the purchase is unchanged.
- Process a test refund; confirm subsequent downloads are denied.
- Check failed payments, delayed capture, mobile checkout, and PDF delivery.

## Purchase access

Each order gets a 256-bit random recovery code. Only its hash is stored in D1. The browser stores the code locally, and customers can copy it from My library and restore it elsewhere. Requests send it in an Authorization header, never a URL. Losing both browser data and the recovery code requires seller-assisted support. There is no automatic email delivery or login service in this version.

Payment signatures and provider capture status are verified before access is granted. Prices come from the server. Duplicate webhook delivery is recorded, refund events revoke access, and a late capture cannot restore a refunded order. Keep refund webhooks healthy: revocation depends on receiving the refund event. Refunds themselves are initiated by the seller in Razorpay, not automatically approved by this application.

## Operations

Support requests and any previously collected launch-interest records are stored in D1. The notification signup has been removed from the UI. No email-sending service is connected. The seller must monitor support records in the Cloudflare dashboard or via Wrangler and follow up using their own support email:

```sh
npx wrangler d1 execute DB --remote --command "SELECT id, email, subject, message, created_at FROM support_requests WHERE status = 'open' ORDER BY created_at DESC"
npx wrangler d1 execute DB --remote --command "SELECT email, kit_id, created_at FROM subscribers ORDER BY created_at DESC"
npx wrangler d1 execute DB --remote --command "SELECT id, kit_id, amount, status, created_at FROM orders ORDER BY created_at DESC LIMIT 50"
```

The daily scheduled handler removes expired rate limits, webhook-event records older than 90 days, and interest registrations older than 180 days. Payment and support records are retained for the seller to manage. Implement the owner's retention and deletion policy before public sales. Monitor Worker errors, payment webhook failures, and open support requests. Use D1's backup/recovery features and test recovery before relying on the service for revenue.

The UI includes no fake reviews, invented customer counts, or hiring guarantees. Additional product expansion, email delivery, authenticated administration, custom-domain setup, and seller tax invoicing can be added as business requirements become known.

## Regenerate PDFs

Install Python `reportlab`, `pypdf`, and `pypdfium2`, then run:

```sh
python3 scripts/generate-pdfs.py
python3 scripts/pdf-check.py
npm run pdfs:local
npm run build
```

The generator requires both private answer banks, validates at least 50 unique questions per PDF and the extracted answers/follow-ups, creates public sample data and cover previews, and adds a study route and worksheet to every kit. Code examples use monospace text; writing space participates in page layout to prevent overlap. Inspect every rendered page after content changes. Upload approved revisions with `npm run pdfs:upload`, then deploy the updated catalog and covers. Back up both private answer banks and the six paid PDFs separately: they are intentionally excluded from this public Git repository. Public CI verifies the application build and never deploys it.

## References

- [Cloudflare Worker asset routing](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Razorpay integration and verification](https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/)
