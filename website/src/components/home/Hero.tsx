import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Github, Terminal, Shield, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { CodeBlock } from '@/components/ui/CodeBlock';

const DOCKER_QUICKSTART = `# Clone and start OwnPilot
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot

# Start with Docker (PostgreSQL included)
docker compose --profile postgres up -d

# Open http://localhost:8080
# Configure your AI provider in Settings → Config Center`;

const stats = [
  { value: '190+', label: 'Built-in Tools' },
  { value: '96', label: 'AI Providers' },
  { value: '26.5K+', label: 'Tests' },
  { value: 'MIT', label: 'License' },
];

// Floating particle component
function Particle({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="absolute rounded-full bg-[hsl(var(--primary))] opacity-20 animate-pulse"
      style={style}
    />
  );
}

export function Hero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Animated grid/dot background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let frame = 0;
    let animId: number;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame += 0.3;

      // Draw grid dots
      const spacing = 40;
      const isDark = document.documentElement.classList.contains('dark');
      const dotColor = isDark ? 'rgba(139,92,246,0.15)' : 'rgba(109,40,217,0.08)';

      for (let x = 0; x < canvas.width + spacing; x += spacing) {
        for (let y = 0; y < canvas.height + spacing; y += spacing) {
          const dist = Math.sqrt(
            Math.pow(x - canvas.width / 2, 2) + Math.pow(y - canvas.height / 2, 2)
          );
          const wave = Math.sin((dist - frame * 0.5) * 0.03) * 0.5 + 0.5;
          const size = 1.5 + wave * 2;

          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fillStyle = dotColor;
          ctx.fill();
        }
      }

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden bg-[var(--color-bg)]">
      {/* Animated dot grid background */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--color-bg)]/0 via-[var(--color-bg)]/0 to-[var(--color-bg)]" />

      {/* Glow blobs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[var(--brand-blue)] opacity-[0.07] blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] rounded-full bg-[var(--brand-teal)] opacity-[0.07] blur-[100px] pointer-events-none" />

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[
          {
            width: 6,
            height: 6,
            top: '20%',
            left: '15%',
            animationDelay: '0s',
            animationDuration: '3s',
          },
          {
            width: 4,
            height: 4,
            top: '60%',
            left: '80%',
            animationDelay: '1s',
            animationDuration: '4s',
          },
          {
            width: 8,
            height: 8,
            top: '40%',
            left: '85%',
            animationDelay: '0.5s',
            animationDuration: '3.5s',
          },
          {
            width: 5,
            height: 5,
            top: '75%',
            left: '25%',
            animationDelay: '2s',
            animationDuration: '2.5s',
          },
          {
            width: 7,
            height: 7,
            top: '15%',
            left: '70%',
            animationDelay: '1.5s',
            animationDuration: '4.5s',
          },
        ].map((p, i) => (
          <Particle key={i} style={p} />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Text */}
          <div className="text-center lg:text-left">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 mb-6"
            >
              <Badge variant="purple" className="px-3 py-1 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                v0.2.9 — Now with Mini Pomodoro Timer
              </Badge>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.08] tracking-tight mb-6"
            >
              <span className="text-[var(--color-text)]">Your AI. </span>
              <span className="text-gradient">Your Data.</span>
              <br />
              <span className="text-[var(--color-text)]">Your Rules.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg text-[var(--color-text-muted)] leading-relaxed mb-8 max-w-xl mx-auto lg:mx-0"
            >
              Privacy-first personal AI assistant platform with soul agents, autonomous workflows,
              190+ tools, and 96 AI providers.{' '}
              <strong className="text-[var(--color-text)] font-medium">
                Self-hosted. Zero data leaks.
              </strong>
            </motion.p>

            {/* Key badges */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="flex flex-wrap gap-2 justify-center lg:justify-start mb-8"
            >
              {[
                { icon: Shield, text: 'AES-256-GCM' },
                { icon: Cpu, text: '96 AI Providers' },
                { icon: Terminal, text: '190+ Tools' },
              ].map(({ icon: Icon, text }) => (
                <span
                  key={text}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-full px-3 py-1 bg-[var(--color-surface)]"
                >
                  <Icon className="w-3 h-3 text-[hsl(var(--primary))]" />
                  {text}
                </span>
              ))}
            </motion.div>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start"
            >
              <Button
                size="lg"
                onClick={() => window.open('https://github.com/ownpilot/ownpilot', '_blank')}
                className="group"
              >
                <Github className="w-4 h-4" />
                View on GitHub
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() =>
                  document.getElementById('quick-start')?.scrollIntoView({ behavior: 'smooth' })
                }
              >
                Quick Start
              </Button>
            </motion.div>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="grid grid-cols-4 gap-4 mt-12 pt-8 border-t border-[var(--color-border-subtle)]"
            >
              {stats.map(({ value, label }) => (
                <div key={label} className="text-center lg:text-left">
                  <div className="text-2xl font-bold text-[var(--color-text)] leading-none mb-1">
                    {value}
                  </div>
                  <div className="text-xs text-[var(--color-text-subtle)]">{label}</div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Right: Code */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="relative"
          >
            <div className="relative">
              {/* Glow behind code */}
              <div className="absolute inset-0 rounded-2xl bg-[hsl(var(--primary))] opacity-10 blur-3xl" />

              <CodeBlock
                code={DOCKER_QUICKSTART}
                language="bash"
                filename="terminal"
                className="relative shadow-2xl"
              />
            </div>

            {/* Floating badges */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.8 }}
              className="absolute -top-4 -right-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-3 py-2 shadow-lg"
            >
              <div className="text-xs text-[var(--color-text-muted)]">Single port</div>
              <div className="text-sm font-bold text-[hsl(var(--primary))]">:8080</div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 1 }}
              className="absolute -bottom-4 -left-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-3 py-2 shadow-lg"
            >
              <div className="text-xs text-[var(--color-text-muted)]">Test coverage</div>
              <div className="text-sm font-bold text-emerald-500">26,500+ tests</div>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 1.2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <div className="flex flex-col items-center gap-2 text-[var(--color-text-subtle)]">
          <div className="w-5 h-8 rounded-full border border-[var(--color-border)] flex items-start justify-center pt-1.5">
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="w-1 h-1.5 rounded-full bg-[var(--color-text-subtle)]"
            />
          </div>
        </div>
      </motion.div>
    </section>
  );
}
