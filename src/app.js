import {
  createIcons,
  Asterisk,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Search,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  CheckCheck,
  Download,
  FileText,
  BookOpen,
  LibraryBig,
  ShieldCheck,
  CheckCircle2,
  LockKeyhole,
  Mail,
  Plus,
  Copy,
  RefreshCw,
  Trash2,
  Code2,
  Layers,
  BrainCircuit,
  Network,
  PanelsTopLeft,
  Database,
  MoveUpRight,
  CircleHelp,
  LoaderCircle,
} from "lucide";
import { kits as initialKits, money } from "./catalog.js";
import "./styles.css";

const iconSet = {
  Asterisk,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Search,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  CheckCheck,
  Download,
  FileText,
  BookOpen,
  LibraryBig,
  ShieldCheck,
  CheckCircle2,
  LockKeyhole,
  Mail,
  Plus,
  Copy,
  RefreshCw,
  Trash2,
  Code2,
  Layers,
  BrainCircuit,
  Network,
  PanelsTopLeft,
  Database,
  MoveUpRight,
  CircleHelp,
  LoaderCircle,
};
const icon = (name, cls = "") => `<i data-lucide="${name}" class="${cls}"></i>`;
const icons = () =>
  createIcons({
    icons: iconSet,
    attrs: { "stroke-width": 1.7, "aria-hidden": "true" },
  });
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const main = document.querySelector("main");
const modal = document.querySelector("#modal");
const modalContent = document.querySelector("#modal-content");
let state = {
  kits: initialKits,
  checkoutEnabled: false,
  loaded: false,
  apiError: false,
  category: "All kits",
  level: "All experience",
  query: "",
  sort: "recommended",
  questions: [],
  questionQuery: "",
  questionTopic: "All topics",
};
let lastFocus;
let toastTimer;
let libraryVersion = 0;
const readStorage = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const storedReceipts = () => {
  const value = readStorage("preptrick-receipts", []);
  return Array.isArray(value)
    ? value.filter(
        (x) => typeof x.token === "string" && /^[a-f0-9]{64}$/.test(x.token),
      )
    : [];
};
function saveReceipt(value) {
  const receipts = storedReceipts().filter((x) => x.token !== value.token);
  localStorage.setItem(
    "preptrick-receipts",
    JSON.stringify([...receipts, value]),
  );
}
function toast(message) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("visible"), 5000);
}
async function api(path, { token, ...options } = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error || "The request could not be completed.");
  return result;
}
function openModal(html) {
  lastFocus = document.activeElement;
  modalContent.innerHTML = html;
  if (!modal.open) modal.showModal();
  document.body.classList.add("modal-open");
  icons();
}
function closeModal() {
  modal.close();
}
modal.addEventListener("close", () => {
  document.body.classList.remove("modal-open");
  lastFocus?.focus();
});
modal.addEventListener("click", (event) => {
  if (event.target === modal) {
    const r = modal.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      closeModal();
  }
});
const closeButton = () =>
  `<button type="button" class="icon-button close-modal" data-action="close" aria-label="Close dialog" title="Close">${icon("x")}</button>`;

