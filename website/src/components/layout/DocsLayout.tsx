import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { DocsSidebar } from './DocsSidebar';
import { Header } from './Header';
import { Footer } from './Footer';
import { cn } from '@/lib/utils';

interface DocsLayoutProps {
  children: React.ReactNode;
  toc?: React.ReactNode;
}

export function DocsLayout({ children, toc }: DocsLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <Header />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16">
        <div className="flex gap-8 py-10">
          {/* Sidebar desktop */}
          <aside className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-24 overflow-y-auto max-h-[calc(100vh-6rem)] pb-8 pr-4">
              <DocsSidebar />
            </div>
          </aside>

          {/* Mobile sidebar toggle */}
          <div className="lg:hidden fixed bottom-6 right-6 z-40">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="w-12 h-12 rounded-full bg-[hsl(var(--primary))] text-white shadow-lg shadow-[hsl(var(--primary)/0.4)] flex items-center justify-center cursor-pointer"
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

          {/* Mobile sidebar overlay */}
          {sidebarOpen && (
            <div
              className="lg:hidden fixed inset-0 z-30 bg-black/50"
              onClick={() => setSidebarOpen(false)}
            >
              <div
                className="absolute left-0 top-0 bottom-0 w-72 bg-[var(--color-bg)] p-6 overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mt-16">
                  <DocsSidebar />
                </div>
              </div>
            </div>
          )}

          {/* Main content */}
          <main className={cn('flex-1 min-w-0', toc ? 'lg:pr-8' : '')}>
            <div className="prose-docs max-w-3xl">{children}</div>
          </main>

          {/* Table of contents */}
          {toc && (
            <aside className="hidden xl:block w-56 shrink-0">
              <div className="sticky top-24">{toc}</div>
            </aside>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
