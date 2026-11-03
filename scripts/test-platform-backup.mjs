import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as openpgp from "openpgp";
import { encryptBackup } from "./encrypt-platform-backup.mjs";
const dir = await fs.mkdtemp(
  path.join(os.tmpdir(), "boff-synthetic-platform-"),
);
try {
  const keys = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "Synthetic test only" }],
    format: "armored",
  });
  const input = path.join(dir, "database.dump"),
    pub = path.join(dir, "public.asc"),
    output = path.join(dir, "snapshot.pgp"),
    data = Buffer.from(
      "SYNTHETIC Auth/config/storage export marker\n".repeat(50000),
    );
  await fs.writeFile(input, data);
  await fs.writeFile(pub, keys.publicKey);
  const manifest = await encryptBackup({
    input,
    publicKey: pub,
    output,
    projectRef: "whlcnlacueweaqpsupqs",
  });
  assert.equal(manifest.plaintext_bytes, data.length);
  assert.equal(
    manifest.plaintext_sha256,
    createHash("sha256").update(data).digest("hex"),
  );
  const encrypted = await fs.readFile(output);
  assert(!encrypted.includes(Buffer.from("SYNTHETIC")));
  const privateKey = await openpgp.readPrivateKey({
      armoredKey: keys.privateKey,
    }),
    message = await openpgp.readMessage({ binaryMessage: encrypted });
  const restored = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    format: "binary",
  });
  assert.deepEqual(Buffer.from(restored.data), data);
  await assert.rejects(
    encryptBackup({
      input,
      publicKey: pub,
      output,
      projectRef: "whlcnlacueweaqpsupqs",
    }),
    /EEXIST/,
  );
  await assert.rejects(
    encryptBackup({
      input,
      publicKey: pub,
      output: input,
      projectRef: "whlcnlacueweaqpsupqs",
    }),
    /separate/,
  );
  await fs.writeFile(pub, keys.privateKey);
  await assert.rejects(
    encryptBackup({
      input,
      publicKey: pub,
      output: path.join(dir, "denied.pgp"),
      projectRef: "whlcnlacueweaqpsupqs",
    }),
    /public recovery key/,
  );
  assert.deepEqual(await fs.readFile(input), data, "owner source is preserved");
  console.log(
    "Streaming owner backup encryption: synthetic round-trip/integrity, existing-file refusal, input preservation and private-key rejection. No owner key or actual export accessed.",
  );
} finally {
  // Delete only this test-owned temporary directory after verifying its absolute target.
  const target = path.resolve(dir),
    root = path.resolve(os.tmpdir()) + path.sep;
  if (
    !target.startsWith(root) ||
    !path.basename(target).startsWith("boff-synthetic-platform-")
  )
    throw Error("Unsafe test cleanup target.");
  await fs.rm(target, { recursive: true, force: true });
}