function card(kit) {
  return `<article class="kit-card">
    <a class="kit-visual ${kit.color}" href="#kit/${kit.id}" aria-label="View ${kit.title} kit"><span class="visual-label">${escape(kit.label)}</span><img src="/covers/${kit.id}.png" width="420" height="594" alt="${kit.title} PDF cover" ${kit.number > "03" ? 'loading="lazy"' : 'fetchpriority="high"'} /><span class="format-tag">${icon("file-text")}PDF KIT</span><span class="visual-arrow">${icon("arrow-up-right")}</span></a>
    <div class="kit-body"><div class="kit-meta"><span>${escape(kit.experience)}${kit.experience.includes("years") ? " experience" : ""}</span><span>${kit.questions} Q&As</span></div><h2><a href="#kit/${kit.id}">${escape(kit.title)}</a></h2><p>${escape(kit.description)}</p><div class="kit-bottom"><div class="price">${money(kit.price)}<span>one-time</span></div><a class="small-button" href="#kit/${kit.id}">View kit ${icon("arrow-up-right")}</a></div></div>
  </article>`;
}
function filteredKits() {
  const q = state.query.toLowerCase();
  return state.kits
    .filter(
      (k) =>
        (state.category === "All kits" || k.category === state.category) &&
        (state.level === "All experience" || k.level === state.level) &&
        `${k.title} ${k.description} ${k.topics.join(" ")}`
          .toLowerCase()
          .includes(q),
    )
    .sort((a, b) =>
      state.sort === "price-low"
        ? a.price - b.price
        : state.sort === "price-high"
          ? b.price - a.price
          : a.number.localeCompare(b.number),
    );
}
function grid() {
  const filtered = filteredKits();
  document.querySelector("#kit-grid").innerHTML = filtered.length
    ? filtered.map(card).join("")
    : `<div class="empty-state">${icon("search")}<h2>No kits found</h2><p>Try another topic or clear your filters.</p><button class="button" data-action="clear-filters">Clear filters</button></div>`;
  document.querySelector("#results-count").textContent =
    `${filtered.length} ${filtered.length === 1 ? "kit" : "kits"}`;
  icons();
}
function catalogPage() {
  main.innerHTML = `<section class="catalog-intro wrap"><div><p class="eyebrow"><span></span>PREPARE WITH PURPOSE</p><h1>Interview prep kits<span>.</span></h1><p class="intro-copy">Know the fundamentals. Understand the follow-ups.<br>Walk into your next interview with a clearer head.</p></div><div class="intro-note">${icon("book-open")}<div>Less searching.<br><strong>More understanding.</strong></div></div></section>
  <div class="trust-row wrap"><span>${icon("file-text")} Thoughtfully written Q&As</span><span>${icon("download")} PDFs to keep & revisit</span><span>${icon("check-check")} One purchase. No subscription.</span></div>
  <section class="catalog-layout wrap" aria-label="Browse interview kits">
    <aside class="filters"><div class="filter-heading"><h2>Find your focus</h2><button class="icon-button" data-action="clear-filters" title="Reset filters" aria-label="Reset filters">${icon("refresh-cw")}</button></div><fieldset><legend>BY DISCIPLINE</legend>${["All kits", "Engineering", "AI & Data", "System Design"].map((c, i) => `<label class="category-option"><input type="radio" name="category" value="${c}" ${state.category === c ? "checked" : ""}><span>${icon(["layers", "code-2", "brain-circuit", "network"][i])}${c}</span><small>${c === "All kits" ? 6 : initialKits.filter((k) => k.category === c).length}</small></label>`).join("")}</fieldset><fieldset class="level-filter"><legend>EXPERIENCE</legend>${["All experience", "Early career", "Experienced", "All levels"].map((c) => `<label class="radio-option"><input type="radio" name="level" value="${c}" ${state.level === c ? "checked" : ""}><span>${c}</span></label>`).join("")}</fieldset><div class="sidebar-sample"><div class="sample-icon">${icon("book-open")}</div><h3>Start with the basics.</h3><p>50 fundamental questions.<br>Clear answers. On us.</p><a href="/samples/fundamentals.pdf" download>Free starter PDF ${icon("download")}</a></div></aside>
    <div class="catalog-content"><div class="catalog-toolbar"><label class="search-box">${icon("search")}<input id="kit-search" type="search" placeholder="Search roles, skills, or topics" aria-label="Search interview kits" value="${escape(state.query)}"></label><label class="sort-box"><span>Sort:</span><select id="kit-sort" aria-label="Sort kits"><option value="recommended" ${state.sort === "recommended" ? "selected" : ""}>Recommended</option><option value="price-low" ${state.sort === "price-low" ? "selected" : ""}>Price: low to high</option><option value="price-high" ${state.sort === "price-high" ? "selected" : ""}>Price: high to low</option></select></label></div><div class="results-heading"><h2>Your next step starts here</h2><span id="results-count" aria-live="polite"></span></div>${state.apiError ? '<div class="inline-notice">The store is temporarily offline. You can still explore the catalog. <button data-action="reload">Retry</button></div>' : ""}<div class="kit-grid" id="kit-grid"></div><div class="catalog-footnote">${icon("circle-help")}Original practice material. No company affiliation or interview guarantees.</div></div>
  </section>
  <section class="fundamental-band"><div class="wrap"><div><p class="eyebrow">A GOOD PLACE TO BEGIN</p><h2>Strong answers start<br>with the fundamentals.</h2><a href="#fundamentals" class="button light-button">Practice free questions ${icon("arrow-up-right")}</a></div><div class="sample-question"><span>QUESTION 01 / 50</span><h3>What does Big O tell you,<br>and what does it leave out?</h3><p>Go beyond the definition. Learn the reasoning, then try a follow-up.</p><a href="#fundamentals" aria-label="Read the Big O answer">${icon("arrow-right")}</a></div></div></section>
  <section class="faq-section wrap"><div><p class="eyebrow">BEFORE YOU BEGIN</p><h2>A few good questions.</h2><p>The practical details, answered.</p></div><div>${[
    [
      "What is included in a kit?",
      "Each PDF contains original interview practice questions, model answers, follow-up prompts, and a practice worksheet. You can preview three questions on every kit page before deciding.",
    ],
    [
      "How do I receive my PDF?",
      "After a verified payment, your PDF becomes available in My library. Save the recovery code shown with your purchase so you can restore it on another browser. No email delivery is promised.",
    ],
    [
      "Are these actual company interview questions?",
      "These are independently written practice questions covering common engineering topics. They are not claimed to be collected from any company, and purchasing a kit does not guarantee an offer.",
    ],
    [
      "Can I read the kit on my phone?",
      "Yes. The kits are downloadable PDFs that open in a normal PDF reader on a phone, tablet, or computer. You may also print a copy for your own study.",
    ],
    [
      "Are paid kits available now?",
      state.checkoutEnabled
        ? "Checkout is available through Razorpay. The final amount is shown before payment, and your download unlocks after payment is confirmed."
        : "Paid checkout is being prepared. All prices and previews are available now, and the free fundamentals PDF is ready to download.",
    ],
  ]
    .map(
      ([q, a]) =>
        `<details><summary>${q}${icon("plus")}</summary><p>${a}</p></details>`,
    )
    .join("")}</div></section>`;
  grid();
}

