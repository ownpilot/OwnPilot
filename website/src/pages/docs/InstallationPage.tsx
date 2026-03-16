import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Callout } from '@/components/ui/Callout';
import { Badge } from '@/components/ui/Badge';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export function InstallationPage() {
  return (
    <DocsLayout>
      <Badge variant="green" className="mb-3">
        Getting Started
      </Badge>
      <h1>Installation</h1>
      <p>
        This guide covers all prerequisites and manual installation steps. If you want the fastest
        path, see the <a href="/docs/quick-start">Quick Start</a> guide.
      </p>

      <h2>Prerequisites</h2>
      <table>
        <thead>
          <tr>
            <th>Software</th>
            <th>Version</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Node.js</td>
            <td>22+</td>
            <td>Runtime (for source install)</td>
          </tr>
          <tr>
            <td>pnpm</td>
            <td>10+</td>
            <td>Package manager</td>
          </tr>
          <tr>
            <td>Docker</td>
            <td>Latest</td>
            <td>PostgreSQL + optional app container</td>
          </tr>
          <tr>
            <td>Git</td>
            <td>Latest</td>
            <td>Clone repository</td>
          </tr>
        </tbody>
      </table>

      <h3>macOS</h3>
      <CodeBlock
        code={`# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js 22
brew install node@22

# Install Docker Desktop
brew install --cask docker

# Install pnpm
npm install -g pnpm`}
        language="bash"
      />

      <h3>Linux (Ubuntu/Debian)</h3>
      <CodeBlock
        code={`# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs

# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# pnpm
npm install -g pnpm`}
        language="bash"
      />

      <h3>Windows</h3>
      <ol>
        <li>
          Install Node.js 22+ from{' '}
          <a href="https://nodejs.org/" target="_blank" rel="noopener noreferrer">
            nodejs.org
          </a>
        </li>
        <li>
          Install Docker Desktop from{' '}
          <a
            href="https://www.docker.com/products/docker-desktop/"
            target="_blank"
            rel="noopener noreferrer"
          >
            docker.com
          </a>
        </li>
        <li>
          Run <code>npm install -g pnpm</code>
        </li>
      </ol>

      <h2>Clone the repository</h2>
      <CodeBlock
        code={`git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot`}
        language="bash"
      />

      <h2>Install dependencies</h2>
      <CodeBlock code={`pnpm install`} language="bash" />

      <Callout type="warning" title="Windows: pnpm install EPERM">
        On Windows, native <code>.node</code> binaries may be locked by VS Code's TypeScript server.
        Close VS Code before running <code>pnpm install</code>.
      </Callout>

      <h2>Configure environment</h2>
      <CodeBlock code={`cp .env.example .env`} language="bash" />

      <p>Key environment variables:</p>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>PORT</code>
            </td>
            <td>8080</td>
            <td>Gateway API port</td>
          </tr>
          <tr>
            <td>
              <code>UI_PORT</code>
            </td>
            <td>5173</td>
            <td>Vite dev server port</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_HOST</code>
            </td>
            <td>localhost</td>
            <td>Database host</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_PORT</code>
            </td>
            <td>25432</td>
            <td>Database port</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_USER</code>
            </td>
            <td>ownpilot</td>
            <td>Database user</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_PASSWORD</code>
            </td>
            <td>ownpilot_secret</td>
            <td>Database password</td>
          </tr>
          <tr>
            <td>
              <code>POSTGRES_DB</code>
            </td>
            <td>ownpilot</td>
            <td>Database name</td>
          </tr>
          <tr>
            <td>
              <code>AUTH_TYPE</code>
            </td>
            <td>none</td>
            <td>none | api-key | jwt</td>
          </tr>
          <tr>
            <td>
              <code>LOG_LEVEL</code>
            </td>
            <td>info</td>
            <td>error | warn | info | debug</td>
          </tr>
          <tr>
            <td>
              <code>NODE_ENV</code>
            </td>
            <td>development</td>
            <td>development | production</td>
          </tr>
        </tbody>
      </table>

      <h2>Start PostgreSQL</h2>
      <h3>Option A: Docker Compose (recommended)</h3>
      <CodeBlock
        code={`docker compose --profile postgres up -d

# Verify it's ready
docker exec ownpilot-db pg_isready -U ownpilot`}
        language="bash"
      />

      <h3>Option B: Manual Docker</h3>
      <CodeBlock
        code={`docker run -d \\
  --name ownpilot-db \\
  --restart unless-stopped \\
  -e POSTGRES_USER=ownpilot \\
  -e POSTGRES_PASSWORD=ownpilot_secret \\
  -e POSTGRES_DB=ownpilot \\
  -p 25432:5432 \\
  -v ownpilot-postgres-data:/var/lib/postgresql/data \\
  pgvector/pgvector:pg16`}
        language="bash"
      />

      <h2>Build and start</h2>
      <CodeBlock
        code={`# Development mode (hot reload)
pnpm dev

# Production build and start
pnpm build
pnpm start`}
        language="bash"
      />

      <h2>Verify installation</h2>
      <CodeBlock
        code={`# Check gateway health
curl http://localhost:8080/api/v1/health

# Expected response:
# {"status":"ok","version":"0.2.9"}`}
        language="bash"
      />

      <h2>Troubleshooting</h2>

      <h3>Port already in use</h3>
      <CodeBlock
        code={`# macOS/Linux
lsof -i :8080

# Windows
netstat -ano | findstr :8080`}
        language="bash"
      />

      <h3>PostgreSQL connection failed</h3>
      <CodeBlock
        code={`# Check container status
docker ps | grep ownpilot

# Check logs
docker logs ownpilot-db

# Restart container
docker restart ownpilot-db`}
        language="bash"
      />

      <h3>Node.js version too old</h3>
      <CodeBlock
        code={`node --version  # Must be 22+

# Update via nvm
nvm install 22
nvm use 22`}
        language="bash"
      />

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/quick-start"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Quick Start
        </Link>
        <Link
          to="/docs/configuration"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Configuration
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
