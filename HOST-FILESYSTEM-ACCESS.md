# OwnPilot Host Filesystem Access

## Overview

OwnPilot can access host (local) files via Docker bind mounts. This enables AI models to read, write, and manage files on your machine directly from the OwnPilot chat interface — no manual file transfers needed.

The access level is configured at **deploy time** via Docker volumes and environment variables. It **cannot be changed from inside the app** — only by modifying the Docker compose/run command.

---

## Security Profiles

### Profile 1: Full Home Access (Maximum Flexibility)

**Best for:** Single-user, local development, "Claude Code-like" experience.

```yaml
services:
  ownpilot:
    volumes:
      - /home/USERNAME:/host-home:rw
    environment:
      - OWNPILOT_HOST_FS=/host-home
      - OWNPILOT_HOST_FS_LABEL=Local Files
```

| | |
|---|---|
| **Read** | All files in home directory |
| **Write** | All files in home directory |
| **Risk** | AI can access .env, credentials, SSH keys |
| **Mitigation** | Trust your AI provider, use API keys not passwords |

**Docker run equivalent:**
```bash
docker run -d --name ownpilot \
  -v /home/USERNAME:/host-home:rw \
  -e OWNPILOT_HOST_FS=/host-home \
  -e OWNPILOT_HOST_FS_LABEL="Local Files" \
  ... # other flags
```

---

### Profile 2: Selective Directories (Balanced)

**Best for:** Team environments, shared machines, moderate security needs.

```yaml
services:
  ownpilot:
    volumes:
      - /home/USERNAME/Downloads:/host-fs/Downloads:rw
      - /home/USERNAME/projects:/host-fs/projects:rw
      - /home/USERNAME/Documents:/host-fs/Documents:rw
    environment:
      - OWNPILOT_HOST_FS=/host-fs
      - OWNPILOT_HOST_FS_LABEL=Selected Folders
```

| | |
|---|---|
| **Read** | Only mounted directories |
| **Write** | Only mounted directories |
| **Risk** | Limited to chosen dirs — no .ssh, .env, credentials |
| **Mitigation** | Mount only what you need |

---

### Profile 3: Read-Only Access (Maximum Security)

**Best for:** Production, shared/public instances, compliance environments.

```yaml
services:
  ownpilot:
    volumes:
      - /home/USERNAME:/host-home:ro
    environment:
      - OWNPILOT_HOST_FS=/host-home
      - OWNPILOT_HOST_FS_LABEL=Local Files (Read-Only)
```

| | |
|---|---|
| **Read** | All files in home directory |
| **Write** | NONE — read-only mount |
| **Risk** | AI can see files but cannot modify anything |
| **Mitigation** | Zero write risk, credentials still visible |

**With sensitive file masking:**
```yaml
volumes:
  - /home/USERNAME:/host-home:ro
  - /dev/null:/host-home/.ssh:ro          # Mask SSH keys
  - /dev/null:/host-home/.gnupg:ro        # Mask GPG keys
  - /dev/null:/host-home/.env:ro          # Mask env files
```

---

## Profile Comparison

| Feature | Profile 1 | Profile 2 | Profile 3 |
|---------|-----------|-----------|-----------|
| Read all files | Yes | Selected only | Yes |
| Write files | Yes | Selected only | No |
| AI can download files | Yes | To mounted dirs | No |
| Credential exposure | Yes | No | Yes (readable) |
| Setup complexity | Simple | Medium | Simple |
| Best for | Solo dev | Teams | Public/prod |

---

## How It Works

1. **Docker volume mount** maps host paths into the container
2. **`OWNPILOT_HOST_FS`** env var tells the OwnPilot backend where to find the mounted host filesystem
3. **Backend** auto-registers a virtual file workspace pointing to that path
4. **UI Files tab** shows the host filesystem tree
5. **AI models** can reference files by path in chat: "read /host-home/Downloads/report.pdf"

---

## Usage Examples

```
User: "Downloads'tan son eklenen PDF'i oku"
AI:   Scans /host-home/Downloads/ → finds latest .pdf → reads content

User: "Bu raporu projects/reports/ altina kaydet"
AI:   Writes to /host-home/projects/reports/report.md

User: ".claude/MEMORY.md dosyasini goster"
AI:   Reads /host-home/.claude/MEMORY.md → displays content
```

---

## Disabling Access

Remove the volume mount and environment variables. Restart the container. No filesystem access.

```yaml
services:
  ownpilot:
    # volumes: (removed)
    # environment: OWNPILOT_HOST_FS removed
```
