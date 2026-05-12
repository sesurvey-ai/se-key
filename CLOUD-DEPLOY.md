# Cloud Deployment — SE-Key on Hostinger VPS + Dokploy

Target environment:
- **VPS**: `187.127.96.172` (KVM 2 — 2 CPU / 8GB / 100GB, Ubuntu 24.04 + Dokploy)
- **Domain**: `key.sesurvey.cloud` (A record already added → VPS IP)
- **DB**: SQLite (WAL) on persistent Docker volume
- **TLS**: Traefik + Let's Encrypt (Dokploy handles automatically)

---

## Phase 0 — Pre-flight on the dev machine

1. Ensure all repo changes are committed and pushed to GitHub (Dokploy pulls from git):
   ```powershell
   cd C:\Users\i9\Desktop\se-key
   git status        # working tree clean
   git push
   ```
2. Generate a production API key (keep this secret — paste into Dokploy env panel only):
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Confirm DNS resolves:
   ```powershell
   Resolve-DnsName key.sesurvey.cloud -Type A
   # Expected: 187.127.96.172
   ```

---

## Phase 1 — Create the Dokploy application

1. Open Dokploy: `https://<dokploy-panel-url>` (whatever your Dokploy URL is)
2. **Create Application** → choose **GitHub** (or **Manual Git**) source
3. Settings:

   | Field | Value |
   |-------|-------|
   | Repository | the repo you pushed in Phase 0 |
   | Branch | `main` |
   | Build Type | **Dockerfile** |
   | Dockerfile path | `server/Dockerfile` |
   | Build context | `server` |
   | Internal port | `3000` |

4. **Volumes** → add a volume mount:
   - **Container path**: `/data`
   - **Name**: `se-key-data` (Dokploy creates a named volume)
   - This stores `data.db` + `logs/` and survives container rebuilds

5. **Environment variables** → paste from [`server/.env.cloud.example`](server/.env.cloud.example), filling real values:

   ```env
   ISURVEY_URL=https://se.isurvey.mobi/service/srvEMCSrpt.php
   ISURVEY_USER_ID=sesurvey
   ISURVEY_PASSWORD=<real password>
   ISURVEY_TIMEOUT_MS=60000
   ISURVEY_RETRIES=2
   ISURVEY_RETRY_DELAY_MS=2000
   SE_KEY_API_KEY=<the 64-hex you generated in Phase 0>
   RETRY_ENABLED=0
   ```

   `HOST`, `PORT`, `TZ`, `SE_KEY_DB`, `SE_KEY_LOG_DIR` are already set by the Dockerfile — don't override unless you have a reason.

