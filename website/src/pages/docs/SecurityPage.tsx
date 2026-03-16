import { DocsLayout } from '@/components/layout/DocsLayout';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export function SecurityPage() {
  return (
    <DocsLayout>
      <Badge variant="red" className="mb-3">
        Security
      </Badge>
      <h1>Security Overview</h1>
      <p>
        OwnPilot is built with a security-first mindset. Multiple layers of protection ensure that
        your data stays private and that autonomous agents can't do unintended damage.
      </p>

      <h2>4-Layer Code Execution Security</h2>
      <p>When an agent executes code, all four layers are applied:</p>
      <ol>
        <li>
          <strong>Critical pattern blocking</strong> — 100+ regex patterns block dangerous
          operations (rm -rf, format drives, network exfiltration, credential access) before any
          code runs
        </li>
        <li>
          <strong>Permission matrix</strong> — Per-user, per-tool permissions control what code is
          allowed to do
        </li>
        <li>
          <strong>Approval callback</strong> — For sensitive operations, a real-time SSE approval
          dialog appears in the UI with a 120-second timeout
        </li>
        <li>
          <strong>Sandbox isolation</strong> — Code runs in Docker containers (strongest), VM2
          sandboxes, or Worker threads depending on configuration
        </li>
      </ol>

      <h2>Encryption</h2>
      <p>
        All encryption is implemented using only Node.js built-ins — zero external dependencies:
      </p>
      <ul>
        <li>
          <strong>AES-256-GCM</strong> — Authenticated encryption for sensitive stored data (API
          keys, memories)
        </li>
        <li>
          <strong>PBKDF2</strong> — Key derivation for password-based encryption
        </li>
        <li>
          <strong>SHA-256</strong> — Hash chain verification for audit logs
        </li>
        <li>
          <strong>RSA</strong> — Asymmetric encryption where needed
        </li>
      </ul>

      <h2>PII Detection & Redaction</h2>
      <p>OwnPilot detects and can redact 15+ categories of personally identifiable information:</p>
      <ul>
        <li>Social Security Numbers (SSN)</li>
        <li>Credit card numbers</li>
        <li>Email addresses</li>
        <li>Phone numbers</li>
        <li>IP addresses</li>
        <li>Passport numbers</li>
        <li>Driver's license numbers</li>
        <li>Bank account numbers</li>
        <li>Medical record identifiers</li>
        <li>Dates of birth</li>
        <li>Full names with context</li>
        <li>Physical addresses</li>
        <li>National ID numbers</li>
        <li>And more...</li>
      </ul>

      <h2>Tamper-Evident Audit Logs</h2>
      <p>
        All tool executions and significant events are logged in a tamper-evident audit log. Each
        log entry includes a cryptographic hash that chains to the previous entry, making any
        modification detectable.
      </p>

      <h2>SSRF Protection</h2>
      <p>OwnPilot prevents Server-Side Request Forgery (SSRF) attacks through two mechanisms:</p>
      <ul>
        <li>
          <code>isBlockedUrl()</code> — Synchronous hostname check that blocks private IP ranges
          (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, localhost, etc.) before any request is made
        </li>
        <li>
          <code>isPrivateUrlAsync()</code> — DNS rebinding detection with a 1-minute cache. Resolves
          the hostname and checks if the resulting IP is in a private range.
        </li>
      </ul>
      <p>
        Applied in browser service, <code>/fetch-url</code>, and web-fetch executors.
      </p>

      <h2>Authentication Modes</h2>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>Description</th>
            <th>Use case</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>none</code>
            </td>
            <td>No authentication required</td>
            <td>Local development, trusted network</td>
          </tr>
          <tr>
            <td>
              <code>api-key</code>
            </td>
            <td>Static API key in Authorization header</td>
            <td>Single-user, scripted access</td>
          </tr>
          <tr>
            <td>
              <code>jwt</code>
            </td>
            <td>JWT tokens with configurable expiry</td>
            <td>Multi-user, production deployments</td>
          </tr>
        </tbody>
      </table>

      <h2>Rate Limiting</h2>
      <p>
        Sliding window rate limiter with burst support. Configured per-route and globally. Rate
        limiter state is stored in memory with TTL cleanup to prevent memory leaks.
      </p>

      <h2>Autonomy Levels</h2>
      <p>5 autonomy levels control how much agents can do without human approval:</p>
      <table>
        <thead>
          <tr>
            <th>Level</th>
            <th>Behavior</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Manual</td>
            <td>All actions require explicit approval</td>
          </tr>
          <tr>
            <td>Assisted</td>
            <td>Low-risk auto-execute; high-risk require approval</td>
          </tr>
          <tr>
            <td>Supervised</td>
            <td>Most auto-execute; critical patterns blocked</td>
          </tr>
          <tr>
            <td>Autonomous</td>
            <td>Full access with audit logging</td>
          </tr>
          <tr>
            <td>Full (Claw)</td>
            <td>Maximum autonomy for crew orchestration</td>
          </tr>
        </tbody>
      </table>

      <Callout type="warning" title="Production security">
        For production deployments, always set <code>AUTH_TYPE=jwt</code> and use a strong
        <code>JWT_SECRET</code>. If exposing OwnPilot to the internet, place it behind a reverse
        proxy (nginx/Caddy) with TLS.
      </Callout>

      <h2>Extension Security Audit</h2>
      <p>
        Before installing extensions or skills, OwnPilot performs an LLM-powered security analysis
        that checks for dangerous patterns, unusual permissions requests, and potential data
        exfiltration. A <strong>Permission Review Modal</strong> shows all requested permissions
        before activation.
      </p>

      <h2>Channel Security</h2>
      <ul>
        <li>Per-channel rotating pairing keys for ownership verification</li>
        <li>Channel user approval system with multi-step verification</li>
        <li>User blocking/unblocking with real-time notifications</li>
        <li>WhatsApp anti-ban safety filters and auto-reply protection</li>
      </ul>

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/configuration"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Configuration
        </Link>
        <Link
          to="/docs/api-reference"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          API Reference
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