function kitPage(id) {
  const kit = state.kits.find((k) => k.id === id);
  if (!kit) {
    main.innerHTML = `<section class="wrap page-heading"><h1>Kit not found.</h1><a class="button" href="#kits">Browse all kits</a></section>`;
    return;
  }
  main.innerHTML = `<section class="wrap detail-page"><a class="back-link" href="#kits">${icon("arrow-left")}All interview kits</a><div class="detail-grid"><div class="detail-cover ${kit.color}"><img src="/covers/${kit.id}.png" alt="${kit.title} PDF cover" width="420" height="594"><span>${icon("file-text")}${kit.questions} questions & answers</span></div><div class="detail-copy"><p class="eyebrow">${escape(kit.category)} / KIT ${kit.number}</p><h1>${escape(kit.title)}</h1><p class="detail-subtitle">${escape(kit.subtitle)}</p><p>${escape(kit.description)}</p><div class="detail-tags"><span>${escape(kit.experience)}</span><span>PDF download</span><span>English</span></div><h2>Inside this kit</h2><ul class="included-list">${kit.topics.map((t) => `<li>${icon("check")}${escape(t)}</li>`).join("")}<li>${icon("check")}Follow-up prompts & practice worksheet</li></ul><div class="purchase-row"><div class="price">${money(kit.price)}<span>one-time purchase</span></div>${state.checkoutEnabled ? `<button class="button" data-action="checkout" data-id="${id}">Get this kit${icon("arrow-up-right")}</button>` : `<a class="button" href="/samples/fundamentals.pdf" download>Download free sample${icon("download")}</a>`}</div><p class="purchase-note">${icon(state.checkoutEnabled ? "shield-check" : "circle-help")}${state.checkoutEnabled ? "Secure payment via Razorpay. No subscription." : "Paid checkout opens soon. Preview the content below."}</p></div></div><section class="preview-section"><div><p class="eyebrow">A LOOK INSIDE</p><h2>Try a few questions.</h2><p>A sample from this kit, with the full answers.</p><a href="/samples/fundamentals.pdf" class="text-button" download>Download free fundamentals ${icon("download")}</a></div><div>${kit.samples ? kit.samples.map((q, i) => questionRow(q, i, false)).join("") : `<p>${state.apiError ? "Samples could not load. Please retry." : "Loading sample answers..."}</p><button class="small-button" data-action="reload">Refresh ${icon("refresh-cw")}</button>`}</div></section></section>`;
  icons();
}
function questionRow(question, index, practice = true) {
  const [topic, title, answer, followUp] = question;
  const completed = readStorage("preptrick-practice", []);
  return `<details class="question-row"><summary><span class="question-index">${String(index + 1).padStart(2, "0")}</span><span><small>${escape(topic)}</small>${escape(title)}</span>${icon("plus")}</summary><div class="question-answer"><p>${escape(answer)}</p><div class="follow-up"><strong>Take it one step further</strong><p>${escape(followUp)}</p></div>${practice ? `<label class="practice-check"><input type="checkbox" data-practice="${index}" ${Array.isArray(completed) && completed.includes(index) ? "checked" : ""}>I've practiced this answer</label>` : ""}</div></details>`;
}
async function fundamentalsPage() {
  main.innerHTML = `<section class="wrap free-page"><a class="back-link" href="#kits">${icon("arrow-left")}Back to kits</a><div class="free-heading"><div><p class="eyebrow">THE FREE STARTER COLLECTION</p><h1>Get the basics right<span>.</span></h1><p>50 questions worth understanding, wherever you are in your career.</p></div><a class="button" href="/samples/fundamentals.pdf" download>Download PDF ${icon("download")}</a></div><div class="practice-toolbar"><label class="search-box">${icon("search")}<input id="question-search" type="search" placeholder="Find a question" aria-label="Search free questions" value="${escape(state.questionQuery)}"></label><label class="sort-box"><select id="question-topic" aria-label="Filter by topic"><option>All topics</option>${["Foundations", "Object-oriented design", "Databases", "Web essentials"].map((t) => `<option ${state.questionTopic === t ? "selected" : ""}>${t}</option>`).join("")}</select></label><span class="practice-progress" id="practice-progress"></span></div><div id="question-list"><div class="loading-state">${icon("loader-circle", "spin")}Loading questions...</div></div><div class="free-bottom"><p>Ready to focus on a specific role?</p><a href="#kits" class="text-button">Explore the full kits ${icon("arrow-up-right")}</a></div></section>`;
  icons();
  try {
    if (!state.questions.length)
      state.questions = (await api("/api/fundamentals")).questions;
    if (document.querySelector("#question-list")) questionList();
  } catch (error) {
    if (document.querySelector("#question-list"))
      document.querySelector("#question-list").innerHTML =
        `<div class="empty-state"><h2>Questions could not load</h2><p>${escape(error.message)}</p><button class="button" data-action="reload">Try again</button></div>`;
  }
}
function questionList() {
  const filtered = state.questions
    .map((q, i) => ({ q, i }))
    .filter(
      ({ q }) =>
        (state.questionTopic === "All topics" ||
          q[0] === state.questionTopic) &&
        q.join(" ").toLowerCase().includes(state.questionQuery.toLowerCase()),
    );
  document.querySelector("#question-list").innerHTML = filtered.length
    ? filtered.map(({ q, i }) => questionRow(q, i)).join("")
    : '<div class="empty-state"><h2>No matching questions</h2><p>Try a different topic or search.</p></div>';
  progress();
  icons();
}
function progress() {
  const value = readStorage("preptrick-practice", []);
  const completed = Array.isArray(value)
    ? value.filter(
        (x) => Number.isInteger(x) && x >= 0 && x < state.questions.length,
      )
    : [];
  const element = document.querySelector("#practice-progress");
  if (element)
    element.textContent = `${completed.length} / ${state.questions.length} practiced`;
}

