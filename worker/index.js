import { kits } from "../src/catalog.js";
import samples from "../content/samples.json" with { type: "json" };

const encoder = new TextEncoder();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicKit = (kit) => ({ ...kit, samples: samples[kit.id] });
const now = () => Math.floor(Date.now() / 1000);
const ready = (env) =>
  env.CHECKOUT_ENABLED === "true" &&
  !!env.RAZORPAY_KEY_ID &&
  !!env.RAZORPAY_KEY_SECRET &&
  !!env.RAZORPAY_WEBHOOK_SECRET &&
  emailPattern.test(env.SUPPORT_EMAIL || "");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function digest(value) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifyHmac(secret, message, signature) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature || "")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.match(/../g), (x) => parseInt(x, 16));
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(message));
}
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) fail(400, "A request body is required.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      fail(413, "Request is too large.");
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(data);
}
async function body(request) {
  if (!request.headers.get("Content-Type")?.includes("application/json"))
    fail(415, "Send JSON content.");
  const raw = await readBody(request);
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    fail(400, "Invalid JSON request.");
  }
}
function cleanEmail(value) {
  if (typeof value !== "string") fail(400, "Enter a valid email address.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email))
    fail(400, "Enter a valid email address.");
  return email;
}
function checkOrigin(request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    fail(403, "Request origin is not allowed.");
}
async function rateLimit(request, env, group, max = 15) {
  const time = now();
  const key = await digest(
    `${group}:${request.headers.get("CF-Connecting-IP") || "local"}:${Math.floor(time / 600)}`,
  );
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count",
  )
    .bind(key, time + 1200)
    .first();
  if (row.count > max)
    fail(429, "Too many attempts. Please try again in 10 minutes.");
}
async function razorpay(env, path, options = {}) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok)
    fail(
      502,
      "Payment service is temporarily unavailable. Please retry from My library.",
    );
  return response.json();
}
async function receipt(request, env) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!/^[a-f0-9]{64}$/.test(token || ""))
    fail(401, "A valid recovery code is required.");
  const order = await env.DB.prepare(
    "SELECT * FROM orders WHERE token_hash = ?",
  )
    .bind(await digest(token))
    .first();
  if (!order) fail(404, "Purchase not found. Check your recovery code.");
  return order;
}
export function validPayment(payment, order) {
  return (
    payment.status === "captured" &&
    payment.order_id === order.provider_order_id &&
    payment.amount === order.amount &&
    payment.currency === order.currency &&
    !payment.refunded &&
    !payment.amount_refunded
  );
}
async function markPaid(env, order, payment) {
  if (!validPayment(payment, order))
    fail(
      409,
      "Payment is not captured for this order yet. Refresh your library shortly.",
    );
  await env.DB.prepare(
    "UPDATE orders SET status = 'paid', provider_payment_id = ?, paid_at = COALESCE(paid_at, ?) WHERE id = ? AND status = 'created'",
  )
    .bind(payment.id, now(), order.id)
    .run();
}
function orderView(order) {
  return {
    id: order.id,
    kitId: order.kit_id,
    email: order.email,
    amount: order.amount / 100,
    currency: order.currency,
    status: order.status,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    providerOrderId: order.provider_order_id,
  };
}

