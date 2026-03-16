import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { Github, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function CTA() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section className="py-24 bg-[var(--color-bg-subtle)] relative overflow-hidden">
      {/* Gradient blobs */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full bg-[hsl(262,83%,58%)] opacity-5 blur-[100px] pointer-events-none" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10" ref={ref}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] mb-8">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Open source · MIT License · Self-hosted
          </div>

          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-[var(--color-text)] mb-6 leading-[1.1]">
            Ready to own your <span className="text-gradient">AI assistant?</span>
          </h2>

          <p className="text-xl text-[var(--color-text-muted)] mb-10 max-w-2xl mx-auto leading-relaxed">
            Join the growing community of privacy-conscious developers and power users who self-host
            OwnPilot. Your data. Your infrastructure. Your rules.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Button
              size="lg"
              onClick={() => window.open('https://github.com/ownpilot/ownpilot', '_blank')}
              className="group text-base"
            >
              <Github className="w-5 h-5" />
              Star on GitHub
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() =>
                window.open('https://github.com/ownpilot/ownpilot#quick-start', '_blank')
              }
              className="text-base"
            >
              Quick Start →
            </Button>
          </div>

          {/* Features list */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            {[
              { icon: '🔒', title: 'Zero telemetry', desc: 'Your data never leaves your server' },
              { icon: '⚡', title: 'One command', desc: "docker compose up and you're live" },
              { icon: '🔧', title: 'Fully extensible', desc: 'Skills, plugins, custom tools, MCP' },
            ].map((item) => (
              <div
                key={item.title}
                className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]"
              >
                <div className="text-2xl mb-2">{item.icon}</div>
                <div className="text-sm font-semibold text-[var(--color-text)] mb-1">
                  {item.title}
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">{item.desc}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
