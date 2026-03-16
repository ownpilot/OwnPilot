import { Link } from 'react-router';
import { Github, Shield, Heart } from 'lucide-react';

const footerLinks = {
  Product: [
    { label: 'Features', href: '/#features' },
    { label: 'Architecture', href: '/docs/architecture' },
    { label: 'Changelog', href: '/changelog' },
    { label: 'Roadmap', href: 'https://github.com/ownpilot/ownpilot/issues' },
  ],
  Documentation: [
    { label: 'Getting Started', href: '/docs/getting-started' },
    { label: 'Quick Start', href: '/docs/quick-start' },
    { label: 'API Reference', href: '/docs/api-reference' },
    { label: 'Deployment', href: '/docs/deployment' },
  ],
  Community: [
    { label: 'GitHub', href: 'https://github.com/ownpilot/ownpilot', external: true },
    { label: 'Issues', href: 'https://github.com/ownpilot/ownpilot/issues', external: true },
    {
      label: 'Discussions',
      href: 'https://github.com/ownpilot/ownpilot/discussions',
      external: true,
    },
    {
      label: 'Contributing',
      href: 'https://github.com/ownpilot/ownpilot/blob/main/CONTRIBUTING.md',
      external: true,
    },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-12">
          {/* Brand */}
          <div className="md:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <img src="/logo.jpeg" alt="OwnPilot" className="w-8 h-8 rounded-lg object-contain" />
              <span className="font-bold text-lg text-[var(--color-text)]">OwnPilot</span>
            </Link>
            <p className="text-sm text-[var(--color-text-muted)] leading-relaxed mb-4 max-w-xs">
              Privacy-first personal AI assistant platform. Self-hosted. Your data stays yours.
            </p>
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-subtle)]">
              <Shield className="w-3.5 h-3.5" />
              <span>MIT License</span>
              <span className="mx-1">·</span>
              <span>v0.2.9</span>
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([section, links]) => (
            <div key={section}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-subtle)] mb-4">
                {section}
              </h3>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    {'external' in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        to={link.href}
                        className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-8 border-t border-[var(--color-border)] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-[var(--color-text-subtle)]">© 2026 OwnPilot. MIT License.</p>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/ownpilot/ownpilot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
              aria-label="GitHub"
            >
              <Github className="w-4 h-4" />
            </a>
            <p className="text-xs text-[var(--color-text-subtle)] flex items-center gap-1">
              Built with <Heart className="w-3 h-3 text-red-400" /> for privacy
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
