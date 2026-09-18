CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  kit_id TEXT NOT NULL,
  email TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'refunded')),
  provider_order_id TEXT UNIQUE,
  provider_payment_id TEXT UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX orders_email ON orders(email);
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  kit_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(email, kit_id)
);
CREATE TABLE support_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
