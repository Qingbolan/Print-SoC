# Updating and removing Print@SoC

## Terminal maintenance

```sh
print-soc self update --check
print-soc self update
print-soc self update --rollback
print-soc self uninstall
```

The interactive commands use arrow-key choices, a review screen, hidden system
password prompts, and live download/stage progress. Declining the review makes
no installation changes. Ctrl+C returns 130. Use `--plain` for simple text;
redirected output, `NO_COLOR`, and `TERM=dumb` disable animation. No maintenance
command submits or cancels a print job.

## Automatic desktop updates

```sh
print-soc self update --auto notify  # default: check and notify
print-soc self update --auto apply   # opt in to install before desktop launch
print-soc self update --auto off
```

Checks happen on normal CLI desktop launches, at most once every 24 hours. This
is not a background daemon: directly opening the desktop application does not
run the CLI check. Printing, inspection, MCP, help and diagnostic commands do not
check for updates. `PRINT_AT_SOC_NO_UPDATES=1` disables launch-time checks.
Network failures defer the update without preventing a working desktop from
launching. An interrupted file replacement is recovered locally before a normal
launch, even offline. Explicit rollback turns automatic updates off to avoid
immediately reapplying the version just rolled back.

Updates manage the downloaded desktop application. Python/npm packages remain
owned by their package manager; upgrading those packages and refreshing an
installed CUPS service snapshot are separate operations:

```sh
python3 -m pip install --upgrade print-at-soc
# Or, for the npm launcher:
npm install -g print-at-soc@latest
# After upgrading the Python CLI, refresh an installed system printer:
print-soc virtual-printer install
```

The npm launcher uses the same Python maintenance engine, with inherited terminal
input/output. Explicit installation or update prepares a private environment at
`~/.PrintAtSoC/maintenance-runtime/<version>` when no matching engine is available.
It installs the exact npm package version from PyPI, verifies it, then opens the
interactive wizard. This requires Python 3.8+ with `venv`; set `PSOC_PYTHON` to
select an interpreter. Unattended setup requires `--yes`. Normal launches, MCP
and update checks never install dependencies. Shared Python installations remain
owned by their package manager.

## Replacement and recovery

The updater uses the published Tide release tag; it does not generate or bump
versions. It selects the platform asset from the configured GitHub repository,
requires HTTPS, and verifies the published size and SHA-256 digest before
extracting. An asset without digest metadata is rejected with repair guidance.
The digest comes from [GitHub's release asset metadata](https://docs.github.com/en/rest/releases/assets).
Archive paths, links, file types and extraction size are checked. The expected
native executable must be present with a matching platform header.

On macOS/Linux, staging and replacement share a filesystem. A persisted journal
coordinates the directory swap and version/asset receipt; failure restores the
previous executable and receipt. One previous installation is retained for
`--rollback`. A lock prevents simultaneous update, rollback or uninstall.
Running desktop/MCP processes prevent replacement. The executable header check
is structural validation, not a full application GUI launch test.

Windows uses the native MSI/NSIS installer, whose effects outside the managed
folder cannot be made into an atomic directory swap. Manual updates retain and
verify the previous installer for recovery. Existing installations without that
cached installer require native-installer maintenance first. Automatic Windows
updates support notification only; interactive installation handles native/UAC
prompts. A failed first native install may require cleanup through Windows
Installed Apps; the CLI reports that limitation instead of claiming rollback.

## Uninstall policy

```sh
# Preview; never asks for administrator authentication or deletes anything:
print-soc self uninstall --dry-run
print-soc self uninstall --purge --dry-run

# Remove desktop/runtime/queues; retain settings, history and credentials:
print-soc self uninstall --keep-data

# Also remove app-owned user data and saved credentials:
print-soc self uninstall --purge

# Also remove the calling package-manager's CLI package after cleanup succeeds:
print-soc self uninstall --purge --remove-cli
```

Every uninstall shows the target inventory before confirmation. The removal
scope is the managed desktop, its version/asset receipts and rollback/download
files, and Print@SoC CUPS queues and backend. The user forwarding service and native CUPS connection token are removed in both modes.
The shared account identity is retained with user data. Purge additionally removes the
shared account identity, app-specific settings, imported/cache
copies, PDF backups, history, WebView data, and credentials scoped to
`tech.silan.PrintAtSoC.ssh`.

Original documents, other applications, shared Python dependencies and shared
PATH directories are not deletion targets. Symlink traversal is rejected;
a final owned symlink can be unlinked without following its target. Active
print jobs or running desktop/MCP processes must be resolved before removal.
A locked/denied credential store or failed native uninstaller produces a failed,
explicitly incomplete result; retries are safe. Cleanup is not a rollbackable
operation after data deletion has begun.

`--remove-cli` runs the current Python interpreter's pip, or global npm for the
npm launcher, only after successful application cleanup. It does not delete a
source checkout. Cancellation, preview and failure never remove the CLI.
Without this option, the package remains available for inspection/reinstallation.
For the npm launcher, purge or `--remove-cli` also removes its private maintenance
environments after the Python cleanup process exits. The preview lists this
directory; only generations carrying Print@SoC ownership receipts are removed.
The empty managed directory and its non-secret `.maintenance.lock` are retained
to preserve cross-process locking; a purge does not promise literally zero files.

## Scripts

```sh
print-soc self update --non-interactive --yes
print-soc self uninstall --keep-data --non-interactive --yes
# For system CUPS removal, authenticate separately before unattended cleanup:
sudo -v
print-soc self uninstall --purge --remove-cli --non-interactive --yes
```

Non-interactive changes require `--yes`; system operations use cached privileges
and never fall back to an interactive sudo prompt. Exit codes: 0 success or
user-declined review, 1 operational failure, 2 argument error, 130 interruption.
EOF and Ctrl+C never print a success result. Keep update/uninstall errors visible
in automation logs; do not infer success merely from a completed download.
