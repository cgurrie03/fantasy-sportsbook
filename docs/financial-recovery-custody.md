# Owner custody steps for the existing financial checkpoint

The owner selected private Google Drive for encrypted recovery files and a
separate password manager for recovery material. The October 28 financial
checkpoint and an 11-file restore package are off-site. Both Drive downloads
were checked against their original SHA-256; permissions show owner-only access.
Private keys/passwords/DPAPI wrappers were not uploaded. The ZIP container itself
is not encrypted: its financial data is the encrypted `snapshot.pgp`; remaining
files are schema/source/dependency lock/integrity metadata.

This is still **financial-only**, dated October 28, not a full platform backup.
Newer transactions, Auth credentials/configuration, complete unbet/model archives,
hosting/DNS/scheduler configuration and other platform recovery work remain F001.
No production deletion or restore is authorized by this checkpoint.

## One owner action now

The integrations cannot choose your password or import a key into your password
manager. Run this yourself in PowerShell under the original Windows account:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\coope\Documents\Codex\2026-10-28\co\work\fantasy-sportsbook\scripts\export-recovery-key.ps1"
```

This uses built-in Windows PowerShell; `pwsh` installation is not required. The
execution-policy option applies only to this launched process and does not change
your saved Windows policy.

1. Generate/save a new password of at least 20 characters in your password manager.
   Enter it twice at the hidden local prompts. Never send it through chat.
2. The helper decrypts the existing local key only in memory, re-encrypts it with
   your password, and verifies the financial checkpoint using its off-site readback.
   It preserves the original key and refuses to overwrite prior custody outputs.
3. In a password-manager recovery item, attach this **encrypted** file:
   `work/financial-recovery-20261028/portable-private-key.asc` under the project.
   Store the new password and the independent fingerprints/checksums below there.
   Keep that attachment out of the Drive backup folder and out of Git.
4. Reply only that the password-manager import is complete. Do not paste passwords,
   private keys, DPAPI data or decrypted records. A local export receipt alone is
   not evidence that the password manager contains the attachment.

The generated `custody-export-receipt.json` contains only integrity/status metadata.
It deliberately does not mark password-manager import or independent-device
restoration complete. The export/password flow was tested with synthetic keys,
including wrong passwords, weak passwords, altered checkpoints and overwrite
rejection; actual key export is owner-run only.

## Independently held integrity values

- Original public key fingerprint: `22f26f21365bae0077459baf66b551660fa3a13d`.
- Encrypted financial snapshot: 494,361 bytes, SHA-256
  `1f4f5d21e0bcc8451459f990de0f966fd99aab4dc6fc9e4484d3599ba291c92f`.
- Restore ZIP: 553,540 bytes, SHA-256
  `35e0fb89bf76f3f40e0ba587a469ea884d1a3963bd0b28f4b1b8d1463c13dc83`.

The Drive folder/file identities and owner-only permission/readback checks are
recorded in the ignored private work receipt, not published as repository data.
Total uploaded checkpoint + package is 1,047,901 bytes (about 1.05 MB), with no
new application database storage or production payload export in this step.

## Independent restore after import

Download the ZIP on another device/account, compare its checksum against the copy
held in your password manager before running its source, extract it, install Node
24, and run `npm ci --ignore-scripts` in the extracted root. Obtain the encrypted
key attachment independently from the password manager, then run the packaged
PowerShell helper with `-Mode verify-portable`, `-RecoveryFolder .\work\checkpoint`,
`-PortableKey 'PATH_TO_ENCRYPTED_KEY'` and `-ExpectedCipherSha256` set to the
independently held snapshot checksum above. Enter the saved password at the hidden
prompts. Use platform-appropriate local paths.

This verifier never calls DPAPI. It checks the independently held ciphertext hash,
plaintext/schema hashes, exact counts/checksums, FK integrity, privacy and duplicate
refund behavior when an eligible open ticket exists, in disposable local memory.
No hosted client, real bet or mail send is involved. Decrypted records stay in memory.
The original financial drill checked all 23 relations and 82 FKs; complete platform
recovery still needs separate coverage and owner-controlled credential/configuration
recovery. Never describe this package as a managed Supabase project backup.
