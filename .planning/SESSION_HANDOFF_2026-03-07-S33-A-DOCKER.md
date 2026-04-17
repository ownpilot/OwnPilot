# Session Handoff S33-A: OwnPilot Docker Rebuild + Cron Fix

**Tarih:** 2026-03-07
**Scope:** SADECE Docker rebuild ve cron script fix. Bridge/GSD ayri handoff (S33-BC).

---

## Problem

S33'te CC spawn ile SOR pipeline implement edildi. Iki acil sorun var:

### Sorun 1: schema.ts Docker image'a yansimiyor

- `schema.ts`'e sor_queue tablo + PG trigger eklendi (commit `1074ce2`, `d9880e8`)
- CC, SQL'i `docker exec psql` ile DOGRUDAN DB'ye uyguladi
- Docker image rebuild yapilMADI
- **Risk:** Container restart veya Dokploy redeploy = eski image = schema.ts degisikligi YOK = sor_queue tablo yok = pipeline kirilir
- **NOT:** DB volume kalici — PG data kaybolmaz. AMA yeni container'da OwnPilot startup schema migration'i eski image'daki schema.ts'i kullanir

### Sorun 2: Cron script hardcoded Docker IP

- `~/scripts/sor-upload-cron.py` satir 55:
  ```python
  DB_DSN = (
      "host=172.19.0.2 port=5432 dbname=ownpilot "
      "user=ownpilot password=ownpilot_secure_2026"
  )
  ```
- `172.19.0.2` = Docker bridge IP, container restart'ta degisebilir
- systemd timer her 60s'de calistiriyor — IP degisince TUM upload'lar fail olur

---

## Fix Plani (2 adim)

### Adim 1: Cron Script IP Fix

Dosya: `~/scripts/sor-upload-cron.py` (satir 54-57)

Degisiklik:
```python
# ONCE (hardcoded):
DB_DSN = (
    "host=172.19.0.2 port=5432 dbname=ownpilot "
    "user=ownpilot password=ownpilot_secure_2026"
)

# SONRA (environment variable + fallback):
DB_DSN = os.environ.get("OWNPILOT_DB_DSN", (
    "host=172.19.0.2 port=5432 dbname=ownpilot "
    "user=ownpilot password=ownpilot_secure_2026"
))
```

systemd service'e environment ekle (`~/.config/systemd/user/sor-upload.service`):
```ini
[Service]
Environment=OWNPILOT_DB_DSN="host=172.19.0.2 port=5432 dbname=ownpilot user=ownpilot password=ownpilot_secure_2026"
```

Daha iyi alternatif — container name ile DNS resolve:
```python
# Docker network icerisindeyse container name ile (en guvenilir):
# host=ownpilot-postgres
# AMA: cron script HOST'ta calisiyor, Docker network DISINDA
# Bu yuzden ya:
# 1. Docker IP'yi dinamik al: docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ownpilot-postgres
# 2. Veya PG portunu host'a expose et: docker run -p 5432:5432 ownpilot-postgres
# 3. Veya .env dosyasi kullan
```

Pragmatik cozum: `.env` dosyasi
```bash
# ~/scripts/.env
OWNPILOT_DB_HOST=172.19.0.2
OWNPILOT_DB_PORT=5432
OWNPILOT_DB_NAME=ownpilot
OWNPILOT_DB_USER=ownpilot
OWNPILOT_DB_PASS=ownpilot_secure_2026
```

Test:
```bash
# IP dogru mu kontrol:
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ownpilot-postgres
# Cron script test:
python3 ~/scripts/sor-upload-cron.py --dry-run
```

### Adim 2: Docker Rebuild + Deploy

