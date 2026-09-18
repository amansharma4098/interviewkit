import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import worker, { digest, verifyHmac } from "../worker/index.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL("../migrations/0002_kit_files.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const id of ["fundamentals", "software-engineer"]) {
    db.prepare(
      "INSERT INTO kit_files (kit_id, object_key, byte_size, sha256, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, `kits/${id}/test.pdf`, 13, "a".repeat(64), 1234);
  }
  const prepare = (sql) => {
    let params = [];
    return {
      bind(...values) {
        params = values;
        return this;
      },
      async first() {
        return db.prepare(sql).get(...params) ?? null;
      },
      async run() {
        return db.prepare(sql).run(...params);
      },
    };
  };
  return {
    prepare,
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
function environment(extra = {}) {
  return {
    DB: database(),
    PDFS: {
      get: async () => ({ body: "%PDF-1.4 test\n", size: 13 }),
    },
    ASSETS: {
      fetch: async () => new Response("<html>PrepTrick</html>"),
    },
    CHECKOUT_ENABLED: "true",
    SUPPORT_EMAIL: "support@example.test",
    RAZORPAY_KEY_ID: "rzp_test_example",
    RAZORPAY_KEY_SECRET: "test-secret",
    RAZORPAY_WEBHOOK_SECRET: "webhook-secret",
    ...extra,
  };
}
const request = (path, options = {}) =>
  new Request(`https://preptrick.test${path}`, options);
const post = (path, data, token, extra = {}) =>
  request(path, {
    method: "POST",
    headers: {
      Origin: "https://preptrick.test",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: JSON.stringify(data),
  });
const signature = (value, secret = "test-secret") =>
  createHmac("sha256", secret).update(value).digest("hex");
const token = "a".repeat(64);
async function seed(env, status = "created") {
  await env.DB.prepare(
    "INSERT INTO orders (id, kit_id, email, amount, provider_order_id, token_hash, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "local-order",
      "software-engineer",
      "buyer@example.test",
      20000,
      "order_provider",
      await digest(token),
      1234,
      status,
    )
    .run();
}
const captured = {
  id: "pay_123",
  order_id: "order_provider",
  amount: 20000,
  currency: "INR",
  status: "captured",
  amount_refunded: 0,
};
async function withProvider(fn, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try {
    await callback();
  } finally {
    globalThis.fetch = original;
  }
}

test("catalog has required prices and only three sample answers per kit", async () => {
  const result = await (
    await worker.fetch(request("/api/catalog"), environment())
  ).json();
  assert.deepEqual(
    result.kits.slice(0, 4).map((k) => k.price),
    [200, 400, 500, 500],
  );
  assert.ok(result.kits.every((k) => k.samples.length === 3));
  assert.ok(result.kits.every((k) => k.questions >= 50));
});
test("the free collection has at least 50 unique questions and answers", async () => {
  const { questions } = await (
    await worker.fetch(request("/api/fundamentals"), environment())
  ).json();
  assert.ok(questions.length >= 50);
  assert.equal(new Set(questions.map((q) => q[1])).size, questions.length);
  assert.ok(questions.every((q) => q.length >= 4 && q[2].length > 50));
});
test("PDF delivery requires valid D1 metadata and a matching private R2 object", async () => {
  for (const condition of [
    "missing-metadata",
    "missing-object",
    "wrong-size",
  ]) {
    const env = environment({
      ASSETS: {
        fetch: () => {
          throw Error("No static PDF fallback is allowed");
        },
      },
    });
    if (condition === "missing-metadata")
      await env.DB.prepare("DELETE FROM kit_files").run();
    if (condition === "missing-object") env.PDFS.get = async () => null;
    if (condition === "wrong-size")
      env.PDFS.get = async () => ({ body: "truncated", size: 9 });
    assert.equal(
      (await worker.fetch(request("/samples/fundamentals.pdf"), env)).status,
      503,
      condition,
    );
  }
});
test("checkout stays off without all launch credentials", async () => {
  const env = environment({ RAZORPAY_WEBHOOK_SECRET: "" });
  assert.equal(
    (await (await worker.fetch(request("/api/catalog"), env)).json())
      .checkoutEnabled,
    false,
  );
  assert.equal((await worker.fetch(post("/api/orders", {}), env)).status, 503);
});
test("business and policy URLs serve the app shell without widening the public allowlist", async () => {
  const env = environment({
    ASSETS: {
      fetch: async (request) => new Response(new URL(request.url).pathname),
    },
  });
  for (const path of [
    "/about",
    "/contact",
    "/privacy",
    "/terms",
    "/refunds",
    "/pricing",
  ]) {
    const response = await worker.fetch(request(path), env);
    assert.equal(response.status, 200);
      assert.equal(await response.text(), "/");
  }
  for (const path of [
    "/unknown",
    "/about/private.pdf",
    "/pricing/software-engineer.pdf",
  ]) {
    assert.equal((await worker.fetch(request(path), env)).status, 404);
  }
});
test("HMAC validation rejects forged or malformed signatures", async () => {
  assert.equal(
    await verifyHmac("test-secret", "hello", signature("hello")),
    true,
  );
  assert.equal(
    await verifyHmac("test-secret", "hello", signature("changed")),
    false,
  );
  assert.equal(await verifyHmac("test-secret", "hello", "bad"), false);
});
test("server pricing ignores browser price and preserves the secret recovery capability", async () => {
  const env = environment();
  await withProvider(
    async (_url, init) => {
      assert.equal(JSON.parse(init.body).amount, 20000);
      return Response.json({ id: "order_new" });
    },
    async () => {
      const response = await worker.fetch(
        post("/api/orders", {
          kitId: "software-engineer",
          email: "buyer@example.test",
          amount: 1,
          acceptTerms: true,
        }),
        env,
      );
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.amount, 20000);
      assert.match(result.token, /^[a-f0-9]{64}$/);
      const saved = await env.DB.prepare("SELECT * FROM orders WHERE id = ?")
        .bind(result.id)
        .first();
      assert.equal(saved.token_hash, await digest(result.token));
      assert.notEqual(saved.token_hash, result.token);
    },
  );
});
test("cross-origin mutations and malformed input are rejected", async () => {
  const env = environment();
  assert.equal(
    (
      await worker.fetch(
        post("/api/support", {}, null, { Origin: "https://attacker.test" }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        post("/api/subscribe", {
          email: "invalid",
          kitId: "software-engineer",
          consent: true,
        }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await worker.fetch(
        post("/api/support", {
          email: "a@b.co",
          subject: "short",
          message: "x".repeat(66000),
        }),
        env,
      )
    ).status,
    413,
  );
});
test("private static assets cannot bypass purchase checks, including encoded paths", async () => {
  const env = environment();
  for (const path of [
    "/_private/software-engineer.pdf",
    "/%5fprivate/software-engineer.pdf",
    "/covers/../_private/software-engineer.pdf",
    "/assets/%2e%2e/_private/software-engineer.pdf",
    "/%255fprivate/software-engineer.pdf",
  ]) {
    assert.equal((await worker.fetch(request(path), env)).status, 404, path);
  }
  assert.equal(
    (await worker.fetch(request("/samples/fundamentals.pdf"), env)).headers.get(
      "Content-Type",
    ),
    "application/pdf",
  );
});
test("unpaid users and wrong kit requests cannot download", async () => {
  const env = environment();
  let storageReads = 0;
  env.PDFS.get = async () => {
    storageReads++;
    return { body: "%PDF-1.4 test\n", size: 13 };
  };
  await seed(env);
  assert.equal(
    (await worker.fetch(request("/downloads/software-engineer"), env)).status,
    401,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/downloads/software-engineer", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        env,
      )
    ).status,
    403,
  );
  await env.DB.prepare("UPDATE orders SET status = 'paid'").run();
  assert.equal(
    (
      await worker.fetch(
        request("/downloads/ai-engineer", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        env,
      )
    ).status,
    403,
  );
  const download = await worker.fetch(
    request("/downloads/software-engineer", {
      headers: { Authorization: `Bearer ${token}` },
    }),
    env,
  );
  assert.equal(
    storageReads,
    1,
    "Only the authorized request should read private storage",
  );
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("Cache-Control"), "private, no-store");
  assert.match(await download.text(), /^%PDF/);
});
test("forged browser payment callbacks do not unlock a kit", async () => {
  const env = environment();
  await seed(env);
  const result = await worker.fetch(
    post(
      "/api/verify",
      {
        razorpay_order_id: "order_provider",
        razorpay_payment_id: "pay_123",
        razorpay_signature: "0".repeat(64),
      },
      token,
    ),
    env,
  );
  assert.equal(result.status, 401);
  assert.equal(
    (await env.DB.prepare("SELECT status FROM orders").first()).status,
    "created",
  );
});
test("valid signature still requires captured status, correct amount and currency", async () => {
  for (const changed of [
    { status: "authorized" },
    { amount: 1 },
    { currency: "USD" },
    { order_id: "order_other" },
    { amount_refunded: 1 },
  ]) {
    const env = environment();
    await seed(env);
    await withProvider(
      async () => Response.json({ ...captured, ...changed }),
      async () => {
        const result = await worker.fetch(
          post(
            "/api/verify",
            {
              razorpay_order_id: "order_provider",
              razorpay_payment_id: "pay_123",
              razorpay_signature: signature("order_provider|pay_123"),
            },
            token,
          ),
          env,
        );
        assert.equal(result.status, 409);
        assert.equal(
          (await env.DB.prepare("SELECT status FROM orders").first()).status,
          "created",
        );
      },
    );
  }
});
test("verified captured payment unlocks and library reconciles missed callbacks", async () => {
  const env = environment();
  await seed(env);
  await withProvider(
    async () => Response.json({ items: [captured] }),
    async () => {
      const response = await worker.fetch(
        request("/api/receipt", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        env,
      );
      assert.equal((await response.json()).order.status, "paid");
    },
  );
});
test("webhooks require raw-body signatures and deduplicate capture events", async () => {
  const env = environment();
  await seed(env);
  const event = {
    event: "payment.captured",
    payload: { payment: { entity: captured } },
  };
  const makeRequest = () =>
    post("/api/webhooks/razorpay", event, null, {
      "X-Razorpay-Signature": signature(
        JSON.stringify(event),
        "webhook-secret",
      ),
      "X-Razorpay-Event-Id": "event_one",
    });
  assert.equal(
    (await worker.fetch(post("/api/webhooks/razorpay", event), env)).status,
    401,
  );
  assert.equal((await worker.fetch(makeRequest(), env)).status, 200);
  assert.equal((await worker.fetch(makeRequest(), env)).status, 200);
  assert.equal(
    (await env.DB.prepare("SELECT count(*) AS n FROM webhook_events").first())
      .n,
    1,
  );
  assert.equal(
    (await env.DB.prepare("SELECT status FROM orders").first()).status,
    "paid",
  );
});
test("refund before capture revokes access and late capture cannot reopen it", async () => {
  const env = environment();
  await seed(env);
  const refund = {
    event: "refund.processed",
    payload: { refund: { entity: { payment_id: "pay_123" } } },
  };
  await withProvider(
    async () => Response.json({ ...captured, amount_refunded: 20000 }),
    async () => {
      const response = await worker.fetch(
        post("/api/webhooks/razorpay", refund, null, {
          "X-Razorpay-Signature": signature(
            JSON.stringify(refund),
            "webhook-secret",
          ),
        }),
        env,
      );
      assert.equal(response.status, 200);
    },
  );
  const capture = {
    event: "payment.captured",
    payload: { payment: { entity: captured } },
  };
  await worker.fetch(
    post("/api/webhooks/razorpay", capture, null, {
      "X-Razorpay-Signature": signature(
        JSON.stringify(capture),
        "webhook-secret",
      ),
    }),
    env,
  );
  assert.equal(
    (await env.DB.prepare("SELECT status FROM orders").first()).status,
    "refunded",
  );
});
test("interest registration is consented, deduplicated and rate limited", async () => {
  const env = environment();
  const data = {
    email: "person@example.test",
    kitId: "ai-engineer",
    consent: true,
  };
  assert.equal(
    (
      await worker.fetch(
        post("/api/subscribe", { ...data, consent: false }),
        env,
      )
    ).status,
    400,
  );
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await worker.fetch(post("/api/subscribe", data), env)).status,
      201,
    );
  assert.equal(
    (await env.DB.prepare("SELECT count(*) AS n FROM subscribers").first()).n,
    1,
  );
  const limited = await worker.fetch(post("/api/subscribe", data), env);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "600");
});
test("support requests persist and responses carry browser security headers", async () => {
  const env = environment();
  const response = await worker.fetch(
    post("/api/support", {
      email: "person@example.test",
      subject: "Download question",
      message: "Please help me restore my original purchase.",
    }),
    env,
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  const saved = await env.DB.prepare("SELECT * FROM support_requests").first();
  assert.equal(saved.status, "open");
  assert.equal(saved.email, "person@example.test");
});
