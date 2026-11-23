import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as openpgp from "openpgp";
import { createHash } from "node:crypto";
import {
  connectionEnvironment,
  encryptProcess,
  preflightFailure,
} from "./export-platform-backup.mjs";
for (const [diagnostic, expected] of [
  ["password authentication failed", /authentication failed/],
  ["Tenant or user not found", /pooler could not find/],
  ["certificate verify failed", /TLS verification failed/],
  ["Network is unreachable", /host is unreachable/],
  ["permission denied", /schema check failed/],
  ["unexpected error", /unclassified/],
]) {
  const message = preflightFailure(diagnostic + " synthetic-secret");
  assert.match(message, expected);
  assert(!message.includes("synthetic-secret"));
}
const dir = await fs.mkdtemp(
  path.join(os.tmpdir(), "boff-native-backup-test-"),
);
try {
  const ca = path.join(dir, "public-ca.crt"),
    config = {
      target: "development",
      host: "db.whlcnlacueweaqpsupqs.supabase.co",
      user: "postgres",
      password: "synthetic-secret-not-real",
      ca,
    };
  const env = connectionEnvironment(config, {
    PATH: process.env.PATH,
    PGSERVICE: "unsafe",
    PGOPTIONS: "-c default_transaction_read_only=off",
    BOFF_BACKUP_PASSWORD: "must-not-forward",
    NODE_OPTIONS: "unsafe",
  });
  assert.equal(env.PGSSLMODE, "verify-full");
  assert.equal(env.PGPORT, "5432");
  assert.match(env.PGOPTIONS, /read_only=on/);
  assert(!("PGSERVICE" in env));
  assert(!("BOFF_BACKUP_PASSWORD" in env));
  assert(!("NODE_OPTIONS" in env));
  assert.equal(
    connectionEnvironment(
      {
        ...config,
        host: "aws-0-us-east-1.pooler.supabase.com",
        user: "postgres.whlcnlacueweaqpsupqs",
      },
      {},
    ).PGUSER,
    "postgres.whlcnlacueweaqpsupqs",
  );
  for (const change of [
    { target: "other" },
    { host: "https://db.whlcnlacueweaqpsupqs.supabase.co" },
    { host: "db.bmvjcdgxwxqalaohpsnw.supabase.co" },
    { host: "evil.invalid" },
    { user: "postgres.bmvjcdgxwxqalaohpsnw" },
    { ca: "relative.crt" },
    { password: "x\ny" },
  ])
    assert.throws(() => connectionEnvironment({ ...config, ...change }, {}));
  const keys = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Disposable synthetic backup test" }],
  });
  const key = await openpgp.readKey({ armoredKey: keys.publicKey }),
    output = path.join(dir, "database.dump.pgp");
  const bytes = 2 * 1024 * 1024,
    script = `process.stdout.write('PGDMP');process.stdout.write(Buffer.alloc(${bytes},71));`;
  const receipt = await encryptProcess({
    command: process.execPath,
    args: ["-e", script],
    env: { ...process.env },
    key,
    output,
  });
  const ciphertext = await fs.readFile(output),
    message = await openpgp.readMessage({ binaryMessage: ciphertext });
  const decrypted = await openpgp.decrypt({
    message,
    decryptionKeys: await openpgp.readPrivateKey({
      armoredKey: keys.privateKey,
    }),
    format: "binary",
  });
  assert.equal(receipt.plaintext_bytes, bytes + 5);
  assert(receipt.custom_archive_header);
  assert.equal(receipt.ciphertext_bytes, ciphertext.length);
  assert.equal(
    receipt.ciphertext_sha256,
    createHash("sha256").update(ciphertext).digest("hex"),
  );
  assert.equal(
    receipt.plaintext_sha256,
    createHash("sha256").update(decrypted.data).digest("hex"),
  );
  assert.equal(decrypted.data.length, bytes + 5);
  await assert.rejects(
    encryptProcess({
      command: process.execPath,
      args: ["-e", script],
      env: { ...process.env },
      key,
      output,
    }),
    /EEXIST/,
  );
  const failure = await encryptProcess({
    command: process.execPath,
    args: [
      "-e",
      "process.stderr.write('synthetic-password-must-not-be-printed');process.exit(7)",
    ],
    env: { ...process.env },
    key,
    output: path.join(dir, "failed.pgp"),
  }).then(
    () => null,
    (e) => e,
  );
  assert(failure);
  assert(!failure.message.includes("synthetic-password"));
  assert.match(failure.message, /failed/);
  assert.deepEqual((await fs.readdir(dir)).sort(), [
    "database.dump.pgp",
    "failed.pgp",
  ]);
  console.log(
    "Native backup: strict project/host/user/CA and read-only environment, no inherited PG injection, 2-MiB encrypted process round-trip, hashes/header, overwrite denial, secret stderr suppression and failed-export rejection. Synthetic subprocesses only; no database/owner key accessed.",
  );
} finally {
  const target = path.resolve(dir),
    tmp = path.resolve(os.tmpdir()) + path.sep;
  if (
    !target.startsWith(tmp) ||
    !path.basename(target).startsWith("boff-native-backup-test-")
  )
    throw Error("Unsafe synthetic cleanup target.");
  await fs.rm(target, { recursive: true, force: true });
}
