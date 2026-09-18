import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const base = process.env.SITE_URL || "http://127.0.0.1:8787";
await mkdir("test-results", { recursive: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Interview prep kits." }).waitFor();
  assert.equal(await page.locator(".kit-card").count(), 6);
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
  await page.getByRole("button", { name: "Notify me at launch" }).click();
  await page.getByRole("heading", { name: "Be first in line." }).waitFor();
  await page.screenshot({ path: "test-results/checkout.png", fullPage: false });
  if (!process.env.SITE_URL) {
    await page
      .getByLabel("Email address", { exact: true })
      .fill("browser-test@example.test");
    await page.locator('#checkout-form input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Register interest" }).click();
    await page.getByRole("heading", { name: "You're on the list." }).waitFor();
  }
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: /Free questions/ }).click();
  await page.getByRole("heading", { name: "Get the basics right." }).waitFor();
  await page.locator(".question-row").nth(11).waitFor();
  assert.equal(await page.locator(".question-row").count(), 12);
  await page.locator(".question-row summary").first().click();
  await page.getByLabel("I've practiced this answer").first().check();
  assert.equal(
    await page.locator("#practice-progress").textContent(),
    "1 / 12 practiced",
  );
  const sample = await page.request.get(`${base}/samples/fundamentals.pdf`);
  assert.equal(sample.status(), 200);
  assert.match((await sample.body()).toString("ascii", 0, 8), /^%PDF/);
  await page.getByRole("link", { name: "My library" }).click();
  await page
    .getByRole("heading", { name: "A little space for your next big step." })
    .waitFor();
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
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: catalog, filtering, previews, launch modal, practice progress, library, PDF download, responsive layout, and console.",
  );
} finally {
  await browser.close();
}