async function libraryPage() {
  const version = ++libraryVersion;
  main.innerHTML = `<section class="wrap library-page"><div class="free-heading"><div><p class="eyebrow">YOUR NEXT CHAPTER</p><h1>My library<span>.</span></h1><p>Your purchases, ready when you are.</p></div><button class="small-button" data-action="refresh-library">${icon("refresh-cw")}Refresh</button></div><form id="restore-form" class="restore-form"><label for="recovery-code">Restore a purchase on this device</label><div><input type="password" id="recovery-code" name="code" required pattern="[a-f0-9]{64}" autocomplete="off" placeholder="Enter your 64-character recovery code" aria-describedby="recovery-help"><button class="button" type="submit">Restore ${icon("arrow-right")}</button></div><p id="recovery-help">Your code is private and gives access to your purchase. Keep a copy somewhere safe.</p><p class="form-error" role="alert"></p></form><div id="library-list"></div></section>`;
  const receipts = storedReceipts();
  const list = document.querySelector("#library-list");
  if (!receipts.length)
    list.innerHTML = `<div class="empty-state library-empty"><span class="empty-icon">${icon("library-big")}</span><h2>A little space for your next big step.</h2><p>Your purchased kits will appear here.<br>Start by exploring the collection or trying the free starter PDF.</p><a class="button" href="#kits">Explore interview kits ${icon("arrow-up-right")}</a><a class="text-button" href="/samples/fundamentals.pdf" download>Download free fundamentals ${icon("download")}</a></div>`;
  else {
    list.innerHTML =
      '<div class="loading-state">Loading your purchases...</div>';
    const results = await Promise.allSettled(
      receipts.map((r) => api("/api/receipt", { token: r.token })),
    );
    if (version !== libraryVersion || !document.querySelector("#library-list"))
      return;
    list.innerHTML = results
      .map((result, i) => {
        const saved = receipts[i];
        if (result.status === "rejected")
          return `<article class="library-item"><div><h2>Purchase could not refresh</h2><p>${escape(result.reason.message)}</p></div><button class="small-button" data-action="refresh-library">Retry ${icon("refresh-cw")}</button><button class="icon-button" data-action="copy-code" data-token="${saved.token}" title="Copy recovery code" aria-label="Copy recovery code">${icon("copy")}</button></article>`;
        const order = result.value.order;
        const kit = state.kits.find((k) => k.id === order.kitId);
        return `<article class="library-item"><img src="/covers/${order.kitId}.png" width="80" height="113" alt="${escape(kit?.title)} cover"><div class="library-item-info"><span class="status-tag ${order.status}">${order.status === "paid" ? "Ready to download" : order.status === "refunded" ? "Refunded" : "Awaiting payment"}</span><h2>${escape(kit?.title || order.kitId)}</h2><p>${money(order.amount)} · ${new Date(order.createdAt * 1000).toLocaleDateString("en-IN")}</p><small>Reference: ${escape(order.id)}</small></div><div class="library-actions">${order.status === "paid" ? `<button class="button" data-action="download" data-id="${order.kitId}" data-token="${saved.token}">Download PDF ${icon("download")}</button>` : `<button class="small-button" data-action="refresh-library">Check payment ${icon("refresh-cw")}</button>`}<button class="text-button" data-action="copy-code" data-token="${saved.token}">Copy recovery code ${icon("copy")}</button><button class="muted-button" data-action="remove-receipt" data-token="${saved.token}">Remove from this browser</button></div></article>`;
      })
      .join("");
  }
  icons();
}

