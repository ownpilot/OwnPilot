import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Hero } from '@/components/home/Hero';
import { Features } from '@/components/home/Features';
import { QuickStart } from '@/components/home/QuickStart';
import { Architecture } from '@/components/home/Architecture';
import { CTA } from '@/components/home/CTA';

export function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <Header />
      <main>
        <Hero />
        <Features />
        <QuickStart />
        <Architecture />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