async function webhook(request, env) {
  const raw = await readBody(request);
  if (
    !(await verifyHmac(
      env.RAZORPAY_WEBHOOK_SECRET,
      raw,
      request.headers.get("X-Razorpay-Signature"),
    ))
  )
    fail(401, "Invalid webhook signature.");
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    fail(400, "Invalid event.");
  }
  const eventId =
    request.headers.get("X-Razorpay-Event-Id") || (await digest(raw));
  if (eventId.length > 200) fail(400, "Invalid event identifier.");
  if (
    await env.DB.prepare("SELECT id FROM webhook_events WHERE id = ?")
      .bind(eventId)
      .first()
  )
    return json({ received: true });
  const statements = [];
  if (event.event === "payment.captured" || event.event === "order.paid") {
    const p = event.payload?.payment?.entity;
    if (!p?.order_id) fail(400, "Payment payload is missing.");
    const order = await env.DB.prepare(
      "SELECT * FROM orders WHERE provider_order_id = ?",
    )
      .bind(p.order_id)
      .first();
    if (order) {
      if (!validPayment(p, order))
        fail(409, "Payment does not match the order.");
      statements.push(
        env.DB.prepare(
          "UPDATE orders SET status = 'paid', provider_payment_id = ?, paid_at = COALESCE(paid_at, ?) WHERE id = ? AND status = 'created'",
        ).bind(p.id, now(), order.id),
      );
    }
  } else if (event.event === "refund.processed") {
    const refund = event.payload?.refund?.entity;
    if (!refund?.payment_id) fail(400, "Refund payload is missing.");
    // Resolve by provider order too, so an out-of-order refund cannot be undone by a later capture.
    const payment = await razorpay(
      env,
      `/payments/${encodeURIComponent(refund.payment_id)}`,
    );
    if (payment.amount_refunded > 0)
      statements.push(
        env.DB.prepare(
          "UPDATE orders SET status = 'refunded', provider_payment_id = ? WHERE provider_order_id = ?",
        ).bind(payment.id, payment.order_id),
      );
  }
  statements.push(
    env.DB.prepare(
      "INSERT OR IGNORE INTO webhook_events (id, event_type, created_at) VALUES (?, ?, ?)",
    ).bind(eventId, String(event.event || "unknown"), now()),
  );
  await env.DB.batch(statements);
  return json({ received: true });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "POST" && path === "/api/webhooks/razorpay")
    return webhook(request, env);
  if (request.method === "POST") checkOrigin(request);
  if (request.method === "GET" && path === "/api/catalog")
    return json({
      kits: kits.map(publicKit),
      checkoutEnabled: ready(env),
      supportEmail: env.SUPPORT_EMAIL || null,
    });
  if (request.method === "GET" && path === "/api/fundamentals") {
    return json({ questions: samples.fundamentals });
  }
  if (request.method === "POST" && path === "/api/orders") {
    if (!ready(env))
      fail(
        503,
        "Paid kits are opening soon. You can download the free fundamentals kit now.",
      );
    await rateLimit(request, env, "checkout", 10);
    const input = await body(request);
    const email = cleanEmail(input.email);
    const kit = kits.find((k) => k.id === input.kitId);
    if (!kit || input.acceptTerms !== true)
      fail(400, "Choose a kit and accept the terms.");
    const id = crypto.randomUUID();
    const token = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    await env.DB.prepare(
      "INSERT INTO orders (id, kit_id, email, amount, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, kit.id, email, kit.price * 100, await digest(token), now())
      .run();
    const provider = await razorpay(env, "/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: kit.price * 100,
        currency: "INR",
        receipt: id,
        notes: { kit_id: kit.id },
      }),
    });
    await env.DB.prepare("UPDATE orders SET provider_order_id = ? WHERE id = ?")
      .bind(provider.id, id)
      .run();
    return json(
      {
        id,
        token,
        providerOrderId: provider.id,
        amount: kit.price * 100,
        currency: "INR",
        keyId: env.RAZORPAY_KEY_ID,
        kitId: kit.id,
      },
      201,
    );
  }
  if (request.method === "POST" && path === "/api/verify") {
    await rateLimit(request, env, "verify", 30);
    const order = await receipt(request, env);
    const input = await body(request);
    if (
      !order.provider_order_id ||
      input.razorpay_order_id !== order.provider_order_id ||
      !/^pay_[A-Za-z0-9]+$/.test(input.razorpay_payment_id || "")
    )
      fail(400, "Payment does not match this purchase.");
    if (
      !(await verifyHmac(
        env.RAZORPAY_KEY_SECRET,
        `${order.provider_order_id}|${input.razorpay_payment_id}`,
        input.razorpay_signature,
      ))
    )
      fail(401, "Payment signature could not be verified.");
    const payment = await razorpay(
      env,
      `/payments/${input.razorpay_payment_id}`,
    );
    await markPaid(env, order, payment);
    return json({
      order: orderView(
        await env.DB.prepare("SELECT * FROM orders WHERE id = ?")
          .bind(order.id)
          .first(),
      ),
    });
  }
  if (request.method === "GET" && path === "/api/receipt") {
    await rateLimit(request, env, "receipt", 90);
    let order = await receipt(request, env);
    if (
      order.status === "created" &&
      order.provider_order_id &&
      env.RAZORPAY_KEY_SECRET
    ) {
      const payments = await razorpay(
        env,
        `/orders/${encodeURIComponent(order.provider_order_id)}/payments`,
      );
      const payment = payments.items?.find((p) => validPayment(p, order));
      if (payment) {
        await markPaid(env, order, payment);
        order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?")
          .bind(order.id)
          .first();
      }
    }
    return json({ order: orderView(order) });
  }
  if (request.method === "GET" && path.startsWith("/downloads/")) {
    await rateLimit(request, env, "download", 60);
    const order = await receipt(request, env);
    if (order.status !== "paid" || path !== `/downloads/${order.kit_id}`)
      fail(403, "A completed purchase is required for this kit.");
    const response = await pdf(env, order.kit_id);
    if (response.ok)
      await env.DB.prepare(
        "UPDATE orders SET download_count = download_count + 1 WHERE id = ?",
      )
        .bind(order.id)
        .run();
    return response;
  }
  if (request.method === "GET" && path === "/samples/fundamentals.pdf")
    return pdf(env, "fundamentals");
  if (request.method === "POST" && path === "/api/subscribe") {
    await rateLimit(request, env, "subscribe", 6);
    const input = await body(request);
    const email = cleanEmail(input.email);
    if (!kits.some((k) => k.id === input.kitId) || input.consent !== true)
      fail(400, "Choose a kit and confirm the notification request.");
    await env.DB.prepare(
      "INSERT OR IGNORE INTO subscribers (id, email, kit_id, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), email, input.kitId, now())
      .run();
    return json(
      { message: "You are on the list. Your interest has been saved." },
      201,
    );
  }
  if (request.method === "POST" && path === "/api/support") {
    await rateLimit(request, env, "support", 5);
    const input = await body(request);
    const email = cleanEmail(input.email);
    const subject =
      typeof input.subject === "string" ? input.subject.trim() : "";
    const message =
      typeof input.message === "string" ? input.message.trim() : "";
    if (
      subject.length < 3 ||
      subject.length > 120 ||
      message.length < 15 ||
      message.length > 4000
    )
      fail(400, "Add a subject and a message between 15 and 4,000 characters.");
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO support_requests (id, email, subject, message, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(id, email, subject, message, now())
      .run();
    return json(
      {
        reference: id,
        message:
          "Your request has been received. Keep this reference for follow-up.",
      },
      201,
    );
  }
  // Only explicitly public paths reach the asset binding. Full PDFs have no public route.
  if (request.method === "GET" || request.method === "HEAD") {
    if (
      path === "/" ||
      path === "/index.html" ||
      /^\/assets\/[A-Za-z0-9_.-]+$/.test(path) ||
      /^\/covers\/[a-z-]+\.png$/.test(path) ||
      ["/favicon.svg", "/robots.txt"].includes(path)
    )
      return env.ASSETS.fetch(request);
  }
  return json({ error: "Page not found." }, 404);
}
async function pdf(env, id) {
  const file = await env.DB.prepare(
    "SELECT object_key, byte_size, sha256 FROM kit_files WHERE kit_id = ?",
  )
    .bind(id)
    .first();
  const asset = file ? await env.PDFS.get(file.object_key) : null;
  if (!asset || asset.size !== file.byte_size)
    fail(
      503,
      "This PDF is temporarily unavailable. Contact support with your purchase reference.",
    );
  return new Response(asset.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(asset.size),
      "Content-Disposition": `attachment; filename="PrepTrick-${id}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
function secure(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.razorpay.com; font-src 'self'; connect-src 'self' https://*.razorpay.com; frame-src https://*.razorpay.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
export default {
  async fetch(request, env) {
    try {
      return secure(await route(request, env));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500)
        console.error(
          JSON.stringify({
            event: "request_failed",
            path: new URL(request.url).pathname,
            type: error.name,
          }),
        );
      const response = json(
        {
          error:
            status === 500
              ? "Something went wrong. Please retry or contact support."
              : error.message,
        },
        status,
      );
      if (status === 429) response.headers.set("Retry-After", "600");
      return secure(response);
    }
  },
  async scheduled(_event, env) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(
        now(),
      ),
      env.DB.prepare("DELETE FROM webhook_events WHERE created_at < ?").bind(
        now() - 90 * 86400,
      ),
      env.DB.prepare("DELETE FROM subscribers WHERE created_at < ?").bind(
        now() - 180 * 86400,
      ),
    ]);
  },
};
