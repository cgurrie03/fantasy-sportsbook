import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as openpgp from "openpgp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projects = {
  development: "whlcnlacueweaqpsupqs",
  production: "bmvjcdgxwxqalaohpsnw",
};
export function connectionEnvironment(
  { target, host, user, ca, password },
  base = process.env,
) {
  const ref = projects[target];
  if (
    !ref ||
    typeof host !== "string" ||
    typeof user !== "string" ||
    !password ||
    /[\r\n\0]/.test(password)
  )
    throw Error("Confirmed source and hidden password required.");
  const direct = host === `db.${ref}.supabase.co` && user === "postgres";
  const pooler =
    /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) &&
    user === `postgres.${ref}`;
  if (!direct && !pooler)
    throw Error(
      "Use this exact project direct host/user, or its Supabase session pooler host/user. URLs, credentials in the host and transaction poolers are not accepted.",
    );
  if (!path.isAbsolute(ca ?? ""))
    throw Error("Source project CA certificate path required.");
  const clean = Object.fromEntries(
    Object.entries(base).filter(
      ([k]) => !/^PG|^BOFF_BACKUP_|^NODE_OPTIONS$/.test(k),
    ),
  );
  return {
    ...clean,
    PGHOST: host,
    PGUSER: user,
    PGPORT: "5432",
    PGDATABASE: "postgres",
    PGPASSWORD: password,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: ca,
    PGCONNECT_TIMEOUT: "20",
    PGAPPNAME: "boff-owner-readonly-backup",
    PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=0",
  };
}

