import type { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div dir="rtl" lang="ar" className="min-h-[100dvh] bg-[#0A0A0A] text-white font-tajawal">
      <div className="mx-auto max-w-[1200px]">
        {children}
      </div>
    </div>
  );
}
