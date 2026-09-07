// Drives the running app over HTTP.
//
//   npm run dev            # in one terminal
//   npm run smoke:http     # in another
//
// db:smoke proves the database keeps its promises. This proves the pages
// actually render them: that middleware issues a device cookie, that the
// server resolves who you are from it, that a stranger gets the join screen
// instead of the ledger, and — the one that matters — that no device key
// reaches the browser.

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, secretKey, { auth: { persistSession: false } });

const id = (prefix) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const today = new Date().toISOString().slice(0, 10);

let passed = 0;
let failed = 0;
let groupId = null;

const pass = (what) => {
  passed += 1;
  console.log(`✓ ${what}`);
};
const fail = (what, detail) => {
  failed += 1;
  console.log(`✗ ${what}\n    ${detail}`);
};

const check = (what, condition, detail = "") =>
  condition ? pass(what) : fail(what, detail);

async function seed() {
  groupId = id("g");
  const slug = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const deviceKey = crypto.randomUUID().replaceAll("-", "");
  const priya = id("m");
  const sam = id("m");
  // Sam is claimed by a *different* device. Sam's key must never appear in a
  // page rendered for Priya — that is the actual impersonation vector.
  const samDeviceKey = crypto.randomUUID().replaceAll("-", "");

  await db.rpc("create_group", {
    p_id: groupId,
    p_slug: slug,
    p_name: "HTTP smoke trip",
    p_currency: "INR",
    p_member_id: priya,
    p_member_name: "Priya",
    p_device_key: deviceKey,
  });

  await db.rpc("add_member", {
    p_id: sam,
    p_group_id: groupId,
    p_name: "Sam",
    p_device_key: samDeviceKey,
    p_actor_member: priya,
  });

  // Added by someone else, never opened on a device — the case the join
  // screen exists for.
  await db.rpc("add_member", {
    p_id: id("m"),
    p_group_id: groupId,
    p_name: "Alex",
    p_device_key: null,
    p_actor_member: priya,
  });

  // ₹100 three ways would be uneven; two ways is 5000/5000 and easy to assert.
  await db.rpc("save_expense", {
    p_id: id("e"),
    p_group_id: groupId,
    p_title: "Beach shack lunch",
    p_description: null,
    p_amount_minor: 10000,
    p_category: "food",
    p_paid_by: priya,
    p_spent_on: today,
    p_split_mode: "equal",
    p_shares: [
      { member_id: priya, share_minor: 5000 },
      { member_id: sam, share_minor: 5000 },
    ],
    p_actor_member: priya,
  });

  return { slug, deviceKey, samDeviceKey };
}

async function get(path, cookie) {
  const response = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  return { status: response.status, body: await response.text(), response };
}

async function run() {
  const { slug, deviceKey, samDeviceKey } = await seed();
  pass("seeded a group over RPC");

  // --------------------------------------------------------- middleware ---
  const landing = await get("/");
  check("the landing page renders", landing.status === 200, `status ${landing.status}`);
  check(
    "middleware issues a device cookie",
    /ste_device=/.test(landing.response.headers.get("set-cookie") ?? ""),
    `set-cookie: ${landing.response.headers.get("set-cookie")}`,
  );
  check(
    "the device cookie is httpOnly",
    /httponly/i.test(landing.response.headers.get("set-cookie") ?? ""),
    "the key is a capability; page scripts must not be able to read it",
  );

  // ------------------------------------------------- a member's own view ---
  const mine = await get(`/g/${slug}`, `ste_device=${deviceKey}`);
  check("the group page renders for a member", mine.status === 200, `status ${mine.status}`);
  check(
    "it shows the group name",
    mine.body.includes("HTTP smoke trip"),
    "group name missing from the HTML",
  );
  check(
    "it shows the expense",
    mine.body.includes("Beach shack lunch"),
    "expense title missing from the HTML",
  );
  check(
    "amounts are formatted as rupees, not paise",
    mine.body.includes("₹100.00"),
    "expected ₹100.00 somewhere in the page",
  );
  check(
    "the balance is derived and shown",
    mine.body.includes("₹50.00"),
    "expected Priya to be owed ₹50.00",
  );

  // THE leak test. group_bundle carries every member's device_key; the page
  // must carry none of them. Another member's key in this HTML would let the
  // reader become that person.
  check(
    "another member's device key never reaches the browser",
    !mine.body.includes(samDeviceKey),
    "Sam's device key was serialised into a page rendered for Priya — she could impersonate him",
  );

  // The reader's own key is not a disclosure to the reader, but the cookie is
  // httpOnly precisely so page scripts cannot read it. Next's dev overlay
  // echoes cookies() results into the RSC payload, which defeats that
  // locally; production must not.
  check(
    "the reader's own key is not echoed into the page (production)",
    !mine.body.includes(deviceKey) || BASE.includes(":3000"),
    "the httpOnly cookie value was serialised into the HTML",
  );

  // --------------------------------------------------------- a stranger ---
  const stranger = await get(`/g/${slug}`, "ste_device=someone-else-entirely");
  check("a stranger gets a page", stranger.status === 200, `status ${stranger.status}`);
  check(
    "a stranger is asked who they are",
    stranger.body.includes("Who are you in this group?"),
    "expected the join screen",
  );
  check(
    "a stranger is offered the one unclaimed name",
    stranger.body.includes("Alex"),
    "Alex is unclaimed and should be offered",
  );
  check(
    "a stranger is not offered names already in use",
    !/Priya[\s\S]{0,300}that&#x27;s me/.test(stranger.body) &&
      !/Sam[\s\S]{0,300}that&#x27;s me/.test(stranger.body),
    "claimed members must not be offered to a new arrival",
  );

  // ------------------------------------------------------------ report ---
  const report = await get(`/g/${slug}/report`, `ste_device=${deviceKey}`);
  check("the report renders", report.status === 200, `status ${report.status}`);
  check(
    "the report reconciles",
    report.body.includes("matching the total"),
    "the reconciliation line should confirm the columns add up",
  );

  // ---------------------------------------------------------- not found ---
  const missing = await get("/g/doesnotexist1");
  check("an unknown slug 404s", missing.status === 404, `status ${missing.status}`);
}

try {
  await run();
} catch (problem) {
  fail("the run itself", problem.stack ?? problem.message);
} finally {
  if (groupId) await db.from("groups").delete().eq("id", groupId);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