export async function encryptProcess({
  command,
  args,
  env,
  key,
  output,
  spawnProcess = spawn,
}) {
  const file = await fs.open(output, "wx", 0o600);
  await file.close();
  const child = spawnProcess(command, args, {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrBytes = 0,
    first = Buffer.alloc(0),
    bytes = 0;
  const hash = createHash("sha256"),
    cipherHash = createHash("sha256");
  let cipherBytes = 0;
  // Error bodies may include server/auth details: consume, bound and never log them.
  child.stderr.on("data", (b) => {
    stderrBytes += b.length;
    if (stderrBytes > 1024 * 1024) child.kill();
  });
  const finished = new Promise((resolve, reject) => {
    child.once("error", () => reject(Error("Export client could not start.")));
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            Error(
              "Read-only export client failed. Check credentials, certificate, permissions and connectivity locally.",
            ),
          ),
    );
  });
  // Attach immediately: a failed process must not become an unhandled rejection.
  finished.catch(() => {});
  const meter = new Transform({
    transform(chunk, encoding, done) {
      bytes += chunk.length;
      hash.update(chunk);
      if (first.length < 5)
        first = Buffer.concat([first, chunk]).subarray(0, 5);
      done(null, chunk);
    },
  });
  child.stdout.on("error", (e) => meter.destroy(e));
  child.stdout.pipe(meter);
  try {
    const message = await openpgp.createMessage({
      binary: Readable.toWeb(meter),
    });
    const encrypted = await openpgp.encrypt({
      message,
      encryptionKeys: key,
      format: "binary",
    });
    await pipeline(
      encrypted instanceof Uint8Array
        ? Readable.from([encrypted])
        : Readable.fromWeb(encrypted),
      new Transform({
        transform(chunk, encoding, done) {
          cipherBytes += chunk.length;
          cipherHash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(output, { flags: "r+" }),
    );
    await finished;
    if (bytes === 0) throw Error("Export client produced no backup.");
    return {
      plaintext_bytes: bytes,
      plaintext_sha256: hash.digest("hex"),
      ciphertext_bytes: cipherBytes,
      ciphertext_sha256: cipherHash.digest("hex"),
      stderr_present: stderrBytes > 0,
      custom_archive_header: first.toString() === "PGDMP",
    };
  } catch (e) {
    child.kill();
    meter.destroy();
    throw e;
  }
}

export async function verifyClient() {
  const spec = JSON.parse(
    await fs.readFile(
      path.join(root, "scripts/config/postgresql-client-17.11.json"),
      "utf8",
    ),
  );
  const bin = path.join(root, "work/postgres-client-17.11/bin");
  for (const [file, expected] of Object.entries(spec.files)) {
    if (path.basename(file) !== file)
      throw Error("Invalid pinned client file.");
    const data = await fs.readFile(path.join(bin, file));
    if (createHash("sha256").update(data).digest("hex") !== expected)
      throw Error(
        "Portable client differs from pinned receipt. Nothing executed.",
      );
  }
  for (const name of ["pg_dump", "pg_dumpall", "pg_restore", "psql"]) {
    const version = execFileSync(path.join(bin, name + ".exe"), ["--version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (!version.includes("17.11"))
      throw Error("Unexpected PostgreSQL client version.");
  }
  return bin;
}

export function preflightFailure(stderr) {
  if (/password authentication failed|no password supplied/i.test(stderr))
    return "Database authentication failed. Check the selected project database password and the user shown in Connect.";
  if (/tenant or user not found/i.test(stderr))
    return "Session pooler could not find the project or user. Copy both values from the selected project Connect panel.";
  if (/certificate|ssl error|ssl syscall/i.test(stderr))
    return "TLS verification failed. Check the connection host and certificate for that connection.";
  if (/could not translate host|network is unreachable|no route to host|timeout expired|connection timed out|connection refused/i.test(stderr))
    return "Database host is unreachable. If using Direct connection, try the selected project Session pooler on port 5432.";
  if (/permission denied|does not exist/i.test(stderr))
    return "Connected, but the backup schema check failed. Verify the selected project and database role.";
  return "Backup connection check failed for an unclassified reason. No backup was exported.";
}

async function preflight(bin, env) {
  const sql =
    "select json_build_object('server_version_num',current_setting('server_version_num')::int,'database',current_database(),'auth_present',to_regclass('auth.users')is not null,'application_present',to_regclass('public.leagues')is not null,'migration_history_present',to_regclass('supabase_migrations.schema_migrations')is not null,'storage_objects',(select count(*)from storage.objects),'storage_buckets',(select count(*)from storage.buckets))";
  return new Promise((resolve, reject) => {
    const p = spawn(
      path.join(bin, "psql.exe"),
      [
        "-X",
        "--no-password",
        "--set",
        "ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        "--command",
        sql,
      ],
      { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    p.stdout.on("data", (b) => {
      out += b;
      if (out.length > 16384) p.kill();
    });
    let diagnostic = "";
    p.stderr.on("data", (chunk) => {
      if (diagnostic.length < 8192)
        diagnostic += chunk.toString().slice(0, 8192 - diagnostic.length);
    });
    p.once("error", () => reject(Error("Preflight client could not start.")));
    p.once("close", (code) => {
      try {
        if (code !== 0)
          throw Error(preflightFailure(diagnostic));
        const v = JSON.parse(out);
        if (
          v.database !== "postgres" ||
          v.server_version_num < 170000 ||
          v.server_version_num >= 180000 ||
          !v.auth_present ||
          !v.application_present ||
          !v.migration_history_present
        )
          throw Error(
            "Source schema/version is outside the reviewed backup profile.",
          );
        resolve(v);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function main() {
  if (process.platform !== "win32" || process.env.VERCEL)
    throw Error("Use the owner-run Windows PowerShell launcher locally.");
  const bin = await verifyClient();
  const armored = await fs.readFile(
    path.resolve(root, "work/financial-recovery-20261028/public.asc"),
    "utf8",
  );
  if (
    !armored.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----") ||
    armored.includes("PRIVATE KEY")
  )
    throw Error("Existing public recovery key required.");
  const key = await openpgp.readKey({ armoredKey: armored });
  if (process.argv[2] === "--check") {
    console.log(
      "PostgreSQL 17.11 client hashes, four executables and existing public recovery key verified; no database connection or private-key read.",
    );
    return;
  }

  const target = process.env.BOFF_BACKUP_TARGET,
    ref = projects[target];
  const env = connectionEnvironment({
    target,
    host: process.env.BOFF_BACKUP_HOST,
    user: process.env.BOFF_BACKUP_USER,
    ca: process.env.BOFF_BACKUP_CA,
    password: process.env.BOFF_BACKUP_PASSWORD,
  });
  delete process.env.BOFF_BACKUP_PASSWORD;
  await fs.access(env.PGSSLROOTCERT);
  const folder = path.join(
    root,
    "work/platform-backups",
    target +
      "-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomUUID(),
  );
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const sid = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  if (!/^S-1-5-[0-9-]+$/.test(sid))
    throw Error("Could not establish owner-only backup directory.");
  execFileSync(
    "icacls.exe",
    [
      folder,
      "/inheritance:r",
      "/grant:r",
      `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  const began = new Date().toISOString();
  try {
    console.log("Checking read-only source identity, schema and TLS...");
    const inventory = await preflight(bin, env),
      artifacts = {};
    console.log(
      "Streaming complete database archive directly into public-key encryption...",
    );
    artifacts.database = await encryptProcess({
      command: path.join(bin, "pg_dump.exe"),
      args: [
        "--no-password",
        "--format=custom",
        "--compress=zstd:3",
        "--lock-wait-timeout=10s",
      ],
      env,
      key,
      output: path.join(folder, "database.dump.pgp"),
    });
    if (!artifacts.database.custom_archive_header)
      throw Error("Database archive header is invalid.");
    console.log(
      "Streaming role definitions without role passwords into encryption...",
    );
    artifacts.roles = await encryptProcess({
      command: path.join(bin, "pg_dumpall.exe"),
      args: ["--no-password", "--roles-only", "--no-role-passwords"],
      env,
      key,
      output: path.join(folder, "roles.sql.pgp"),
    });
    const manifest = {
      format: "boff-native-platform-backup-v1",
      project_ref: ref,
      target,
      began_at: began,
      finished_at: new Date().toISOString(),
      client_version: "17.11",
      recipient_fingerprint: key.getFingerprint(),
      inventory,
      artifacts,
      coverage: {
        database:
          "Unfiltered pg_dump custom archive: readable application/Auth/storage metadata and migration schemas. A successful export is not a verified restore.",
        roles:
          "Role definitions only; role passwords intentionally excluded. Roles and database were read in separate transactions.",
        storage_objects:
          inventory.storage_objects === 0
            ? "Inventory empty at preflight; no object bodies exported."
            : "Object bodies NOT exported; separate storage backup required.",
        external_configuration:
          "NOT exported: Auth settings/templates/providers, Vercel secrets/settings/domains, encryption root/Vault custody and role passwords require independent owner coverage.",
      },
      restore_verified: false,
      full_platform_complete: false,
      warnings_present: Object.values(artifacts).some((x) => x.stderr_present),
    };
    await fs.writeFile(
      path.join(folder, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log("Encrypted export complete: " + folder);
    console.log(
      "Keep this folder private. Review coverage/warnings before uploading ciphertext and manifest; full platform recovery remains incomplete.",
    );
  } finally {
    delete env.PGPASSWORD;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