6. **Domain** → add:
   - **Host**: `key.sesurvey.cloud`
   - **Path**: `/`
   - **Container port**: `3000`
   - **HTTPS**: ON (Let's Encrypt via Traefik — Dokploy auto-provisions)

7. Click **Deploy**. First build pulls the Node base image + npm ci (1–3 min). Watch logs:
   - Expect `auth.enabled` then `server.start host=0.0.0.0 port=3000`.
   - Healthcheck `/api/health` should turn green within ~30s.

---

## Phase 2 — Smoke test (still empty DB)

From any machine:
```bash
curl https://key.sesurvey.cloud/api/health
# → {"ok":true,"rows":0}

curl -H "X-API-Key: <YOUR_KEY>" https://key.sesurvey.cloud/api/records?limit=1
# → {"rows":[],"total":0,...}
```

Browser tests:
- `https://key.sesurvey.cloud/admin/` — page loads, gear icon to set API key → table renders empty
- `https://key.sesurvey.cloud/detail/` — read-only page loads

If both work → cloud server is healthy, ready for data migration.

---

## Phase 3 — Migrate `data.db` from LAN (.122) to cloud

### 3a. Quiesce the LAN server
On `192.168.4.122` (RDP as Administrator, PowerShell):
```powershell
C:\se-key\service\se-key.exe stop
# Wait until stopped before next step — kills any in-flight writes
```

### 3b. Checkpoint + copy DB
Still on `.122`:
```powershell
cd C:\se-key\server
# Make data.db self-contained (merges -wal into the main file)
sqlite3 data.db "PRAGMA wal_checkpoint(TRUNCATE);"

# Sanity: row count + size
sqlite3 data.db "SELECT COUNT(*) FROM records;"
Get-Item data.db | Select-Object Length, LastWriteTime
```

Copy `data.db` to your dev machine (USB / file share / Hostinger panel upload — pick whichever you can reach).

### 3c. Upload to the cloud volume

**Option A — Dokploy "Files" tab** (easiest if available):
- Open the application in Dokploy → Files / Volumes panel
- Browse to volume `se-key-data` (mounted at `/data`)
- Upload `data.db` to root of the volume → overwrite the placeholder if any

**Option B — SSH + scp** (if you have SSH access to the VPS):
```bash
# From the machine that has data.db
scp data.db root@187.127.96.172:/tmp/data.db

# SSH to the VPS
ssh root@187.127.96.172

# Find the volume mountpoint (Dokploy uses /var/lib/dokploy/volumes/<name>)
docker volume inspect se-key-data --format '{{.Mountpoint}}'
# → e.g. /var/lib/docker/volumes/se-key-data/_data

# Stop the container, swap the file, start again
docker stop <container-id>
cp /tmp/data.db /var/lib/docker/volumes/se-key-data/_data/data.db
chown 1000:1000 /var/lib/docker/volumes/se-key-data/_data/data.db
docker start <container-id>
```

### 3d. Verify
```bash
curl https://key.sesurvey.cloud/api/health
# → {"ok":true,"rows":<expected row count>}   ← must match .122
```

Open `https://key.sesurvey.cloud/admin/` and scroll — recent records should match what you saw on the LAN admin.

---

## Phase 4 — Cutover: switch users from LAN → cloud

### 4a. Distribute extension v0.4.5
Two paths:

- **Chrome Web Store**: upload `se-key-v0.4.5.zip` (already built at repo root). After CWS approves, all user installs auto-update within a few hours.
- **Manual** (faster): give users `se-key-v0.4.5.zip` → they extract → `chrome://extensions/` → remove old, **Load unpacked** new folder.

### 4b. Each user updates the URL once
After updating, each user opens the popup:
1. Change **Server URL** to `https://key.sesurvey.cloud`
2. Paste **API key** (the same one in Dokploy env panel)
3. Click **ทดสอบ** → must turn green
4. Click **บันทึก**

> Existing users will still have the old LAN URL in their `chrome.storage.local` even after the v0.4.5 upgrade — they MUST change it manually via popup. The `DEFAULT_SERVER` constant only applies to fresh installs.

### 4c. Smoke test from a real user machine
Open eClaim3 → load any case with claim+survey → floating panel should show server connected (green dot) → press "บันทึกราคา" → check `https://key.sesurvey.cloud/admin/` to see the new row.

---

## Phase 5 — Decommission LAN .122

After at least one full work day with cloud running cleanly:

```powershell
# On .122 — uninstall the Windows service
C:\se-key\service\se-key.exe stop
C:\se-key\service\se-key.exe uninstall

# (Optional) close inbound firewall rule for 3100
Remove-NetFirewallRule -DisplayName "SE-Key API"

# Keep C:\se-key\ as a frozen backup for at least 30 days before deleting
```

---

## Rollback (if cloud breaks during Phase 4)

The LAN server on .122 is still installed (just stopped after Phase 3a). To roll back:

```powershell
# On .122
C:\se-key\service\se-key.exe start
```

Then each user:
1. Open extension popup → change URL back to `http://192.168.4.122:3100`
2. Click ทดสอบ → บันทึก

⚠️ **Data divergence**: any writes that happened on the cloud after Phase 3c stay only in the cloud DB. If you roll back, those writes are lost from the LAN copy. The window between Phase 3c and stable cutover is when this matters — keep it short.

---

## Operational notes

- **Backups**: schedule `data.db` backups via Dokploy's backup feature OR cron on the VPS:
  ```bash
  # crontab -e (on VPS)
  0 2 * * * docker exec se-key sqlite3 /data/data.db ".backup /data/backup-$(date +\%Y\%m\%d).db" && find /var/lib/docker/volumes/se-key-data/_data -name "backup-*.db" -mtime +14 -delete
  ```
- **Logs**: `/data/logs/YYYY-MM-DD.log` inside the container (also mirrored to Docker stdout, viewable in Dokploy).
- **Update server code**: push to git → Dokploy auto-rebuilds + restarts. Volume persists, so DB is safe.
- **Healthcheck**: Dockerfile defines a 30s curl healthcheck — container auto-restarts if `/api/health` fails 3 consecutive times.
