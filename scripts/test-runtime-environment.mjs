import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const root = await mkdtemp(path.resolve("node_modules/.environment-test-"));
const savedEnv = { ...process.env }, originalFetch = globalThis.fetch;
const dev = {
  BOFF_ENVIRONMENT: "development", BOFF_EXPECTED_PROJECT_REF: "whlcnlacueweaqpsupqs",
  SUPABASE_URL: "https://whlcnlacueweaqpsupqs.supabase.co",
  BOFF_APP_ORIGIN: "https://dev.sportsbook.coopergurrie.com",
  BOFF_MAIL_MODE: "capture", BOFF_AUTOMATION_MODE: "manual", VERCEL_ENV: "preview",
  BOFF_DEV_OWNER_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
};
function environment(values) {
  for (const key of Object.keys(process.env))
    if (/^(BOFF_|VITE_|SUPABASE_|VERCEL|RESEND_|NODE_ENV)/.test(key)) delete process.env[key];
  Object.assign(process.env, values);
}
let calls = [], marker, user;
globalThis.fetch = async (input) => {
  const url = String(input); calls.push(url);
  if (url.endsWith("/rest/v1/rpc/application_environment_identity"))
    return Response.json(marker);
  if (url.endsWith("/auth/v1/user")) return Response.json({ id: user });
  throw new Error("Unexpected test network access");
};
let db;
try {
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  for (const name of ["environment-policy", "server-client", "worker-auth"]) {
    const source = await readFile(`api/_lib/${name}.ts`, "utf8");
    await writeFile(path.join(root, name + ".js"), ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
    }).outputText);
  }
  const { createServerClient } = await import(pathToFileURL(path.join(root, "server-client.js")));
  const { isWorker } = await import(pathToFileURL(path.join(root, "worker-auth.js")));
  marker = { environment: "development", project_ref: dev.BOFF_EXPECTED_PROJECT_REF,
    app_origin: dev.BOFF_APP_ORIGIN };
  for (const change of [
    { BOFF_ENVIRONMENT: undefined }, { BOFF_EXPECTED_PROJECT_REF: "bmvjcdgxwxqalaohpsnw" },
    { SUPABASE_URL: "https://bmvjcdgxwxqalaohpsnw.supabase.co" },
    { VITE_SUPABASE_URL: "https://bmvjcdgxwxqalaohpsnw.supabase.co" },
    { VERCEL_ENV: "production" }, { BOFF_APP_ORIGIN: "https://wrong.example" },
    { BOFF_MAIL_MODE: "delivery" }, { BOFF_AUTOMATION_MODE: "scheduled" },
    { RESEND_API_KEY: "synthetic-live-key" },
  ]) {
    environment({ ...dev, ...change }); calls = [];
    await assert.rejects(createServerClient(process.env.SUPABASE_URL, "synthetic-key"));
    assert.equal(calls.length, 0, "Unsafe identity reached the network");
  }
  environment(dev); calls = [];
  const wrongJWT = `x.${Buffer.from(JSON.stringify({ ref: "bmvjcdgxwxqalaohpsnw" })).toString("base64url")}.x`;
  await assert.rejects(createServerClient(dev.SUPABASE_URL, wrongJWT));
  assert.equal(calls.length, 0);
  for (const bad of [null, {}, { ...marker, environment: "production" },
      { ...marker, app_origin: "https://wrong.example" }]) {
    const good = marker; marker = bad;
    await assert.rejects(createServerClient(dev.SUPABASE_URL, dev.SUPABASE_SERVICE_ROLE_KEY), /marker/);
    marker = good;
  }
  await createServerClient(dev.SUPABASE_URL, dev.SUPABASE_SERVICE_ROLE_KEY);
  // Auth checks apply to user clients even when the DB identity is correct.
  const options = { global: { headers: { Authorization: "Bearer fixture-token" } },
    auth: { persistSession: false, autoRefreshToken: false } };
  user = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await assert.rejects(createServerClient(dev.SUPABASE_URL, "synthetic-public", options), /owner/);
  user = dev.BOFF_DEV_OWNER_ID;
  await createServerClient(dev.SUPABASE_URL, "synthetic-public", options);
  process.env.WEEKLY_WORKER_SECRET = "independent-development-worker-secret";
  const req = (manual) => new Request("https://dev.example.invalid/api/weekly-worker", {
    headers: { "x-worker-secret": process.env.WEEKLY_WORKER_SECRET,
      ...(manual ? { "x-boff-manual-run": "true" } : {}) },
  });
  assert.equal(isWorker(req(false)), false);
  assert.equal(isWorker(req(true)), true);
  environment({ BOFF_ENVIRONMENT: "test", NODE_ENV: "test", VERCEL_ENV: "preview" });
  await assert.rejects(createServerClient("https://fixture.invalid", "fixture"), /local/);
  environment({ BOFF_ENVIRONMENT: "test", NODE_ENV: "test" });
  await assert.rejects(createServerClient(dev.SUPABASE_URL, "fixture"), /local/);

  // Real Postgres semantics for marker access and bounded capture, in memory.
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema sportsbook_private; create schema auth;
    create function auth.role() returns text language sql as $$
      select current_setting('request.jwt.claim.role',true) $$;
    create table public.outbound_emails(id uuid primary key,recipient text,ticket_id uuid,
      status text check(status in ('pending','sending','sent','failed','needs_review','skipped')),
      payload jsonb,provider_id text,sent_at timestamptz,last_error text,lease_until timestamptz);
    create table public.email_deliveries(ticket_id uuid primary key,
      status text check(status in ('pending','sent','failed')),provider_id text,
      sent_at timestamptz,last_error text);`);
  for (const file of ["202610280055_environment_identity.sql", "202610280056_development_mail_capture.sql"])
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  assert.equal((await rows("select application_environment_identity() as marker"))[0].marker, null);
  await rows("insert into sportsbook_private.application_environment(environment,project_ref,app_origin) values($1,$2,$3)",
    ["development", dev.BOFF_EXPECTED_PROJECT_REF, dev.BOFF_APP_ORIGIN]);
  await db.exec("set role anon");
  assert.deepEqual((await rows("select application_environment_identity() as marker"))[0].marker, marker);
  await assert.rejects(rows("select * from sportsbook_private.application_environment"));
  await assert.rejects(rows("select capture_development_email(gen_random_uuid(),'{}')"));
  await db.exec("reset role; set request.jwt.claim.role='service_role'; set role service_role");
  await assert.rejects(rows("select * from sportsbook_private.development_mail_captures"));
  await db.exec("reset role");
  for (let i = 1; i <= 23; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    await rows("insert into outbound_emails(id,recipient,status,ticket_id) values($1,'synthetic@example.test','sending',$1)", [id]);
    await rows("insert into email_deliveries(ticket_id,status) values($1,'pending')", [id]);
    const payload = { to: ["synthetic@example.test"], subject: "Captured only", html: "Fixture" };
    if (i === 1) {
      await assert.rejects(rows("select capture_development_email($1,$2)", [id, { ...payload, cc: ["bad@example.test"] }]));
      await assert.rejects(rows("select capture_development_email($1,$2)", [id, { ...payload, html: "x".repeat(140000) }]));
    }
    await rows("select capture_development_email($1,$2)", [id, payload]);
    await rows("select capture_development_email($1,$2)", [id, payload]);
    assert.equal((await rows("select status from outbound_emails where id=$1", [id]))[0].status, "captured");
    assert.equal((await rows("select status from email_deliveries where ticket_id=$1", [id]))[0].status, "captured");
  }
  assert.equal((await rows("select count(*)::int n from sportsbook_private.development_mail_captures"))[0].n, 20);
  assert.equal((await rows("select count(*)::int n from outbound_emails where sent_at is not null or provider_id is not null"))[0].n, 0);
  await db.exec("update sportsbook_private.application_environment set environment='production',project_ref='bmvjcdgxwxqalaohpsnw',app_origin='https://sportsbook.coopergurrie.com'");
  await assert.rejects(rows("select capture_development_email(gen_random_uuid(),'{}')"), /development server/);
  console.log("Passed runtime target, key, marker, owner, worker and synthetic-host isolation; private, idempotent, bounded mail capture. No external requests or messages.");
} finally {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  await db?.close();
  if (!root.startsWith(path.resolve("node_modules") + path.sep)) throw new Error("Unsafe test cleanup");
  await rm(root, { recursive: true, force: true });
}
