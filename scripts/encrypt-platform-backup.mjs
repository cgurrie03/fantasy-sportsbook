// Owner-run wrapper. It never reads private recovery keys or connects to a service.
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import * as openpgp from "openpgp";
export async function encryptBackup({ input, publicKey, output, projectRef }) {
  if (!["bmvjcdgxwxqalaohpsnw", "whlcnlacueweaqpsupqs"].includes(projectRef))
    throw Error("Explicit existing project reference required.");
  const inputPath = path.resolve(input),
    outputPath = path.resolve(output),
    keyPath = path.resolve(publicKey);
  if (
    inputPath === outputPath ||
    keyPath === inputPath ||
    keyPath === outputPath
  )
    throw Error("Input, output and public key must be separate files.");
  const armored = await fs.readFile(keyPath, "utf8");
  if (
    !armored.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----") ||
    armored.includes("PRIVATE KEY")
  )
    throw Error("Only the existing public recovery key may be supplied.");
  const key = await openpgp.readKey({ armoredKey: armored }),
    plainHash = createHash("sha256"),
    cipherHash = createHash("sha256");
  let plainBytes = 0,
    cipherBytes = 0;
  const stat = await fs.stat(inputPath);
  if (!stat.isFile() || stat.size === 0)
    throw Error("A nonempty owner-exported backup file is required.");
  // Reserve before reading so an existing backup can never be overwritten.
  const handle = await fs.open(outputPath, "wx", 0o600);
  await handle.close();
  try {
    const source = createReadStream(inputPath);
    const plain = new Transform({
      transform(chunk, encoding, done) {
        plainBytes += chunk.length;
        plainHash.update(chunk);
        done(null, chunk);
      },
    });
    source.on("error", (e) => plain.destroy(e));
    source.pipe(plain);
    const message = await openpgp.createMessage({
      binary: Readable.toWeb(plain),
    });
    const encrypted = await openpgp.encrypt({
      message,
      encryptionKeys: key,
      format: "binary",
    });
    const cipher =
      encrypted instanceof Uint8Array
        ? Readable.from([encrypted])
        : Readable.fromWeb(encrypted);
    await pipeline(
      cipher,
      new Transform({
        transform(chunk, encoding, done) {
          cipherBytes += chunk.length;
          cipherHash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(outputPath, { flags: "r+" }),
    );
    if (plainBytes !== stat.size)
      throw Error("Backup source changed during encryption.");
    const after = await fs.stat(inputPath);
    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ino !== stat.ino ||
      after.dev !== stat.dev
    )
      throw Error("Backup source changed during encryption.");
    const manifest = {
      format: "boff-owner-platform-artifact-v1",
      project_ref: projectRef,
      encrypted_at: new Date().toISOString(),
      plaintext_bytes: plainBytes,
      plaintext_sha256: plainHash.digest("hex"),
      ciphertext_bytes: cipherBytes,
      ciphertext_sha256: cipherHash.digest("hex"),
      recipient_fingerprint: key.getFingerprint(),
      coverage:
        "Unclassified owner export; encryption integrity is not proof of database/Auth/config/storage completeness or a successful restore.",
    };
    await fs.writeFile(
      outputPath + ".manifest.json",
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return manifest;
  } catch (e) {
    // Preserve the input. A partial cipher is intentionally retained for review;
    // no deletion, key creation or silent replacement occurs on an interrupted run.
    throw Error("Backup encryption did not complete: " + e.message);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [input, publicKey, output, projectRef] = process.argv.slice(2);
  try {
    if (!input || !publicKey || !output || !projectRef)
      throw Error(
        "Use node scripts/encrypt-platform-backup.mjs <owner-export> <existing-public.asc> <new-cipher.pgp> <project-ref>. Never supply a private key.",
      );
    const m = await encryptBackup({ input, publicKey, output, projectRef });
    console.log(
      JSON.stringify({
        format: m.format,
        ciphertext_bytes: m.ciphertext_bytes,
        ciphertext_sha256: m.ciphertext_sha256,
        recipient_fingerprint: m.recipient_fingerprint,
        restore_verified: false,
      }),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
