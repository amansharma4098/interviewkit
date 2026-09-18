import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const base = process.env.SITE_URL || "http://127.0.0.1:8787";
await mkdir("test-results", { recursive: true });
const errors = [];
const orderRequests = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/orders"))
      orderRequests.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const assertNoStarterPromotions = async () => {
    assert.equal(
      await page
        .locator(
          '.announcement, .sidebar-sample, a[href*="/samples/fundamentals.pdf"]',
        )
        .count(),
      0,
      `Starter-kit promotion remains on ${page.url()}`,
    );
  };
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Interview prep kits." }).waitFor();
  assert.equal(await page.locator(".kit-card").count(), 6);
  assert.equal(
    await page.getByRole("button", { name: "Buy now", exact: true }).count(),
    6,
  );
  await assertNoStarterPromotions();
  assert.equal(
    await page
      .locator(".kit-visual img")
      .evaluateAll((images) =>
        images.every((i) => i.complete && i.naturalWidth > 0),
      ),
    true,
  );
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "Buy now", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Checkout opens soon.", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".checkout-product h3").textContent(),
    "Software Engineer",
  );
  assert.equal(await page.locator("#checkout-form").count(), 0);
  await page.screenshot({
    path: "test-results/buy-now-unavailable.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "Continue browsing" }).click();
  await page
    .getByRole("searchbox", { name: "Search interview kits" })
    .fill("artificial-nothing");
  await page.getByRole("heading", { name: "No kits found" }).waitFor();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByRole("radio", { name: "AI & Data" }).check();
  assert.equal(await page.locator(".kit-card").count(), 1);
  await page.getByRole("link", { name: "View kit", exact: true }).click();
  await page
    .getByRole("heading", { name: "AI Engineer", exact: true })
    .waitFor();
  await page.locator(".question-row summary").first().click();
  assert.ok(await page.locator(".question-answer").first().isVisible());
  await page.getByRole("button", { name: "Buy now", exact: true }).click();
  await page
    .getByRole("heading", { name: "Checkout opens soon.", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".checkout-product h3").textContent(),
    "AI Engineer",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByRole("button", { name: /Notify me/ }).count(),
    0,
  );
  await assertNoStarterPromotions();
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.getByRole("link", { name: /Free questions/ }).click();
  await page.getByRole("heading", { name: "Get the basics right." }).waitFor();
  await page.locator(".question-row").nth(49).waitFor();
  assert.equal(await page.locator(".question-row").count(), 50);
  await assertNoStarterPromotions();
  await page.locator(".question-row summary").first().click();
  await page.getByLabel("I've practiced this answer").first().check();
  assert.equal(
    await page.locator("#practice-progress").textContent(),
    "1 / 50 practiced",
  );
  const sample = await page.request.get(`${base}/samples/fundamentals.pdf`);
  assert.equal(sample.status(), 200);
  assert.match((await sample.body()).toString("ascii", 0, 8), /^%PDF/);
  await page.getByRole("link", { name: "My library" }).click();
  await page
    .getByRole("heading", { name: "A little space for your next big step." })
    .waitFor();
  await assertNoStarterPromotions();
  if (!process.env.SITE_URL) {
    await page.getByRole("button", { name: "Get in touch" }).click();
    await page
      .getByLabel("Email address", { exact: true })
      .fill("browser-test@example.test");
    await page
      .getByLabel("Subject", { exact: true })
      .fill("Local browser verification");
    await page
      .getByLabel("Message", { exact: true })
      .fill("This is a local integration test of the support form.");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.getByRole("heading", { name: "Request received." }).waitFor();
    await page.keyboard.press("Escape");
  }
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/#kits`, { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: "All kits" }).check();
    assert.equal(await page.locator(".kit-card").count(), 6);
    assert.equal(
      await page.getByRole("button", { name: "Buy now", exact: true }).count(),
      6,
    );
    await assertNoStarterPromotions();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `Overflow at ${width}`,
    );
    const overflow = await page
      .locator("h1,h2,h3,button,.kit-card,.small-button")
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 2)
          .map((n) => n.textContent.trim()),
      );
    assert.deepEqual(overflow, [], `Clipped text at ${width}`);
    await page.screenshot({
      path: `test-results/catalog-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#kit/senior-software-engineer`, {
    waitUntil: "networkidle",
  });
  await assertNoStarterPromotions();
  assert.equal(
    await page.getByRole("button", { name: "Buy now", exact: true }).count(),
    1,
  );
  await page.screenshot({
    path: "test-results/detail-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, title] of Object.entries({
      about: "About PrepTrick",
      contact: "Get in touch.",
      privacy: "Privacy",
      terms: "Terms of use",
      refunds: "Refunds & delivery",
      pricing: "Interview prep kits.",
    })) {
      const response = await page.goto(`${base}/${path}`, {
        waitUntil: "networkidle",
      });
      assert.equal(response.status(), 200);
      await page
        .getByRole("heading", { level: 1, name: title, exact: true })
        .waitFor();
      await assertNoStarterPromotions();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `Overflow on ${path} at ${width}`,
      );
      if (path === "contact") {
        await page
          .getByRole("button", { name: "Get in touch", exact: true })
          .click();
        assert.equal(await page.locator("#support-form").count(), 1);
        assert.equal(await page.locator("dialog[open]").count(), 0);
      }
      if (["contact", "terms"].includes(path))
        await page.screenshot({
          path: `test-results/${path}-${width}.png`,
          fullPage: true,
        });
    }
  }
  await page.getByRole("link", { name: "Privacy", exact: true }).click();
  await page
    .getByRole("heading", { level: 1, name: "Privacy", exact: true })
    .waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("heading", { level: 1, name: "Privacy", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "Interview kits", exact: true }).click();
  await page
    .getByRole("heading", {
      level: 1,
      name: "Interview prep kits.",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(errors, []);
  // Exercise the enabled UI without submitting an order or opening live Razorpay.
  const paymentPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  paymentPage.on("pageerror", (error) => errors.push(error.message));
  paymentPage.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/orders"))
      orderRequests.push(request.url());
  });
  await paymentPage.route("**/api/catalog", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, checkoutEnabled: true } });
  });
  await paymentPage.goto(`${base}/#kit/software-engineer`, {
    waitUntil: "networkidle",
  });
  await paymentPage
    .getByRole("button", { name: "Buy now", exact: true })
    .click();
  await paymentPage
    .getByRole("heading", { name: "Make it yours.", exact: true })
    .waitFor();
  assert.equal(
    await paymentPage.locator("#checkout-form").getAttribute("data-id"),
    "software-engineer",
  );
  assert.match(
    await paymentPage.locator(".checkout-product strong").textContent(),
    /200/,
  );
  assert.equal(
    await paymentPage
      .getByRole("textbox", { name: "Email address" })
      .isVisible(),
    true,
  );
  await paymentPage.screenshot({
    path: "test-results/buy-now-enabled-mobile.png",
    fullPage: false,
  });
  await paymentPage.close();
  assert.deepEqual(
    orderRequests,
    [],
    "UI checks must never create real payment orders",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: visible Buy now on cards and details, unavailable/ready checkout UI without creating orders, filtering, previews, no starter-PDF promotions, practice progress, library, policy pages, and responsive layouts.",
  );
} finally {
  await browser.close();
}
