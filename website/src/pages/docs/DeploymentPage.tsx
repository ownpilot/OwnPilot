import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';

const DOCKER_COMPOSE = `version: "3.9"

services:
  ownpilot:
    image: ghcr.io/ownpilot/ownpilot:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
      - POSTGRES_HOST=postgres
      - POSTGRES_PORT=5432
      - POSTGRES_USER=ownpilot
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD}
      - POSTGRES_DB=ownpilot
      - AUTH_TYPE=jwt
      - JWT_SECRET=\${JWT_SECRET}
      - NODE_ENV=production
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      - POSTGRES_USER=ownpilot
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD}
      - POSTGRES_DB=ownpilot
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ownpilot"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:`;

const NGINX = `server {
    listen 80;
    server_name ownpilot.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ownpilot.example.com;

    ssl_certificate /etc/letsencrypt/live/ownpilot.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ownpilot.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}`;

export function DeploymentPage() {
  return (
    <DocsLayout>
      <Badge variant="blue" className="mb-3">
        Deployment
      </Badge>
      <h1>Deployment</h1>
      <p>
        OwnPilot ships as a multi-arch Docker image (amd64 + arm64) at{' '}
        <code>ghcr.io/ownpilot/ownpilot</code>. A single container serves the API, bundled UI, and
        WebSocket on port 8080.
      </p>

      <h2>Docker (Production)</h2>
      <CodeBlock code={DOCKER_COMPOSE} language="yaml" filename="docker-compose.prod.yml" />

      <CodeBlock
        code={`# Create .env with secrets
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)" >> .env
echo "JWT_SECRET=$(openssl rand -base64 64)" >> .env

# Start
docker compose -f docker-compose.prod.yml up -d`}
        language="bash"
      />

      <h2>Environment Variables</h2>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Required</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>PORT</code>
            </td>
            <td>No</td>
            <td>8080</td>
            <td>HTTP server port</td>
          </tr>
          <tr>
            <td>
              <code>HOST</code>
            </td>
            <td>No</td>
            <td>0.0.0.0</td>
            <td>Bind address</td>
          </tr>
          <tr>
            <td>
              <code>NODE_ENV</code>
            </td>
            <td>No</td>
            <td>development</td>
            <td>Set to production</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_HOST</code>
            </td>
            <td>Yes</td>
            <td>localhost</td>
            <td>DB hostname</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_PORT</code>
            </td>
            <td>No</td>
            <td>25432</td>
            <td>DB port</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_USER</code>
            </td>
            <td>Yes</td>
            <td>ownpilot</td>
            <td>DB username</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_PASSWORD</code>
            </td>
            <td>Yes</td>
            <td>—</td>
            <td>DB password (use secret)</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_DB</code>
            </td>
            <td>No</td>
            <td>ownpilot</td>
            <td>DB name</td>
          </tr>
          <tr>
            <td>
              <code>AUTH_TYPE</code>
            </td>
            <td>No</td>
            <td>none</td>
            <td>none | api-key | jwt</td>
          </tr>
          <tr>
            <td>
              <code>JWT_SECRET</code>
            </td>
            <td>If jwt</td>
            <td>—</td>
            <td>JWT signing secret (64+ chars)</td>
          </tr>
          <tr>
            <td>
              <code>API_KEY</code>
            </td>
            <td>If api-key</td>
            <td>—</td>
            <td>Static API key</td>
          </tr>
          <tr>
            <td>
              <code>LOG_LEVEL</code>
            </td>
            <td>No</td>
            <td>info</td>
            <td>error|warn|info|debug</td>
          </tr>
          <tr>
            <td>
              <code>MQTT_BROKER_URL</code>
            </td>
            <td>No</td>
            <td>—</td>
            <td>For IoT/Edge features</td>
          </tr>
        </tbody>
      </table>

      <h2>Reverse Proxy (nginx + TLS)</h2>
      <p>
        For internet-facing deployments, place OwnPilot behind nginx with Let's Encrypt TLS.
        WebSocket proxying and SSE (unbuffered) are both required.
      </p>
      <CodeBlock code={NGINX} language="nginx" filename="ownpilot.conf" />

      <h2>Reverse Proxy (Caddy)</h2>
      <CodeBlock
        code={`# Caddyfile
ownpilot.example.com {
    reverse_proxy localhost:8080
}`}
        language="caddy"
        filename="Caddyfile"
      />
      <p>Caddy handles TLS automatically via Let's Encrypt.</p>

      <h2>Build from source (production)</h2>
      <CodeBlock
        code={`git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
pnpm install
pnpm build
NODE_ENV=production PORT=8080 node packages/gateway/dist/index.js`}
        language="bash"
      />

      <h2>Database backup</h2>
      <CodeBlock
        code={`# Backup
docker exec ownpilot-db pg_dump -U ownpilot ownpilot > backup-$(date +%Y%m%d).sql

# Restore
docker exec -i ownpilot-db psql -U ownpilot ownpilot < backup-20260316.sql`}
        language="bash"
      />

      <h2>Updating</h2>
      <CodeBlock
        code={`# Docker
docker compose pull
docker compose up -d

# From source
git pull
pnpm install
pnpm build
# restart your process manager`}
        language="bash"
      />

      <Callout type="warning" title="Database migrations">
        All migrations are idempotent (<code>IF NOT EXISTS</code>). Updates apply migrations
        automatically on startup. Always backup your database before updating.
      </Callout>

      <h2>Hardware requirements</h2>
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>RAM</th>
            <th>CPU</th>
            <th>Storage</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Minimal</td>
            <td>1 GB</td>
            <td>1 core</td>
            <td>10 GB</td>
            <td>Light personal use</td>
          </tr>
          <tr>
            <td>Recommended</td>
            <td>4 GB</td>
            <td>2 cores</td>
            <td>50 GB</td>
            <td>Multiple agents, workflows</td>
          </tr>
          <tr>
            <td>Power user</td>
            <td>8 GB+</td>
            <td>4+ cores</td>
            <td>100 GB+</td>
            <td>Heavy automation, local LLMs</td>
          </tr>
        </tbody>
      </table>

      {/* Prev navigation */}
      <div className="flex items-center mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/api-reference"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          API Reference
        </Link>
      </div>
    </DocsLayout>
  );
}