function checkout(id) {
  const kit = state.kits.find((k) => k.id === id);
  if (!state.loaded || state.apiError) {
    toast("The store is still connecting. Please retry shortly.");
    return;
  }
  if (!kit) return;
  if (!state.checkoutEnabled) {
    toast(
      "Paid checkout is not available yet. The free sample is ready to download.",
    );
    return;
  }
  openModal(
    `${closeButton()}<p class="eyebrow">ONE STEP CLOSER</p><h2 id="modal-title">Make it yours.</h2><div class="checkout-product"><img src="/covers/${id}.png" alt="" width="60" height="85"><div><h3>${kit.title}</h3><p>${kit.questions} Q&As · PDF download</p></div><strong>${money(kit.price)}</strong></div><p class="modal-description">After payment, download your kit from My library. Save your recovery code for access on another device.</p><form id="checkout-form" data-id="${id}"><label class="field-label" for="checkout-email">Email address</label><input id="checkout-email" name="email" type="email" maxlength="254" autocomplete="email" required placeholder="you@example.com"><label class="consent"><input type="checkbox" name="consent" required><span>I agree to the Terms and Refunds & delivery policy linked in the footer.</span></label><p class="form-error" role="alert"></p><button class="button full" type="submit">Continue to pay ${money(kit.price)}${icon("lock-keyhole")}</button></form><p class="secure-note">Payments processed by Razorpay.</p>`,
  );
}
let razorpayLoading;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (!razorpayLoading)
    razorpayLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve();
      script.onerror = () => {
        razorpayLoading = null;
        script.remove();
        reject(Error("Payment checkout could not load. Please retry."));
      };
      document.head.append(script);
    });
  return razorpayLoading;
}
async function performCheckout(form) {
  const data = new FormData(form);
  const email = data.get("email");
  const kitId = form.dataset.id;
  if (!state.checkoutEnabled)
    throw Error("Paid checkout is not available yet.");
  await loadRazorpay();
  // A durable local recovery code is required before opening the payment provider.
  try {
    localStorage.setItem("preptrick-storage-check", "1");
    localStorage.removeItem("preptrick-storage-check");
  } catch {
    throw Error(
      "Allow browser storage before purchasing so your recovery code can be saved.",
    );
  }
  const order = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({ email, kitId, acceptTerms: true }),
  });
  saveReceipt({ token: order.token, kitId });
  closeModal();
  const payment = new window.Razorpay({
    key: order.keyId,
    amount: order.amount,
    currency: order.currency,
    name: "PrepTrick",
    description: state.kits.find((k) => k.id === kitId).title,
    order_id: order.providerOrderId,
    prefill: { email },
    theme: { color: "#173d32" },
    handler: async (result) => {
      try {
        await api("/api/verify", {
          method: "POST",
          token: order.token,
          body: JSON.stringify(result),
        });
        toast("Payment confirmed. Your kit is ready.");
      } catch (error) {
        toast(`${error.message} Your recovery code is saved in My library.`);
      }
      location.hash = "library";
      if (document.querySelector("#library-list")) libraryPage();
    },
    modal: {
      ondismiss: () => {
        toast(
          "Checkout closed. You can check the purchase status in My library.",
        );
        location.hash = "library";
      },
    },
  });
  payment.on("payment.failed", () =>
    toast("Payment was not completed. Check My library before trying again."),
  );
  payment.open();
}