```bash
# 1. Build
cd ~/ownpilot
docker build -t localhost:5000/ownpilot:latest .

# 2. Push to local registry
docker push localhost:5000/ownpilot:latest

# 3. Stop eski container
docker stop ownpilot

# 4. Remove eski container
docker rm ownpilot

# 5. Start yeni container (mevcut run komutu — volumes korunur)
# NOT: Tam docker run komutunu mevcut container'dan cikart:
docker inspect ownpilot | python3 -c "
import sys, json
c = json.load(sys.stdin)[0]
cmd = ['docker run -d --name ownpilot']
cmd.append(f'--network {list(c[\"NetworkSettings\"][\"Networks\"].keys())[0]}')
for m in c['Mounts']:
    if m['Type'] == 'volume':
        cmd.append(f'-v {m[\"Name\"]}:{m[\"Destination\"]}')
for p in c.get('HostConfig',{}).get('PortBindings',{}) or {}:
    hp = c['HostConfig']['PortBindings'][p][0]['HostPort']
    cmd.append(f'-p {hp}:{p.split(\"/\")[0]}')
for e in c['Config'].get('Env',[]):
    if not e.startswith('PATH='):
        cmd.append(f'-e \"{e}\"')
cmd.append(c['Config']['Image'])
print(' '.join(cmd))
" 2>/dev/null
# VEYA basitce:
docker run -d --name ownpilot \
  --network ownpilot-znahub_default \
  -v ownpilot-znahub_ownpilot-data:/app/data \
  -p 8080:8080 \
  localhost:5000/ownpilot:latest

# 6. Verify
docker logs ownpilot --tail 20
# schema migration loglarinda sor_queue + trigger gorunmeli

# 7. DB kontrolu
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot -c "\dt sor_queue"
docker exec ownpilot-postgres psql -U ownpilot -d ownpilot -c "SELECT tgname FROM pg_trigger WHERE tgname = 'trg_enqueue_sor';"

# 8. WhatsApp reconnect bekleniyor (QR gerekmemeli — session volume korundu)
```

**DIKKAT:**
- Container restart = WhatsApp QR scan gerekebilir (session files volume'da ama Baileys garanti degil)
- `docker stop` ONCE `docker inspect` ile run parametrelerini kaydet
- Volume'lar korunuyor (`ownpilot-znahub_ownpilot-data`), veri kaybi YOK

---

## Basari Kriterleri

| Kriter | Kanit |
|--------|-------|
| Cron script env var kullaniyor | `grep -n "os.environ" ~/scripts/sor-upload-cron.py` |
| `--dry-run` calisiyor | `python3 ~/scripts/sor-upload-cron.py --dry-run` ciktisi |
| Docker image rebuild edildi | `docker images localhost:5000/ownpilot` — yeni SHA |
| Container calisiyor | `docker ps \| grep ownpilot` |
| schema.ts migration calisti | `docker exec ... psql -c "\dt sor_queue"` → tablo var |
| PG trigger var | `SELECT tgname FROM pg_trigger ...` → `trg_enqueue_sor` |
| WhatsApp bagli | OwnPilot UI (localhost:8080) → channel status |
| systemd timer aktif | `systemctl --user status sor-upload.timer` → active |

---

## Referanslar

| Bilgi | Deger |
|-------|-------|
| OwnPilot kaynak | `~/ownpilot/` |
| Branch | `fix/whatsapp-440-reconnect-loop` |
| HEAD | `d9880e8` |
| Container | `ownpilot` (port 8080) |
| DB container | `ownpilot-postgres` |
| Network | `ownpilot-znahub_default` |
| Volume | `ownpilot-znahub_ownpilot-data` → `/app/data` |
| Registry | `localhost:5000` (auth: `registryadmin` / `registry2026`) |
| Cron script | `~/scripts/sor-upload-cron.py` |
| systemd timer | `~/.config/systemd/user/sor-upload.timer` |
| DB creds | `ownpilot` / `ownpilot_secure_2026` @ port 5432 |
| Handoff B+C | `/home/ayaz/ownpilot/.planning/SESSION_HANDOFF_2026-03-07-S33.md` |
