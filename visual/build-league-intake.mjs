import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
import {rolldown} from "rolldown";
import {fileURLToPath} from "node:url";

const local = (path) => new URL(path, import.meta.url);
const source = await readFile(local("../api/_lib/league-intake.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
});
await mkdir(local("dist/lib"), { recursive: true });
await mkdir(local("dist/api"), { recursive: true });
await writeFile(local("dist/lib/league-intake.mjs"), outputText);
await copyFile(local("api/league-intake.mjs"), local("dist/api/league-intake.mjs"));
await copyFile(local("api/membership.mjs"), local("dist/api/membership.mjs"));
await copyFile(local("api/book.mjs"), local("dist/api/book.mjs"));
await copyFile(local("api/live-book.mjs"), local("dist/api/live-book.mjs"));
await copyFile(local("api/notification-delivery.mjs"), local("dist/api/notification-delivery.mjs"));
await copyFile(local("lib/release-target.mjs"), local("dist/lib/release-target.mjs"));
await copyFile(local("lib/book-archive.mjs"), local("dist/lib/book-archive.mjs"));
const invitation=await rolldown({input:fileURLToPath(local('server/notification-templates.ts')),platform:'node'});
try {await invitation.write({file:fileURLToPath(local('dist/lib/invitation-email.mjs')),format:'esm',codeSplitting:false,minify:true});}
finally {await invitation.close();}