const policies = {
  about: {
    title: "About PrepTrick",
    content:
      '<h3>Focused preparation for engineering interviews</h3><p>PrepTrick publishes original interview-preparation PDFs for software engineering, frontend, backend, AI, and system design. Each kit contains 50 questions, suggested answers, follow-up prompts, and a practice worksheet.</p><h3>Digital study material</h3><p>Kits are downloadable PDFs in English, priced individually in Indian rupees. There is no subscription and no physical shipment. A free fundamentals collection is available to read and download before purchasing.</p><h3>Independent and practical</h3><p>The material covers common engineering concepts and trade-offs. It is not affiliated with an employer and does not guarantee particular interview questions or hiring outcomes.</p><p><a class="text-button" href="/pricing">Browse kits and pricing</a></p>',
  },
  privacy: {
    title: "Privacy",
    content:
      "<h3>What we keep</h3><p>PrepTrick stores purchase emails, kit selections, payment references, purchase status, support requests, and optional launch-interest requests. Card and UPI credentials are handled by Razorpay, not by PrepTrick.</p><h3>Where it is processed</h3><p>The website and database run on Cloudflare. Razorpay processes checkout and payment verification. Your browser stores purchase recovery codes and practice progress. Recovery codes give access to purchases, so keep them private.</p><h3>Your choices</h3><p>Launch registration is optional and separate from purchasing. Launch-interest records expire after 180 days. You can remove local purchases from My library, clear browser data, or contact support to request access, correction, or deletion of stored information. Transaction records may need to be retained for accounting or dispute resolution.</p><h3>Operational data</h3><p>We use short-lived hashed IP rate-limit records to reduce abuse. No advertising analytics are installed. Hosting and payment providers may process operational logs according to their own policies.</p>",
  },
  terms: {
    title: "Terms of use",
    content:
      "<h3>The material</h3><p>Kits contain original educational practice questions, suggested answers, and follow-up prompts in English. They are independent of employers and are not a guarantee of interview questions, hiring outcomes, or professional certification.</p><h3>Your purchase</h3><p>The displayed INR price is the total charged for one personal-use PDF kit. There is no subscription. Review the preview and experience level before purchasing. Paid access starts only after the payment provider confirms capture.</p><h3>Personal study license</h3><p>You may download, store, and print the purchased kit for your own study. You may not resell, redistribute, or publish the full material without permission. Content may be corrected over time; the purchased edition remains downloadable while the service is available.</p><h3>Access and support</h3><p>Keep your recovery code to restore access on another device. Do not share it publicly. For technical problems, lost access, corrections, or purchase disputes, use the support form. These terms do not exclude rights that cannot legally be excluded.</p>",
  },
  refunds: {
    title: "Refunds & delivery",
    content:
      "<h3>Digital delivery</h3><p>This is a digital PDF product. No physical item is shipped. After payment is captured and verified, download the kit from My library. If confirmation is delayed, refresh your library; avoid paying again until the original payment status is resolved.</p><h3>Getting help</h3><p>For duplicate charges, an unavailable download, or a materially incorrect product, contact support promptly with the purchase reference and a description. Please submit requests within 7 days where possible; this does not limit mandatory consumer rights. Do not send card numbers, passwords, or API secrets.</p><h3>Review and refunds</h3><p>Requests are reviewed individually. Approved refunds are processed through the original payment provider, and the bank or provider controls processing time. A refunded purchase loses future download access. A change of mind after downloading is assessed case by case rather than automatically approved.</p><h3>Before checkout opens</h3><p>Paid checkout is not yet available. The free fundamentals PDF can be downloaded immediately.</p>",
  },
};
function policy(name) {
  if (policies[name]) location.href = `/${name}`;
}
function informationPage(name) {
  const page = policies[name];
  if (name === "contact") {
    document.title = "Contact PrepTrick";
    main.innerHTML = `<section class="wrap information-page"><a class="back-link" href="/#kits">${icon("arrow-left")}All interview kits</a><p class="eyebrow">PREPTRICK / CUSTOMER SUPPORT</p><h1>Get in touch.</h1>${supportForm()}</section>`;
    return;
  }
  document.title = `${page.title} | PrepTrick`;
  main.innerHTML = `<section class="wrap information-page"><a class="back-link" href="/#kits">${icon("arrow-left")}All interview kits</a><p class="eyebrow">PREPTRICK / THE DETAILS</p><h1>${page.title}</h1><div class="policy-content">${page.content}</div><a class="text-button" href="/contact">Contact support ${icon("arrow-up-right")}</a></section>`;
}
function supportForm() {
  return `<p class="modal-description">A purchase question, a content correction, or a kit you'd like to see. Send it our way.</p><form id="support-form"><label class="field-label" for="support-email">Email address</label><input id="support-email" name="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"><label class="field-label" for="support-subject">Subject</label><input id="support-subject" name="subject" required minlength="3" maxlength="120" placeholder="How can we help?"><label class="field-label" for="support-message">Message</label><textarea id="support-message" name="message" rows="5" required minlength="15" maxlength="4000" placeholder="Include your purchase reference if you have one. Never share your recovery code or payment credentials."></textarea><p class="form-hint">We store your message and email to handle this request.</p><p class="form-error" role="alert"></p><button class="button full" type="submit">Send request ${icon("arrow-up-right")}</button></form>`;
}
function support() {
  const existing = main.querySelector("#support-email");
  if (existing) {
    existing.focus();
    return;
  }
  openModal(
    `${closeButton()}<p class="eyebrow">WE'RE HERE TO HELP</p><h2 id="modal-title">Get in touch.</h2>${supportForm()}`,
  );
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id, token } = button.dataset;
  if (action === "close") closeModal();
  if (action === "checkout") checkout(id);
  if (action === "support") support();
  if (action === "policy") policy(button.dataset.policy);
  if (action === "reload") {
    await loadCatalog();
    render();
  }
  if (action === "clear-filters") {
    Object.assign(state, {
      query: "",
      category: "All kits",
      level: "All experience",
      sort: "recommended",
    });
    catalogPage();
  }
  if (action === "refresh-library") libraryPage();
  if (action === "copy-code") {
    try {
      await navigator.clipboard.writeText(token);
      toast(
        "Recovery code copied. Keep it private and save it somewhere safe.",
      );
    } catch {
      openModal(
        `${closeButton()}<h2 id="modal-title">Your recovery code</h2><p>Keep this private. Anyone with this code can access your purchase.</p><textarea class="code-field" readonly>${token}</textarea>`,
      );
    }
  }
  if (action === "remove-receipt")
    openModal(
      `${closeButton()}<h2 id="modal-title">Remove from this browser?</h2><p>Save your recovery code first. This removes local access, not your purchase.</p><button class="text-button" data-action="copy-code" data-token="${token}">Copy recovery code ${icon("copy")}</button><button class="button full" data-action="confirm-remove" data-token="${token}">Remove local access</button>`,
    );
  if (action === "confirm-remove") {
    try {
      localStorage.setItem(
        "preptrick-receipts",
        JSON.stringify(storedReceipts().filter((x) => x.token !== token)),
      );
      closeModal();
      libraryPage();
    } catch {
      toast("Browser storage could not be updated.");
    }
  }
  if (action === "download") {
    button.disabled = true;
    try {
      const response = await fetch(`/downloads/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `PrepTrick-${id}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast("Your PDF download has started.");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "kit-search") {
    state.query = event.target.value;
    grid();
  }
  if (event.target.id === "question-search") {
    state.questionQuery = event.target.value;
    questionList();
  }
});
document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.name === "category") {
    state.category = target.value;
    grid();
  }
  if (target.name === "level") {
    state.level = target.value;
    grid();
  }
  if (target.id === "kit-sort") {
    state.sort = target.value;
    grid();
  }
  if (target.id === "question-topic") {
    state.questionTopic = target.value;
    questionList();
  }
  if (target.hasAttribute("data-practice")) {
    const current = readStorage("preptrick-practice", []);
    const list = new Set(Array.isArray(current) ? current : []);
    target.checked
      ? list.add(Number(target.dataset.practice))
      : list.delete(Number(target.dataset.practice));
    try {
      localStorage.setItem("preptrick-practice", JSON.stringify([...list]));
    } catch {
      toast("Practice progress could not be saved in this browser.");
    }
    progress();
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!["checkout-form", "support-form", "restore-form"].includes(form.id))
    return;
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  const errorNode = form.querySelector(".form-error");
  errorNode.textContent = "";
  submit.disabled = true;
  submit.setAttribute("aria-busy", "true");
  try {
    if (form.id === "checkout-form") await performCheckout(form);
    if (form.id === "support-form") {
      const result = await api("/api/support", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      openModal(
        `${closeButton()}<span class="success-icon">${icon("check-circle-2")}</span><h2 id="modal-title">Request received.</h2><p>${escape(result.message)}</p><p class="reference">Reference: ${escape(result.reference)}</p><button class="button full" data-action="close">Done ${icon("check")}</button>`,
      );
    }
    if (form.id === "restore-form") {
      const token = new FormData(form).get("code").trim();
      const { order } = await api("/api/receipt", { token });
      saveReceipt({ token, kitId: order.kitId });
      toast("Purchase restored to this browser.");
      libraryPage();
    }
  } catch (error) {
    errorNode.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.removeAttribute("aria-busy");
  }
});
async function loadCatalog() {
  try {
    const result = await api("/api/catalog");
    state.kits = result.kits;
    state.checkoutEnabled = result.checkoutEnabled;
    state.apiError = false;
    state.loaded = true;
  } catch {
    state.apiError = true;
    state.loaded = true;
  }
}
function render() {
  if (modal.open) closeModal();
  const route = location.hash.slice(1) || location.pathname.slice(1) || "kits";
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const current =
      a.dataset.nav === route ||
      (a.dataset.nav === "kits" && route.startsWith("kit/"));
    a.classList.toggle("active", current);
    if (current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (Object.hasOwn(policies, route) || route === "contact") {
    informationPage(route);
  } else if (route === "fundamentals") {
    document.title = "Free interview questions | PrepTrick";
    fundamentalsPage();
  } else if (route === "library") {
    document.title = "My library | PrepTrick";
    libraryPage();
  } else if (route.startsWith("kit/")) {
    const id = route.split("/")[1];
    document.title = `${state.kits.find((k) => k.id === id)?.title || "Interview kit"} | PrepTrick`;
    kitPage(id);
  } else {
    document.title = "PrepTrick | Interview prep kits";
    catalogPage();
  }
  icons();
}
window.addEventListener("hashchange", () => {
  if (location.hash === "#main") {
    main.focus();
    main.scrollIntoView();
    return;
  }
  render();
  window.scrollTo({ top: 0 });
});
document.querySelector("#year").textContent = new Date().getFullYear();
render();
loadCatalog().then(() => {
  if (!modal.open) render();
});
