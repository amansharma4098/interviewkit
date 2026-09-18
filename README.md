# interviewkit

PrepTrick is an interview-preparation PDF storefront built for Cloudflare Workers and D1. The frontend uses Vite, JavaScript, locally hosted fonts, and Lucide icons. Razorpay handles payments. The seller brand is PrepTrick; this repository is `interviewkit`.

Live site: https://preptrick.amansharma4098.workers.dev

The catalog, samples, free PDF, and D1-backed forms are deployed. Paid checkout remains disabled pending the owner's Razorpay configuration, support address, and seller-policy review.

## Included

| Kit | Experience | Price | Q&As | Pages |
| --- | --- | ---: | ---: | ---: |
| Software Engineer | 0-1 years | INR 200 | 30 | 18 |
| Senior Software Engineer | 2-4 years | INR 400 | 30 | 18 |
| AI Engineer | Experienced | INR 500 | 30 | 18 |
| System Design Round | All levels | INR 500 | 30 | 18 |
| Frontend Engineer | 0-3 years | INR 300 | 24 | 15 |
| Backend Engineer | 1-4 years | INR 350 | 24 | 15 |
| Fundamentals | All levels | Free | 12 | 9 |

The first four prices were specified by the owner. The additional two are editable starting prices. Content is original practice material, not claimed to be collected from employers. Full PDFs live in `output/pdf`. Cover previews are generated from the real PDFs. Catalog metadata is in `src/catalog.js`; the private answer bank is in the git-ignored `content/questions.json`. Only `content/samples.json`, cover previews, and the free fundamentals PDF are committed to this public repository.

## Local development

Requires Node.js 24+.

```sh
npm ci
npm run build
npm run db:local
npm run dev
```

Open http://127.0.0.1:8787. On a fresh public-source clone without the private PDFs, use `PREPTRICK_PUBLIC_BUILD=1 npm run build` for a preview; paid delivery will be unavailable. Production builds require restoring all six private PDFs first. For frontend hot reload, run `npm run dev:ui` in another terminal; it proxies APIs to port 8787. Rebuild before running the Worker preview after frontend changes. `.dev.vars.example` documents the local secret names. Copy it to the ignored `.dev.vars` and fill in test credentials to test checkout. Never commit that file.

```sh
npm test
npm run build
```

Tests use Node's SQLite engine and mocked Razorpay responses. They cover server-owned prices, forged callbacks, capture state, amount/currency matching, direct-file bypasses, recovery, duplicate webhooks, refund ordering, origin checks, persistence, and abuse limits. They do not replace a real Razorpay sandbox acceptance test.

Run `npx playwright install chromium --only-shell` once, then `npm run test:browser` with the local Worker running. The browser suite exercises catalog filtering, previews, interest and support submissions, practice progress, the purchase library, the free PDF, and desktop/tablet/mobile layouts. Set `SITE_URL` to a deployed origin for a read-only smoke run. Browser screenshots are kept in the ignored `test-results` folder.

## Cloudflare deployment

Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your shell or CI secrets. They are never required in the website source. The token needs Workers Scripts edit and D1 edit access for this account.

```sh
npx wrangler d1 create preptrick-db
```

Put the returned database ID into `wrangler.jsonc`, then:

```sh
npm run db:remote
npm run deploy
```

The `preptrick` Worker serves the frontend and API, with a `DB` binding to D1. `assets.run_worker_first` must remain `true`: the Worker allowlists public routes and protects every full PDF in `/_private`. Do not publish `output/pdf` or `dist/_private` through a separate static host.

## Enable paid checkout

The initial deployment deliberately has `CHECKOUT_ENABLED=false`. Free downloads, content previews, interest registration, and support forms work while payments are being configured.

1. Finish Razorpay merchant onboarding and automatic capture settings.
2. Set secrets using `npx wrangler secret put RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` (one command per secret). Use test credentials first, then live keys after sandbox verification.
3. In Razorpay, add `https://YOUR-HOST/api/webhooks/razorpay` and subscribe to `payment.captured`, `order.paid`, and `refund.processed`. Use the matching webhook secret.
4. Set a real monitored `SUPPORT_EMAIL` in `wrangler.jsonc`. Add the seller's legal identity, business contact/address, and any applicable tax details to the site policies before launch. Have the owner review the draft privacy, terms, refund, and delivery policies in `src/app.js`.
5. Set `CHECKOUT_ENABLED` to `true`, deploy, and complete the sandbox checks below. Only then switch to live keys.

Checkout remains unavailable unless the enable flag, all three payment secrets, and a valid support email are configured. No fake purchases are marked paid, and no live transaction is performed by automated tests.

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

Support and launch-interest records are stored in D1. No email-sending service is connected. The seller must monitor these records in the Cloudflare dashboard or via Wrangler and follow up using their own support email:

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
npm run build
```

The generator requires the private `content/questions.json` file, validates question counts and PDF text, creates public sample data and cover previews, and adds a study route and worksheet to every kit. Inspect rendered pages after content changes. Back up the private answer bank and six paid PDFs separately: they are intentionally excluded from this public Git repository. The local working folder and Cloudflare deployment contain the full PDFs. Public CI verifies a sample-only build and never deploys it.

## References

- [Cloudflare Worker asset routing](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Razorpay integration and verification](https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/)
