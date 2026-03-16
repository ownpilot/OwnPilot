import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, Home, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-24">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-lg"
        >
          {/* 404 number */}
          <div className="text-[10rem] font-black leading-none text-transparent bg-clip-text bg-gradient-to-b from-[hsl(var(--primary)/0.5)] to-transparent mb-4">
            404
          </div>

          <h1 className="text-2xl font-bold text-[var(--color-text)] mb-3">Page not found</h1>
          <p className="text-[var(--color-text-muted)] mb-10 leading-relaxed">
            The page you're looking for doesn't exist or has been moved. Let's get you back on
            track.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" onClick={() => window.history.back()} variant="secondary">
              <ArrowLeft className="w-4 h-4" />
              Go back
            </Button>
            <Link to="/">
              <Button size="lg">
                <Home className="w-4 h-4" />
                Home
              </Button>
            </Link>
            <Link to="/docs/introduction">
              <Button size="lg" variant="outline">
                <BookOpen className="w-4 h-4" />
                Docs
              </Button>
            </Link>
          </div>
        </motion.div>
      </main>
      <Footer />
    </div>
  );
}
