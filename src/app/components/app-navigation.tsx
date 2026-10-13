'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export type AppPage = 'home' | 'study-plan' | 'analytics';

const links: Array<{ href: string; id: AppPage; label: string; icon: string }> = [
  { href: '/', id: 'home', label: 'Home', icon: '🏠' },
  { href: '/study-plan', id: 'study-plan', label: 'Schedule', icon: '📅' },
  { href: '/analytics', id: 'analytics', label: 'Analytics', icon: '📊' },
];

export default function AppNavigation({
  activePage,
}: {
  activePage: AppPage;
}) {
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);
  const logoutButtonRef = useRef<HTMLButtonElement>(null);
  const cancelLogoutButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isLogoutDialogOpen) return;

    const logoutButton = logoutButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelLogoutButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsLogoutDialogOpen(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      logoutButton?.focus();
    };
  }, [isLogoutDialogOpen]);

  return (
    <aside className="app-topbar">
      <Link className="app-brand" href="/" aria-label="Study Scheduler dashboard">
        <span className="app-brand-mark" aria-hidden="true">S</span>
        <span>Smart<br />Study Planner</span>
      </Link>
      <nav className="app-navigation" aria-label="เมนูหลัก">
        {links.map((link) => (
          <Link
            className={`app-navigation-link ${activePage === link.id ? 'app-navigation-active' : ''}`}
            href={link.href}
            key={link.id}
            aria-current={activePage === link.id ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden="true">{link.icon}</span>
            <span>{link.label}</span>
          </Link>
        ))}
        <button
          ref={logoutButtonRef}
          className="app-navigation-link app-navigation-logout"
          type="button"
          onClick={() => setIsLogoutDialogOpen(true)}
        >
          <span className="nav-icon" aria-hidden="true">↪</span>
          <span>Logout</span>
        </button>
      </nav>
      {isLogoutDialogOpen && (
        <div
          className="logout-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsLogoutDialogOpen(false);
          }}
        >
          <section
            className="logout-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-dialog-title"
            aria-describedby="logout-dialog-description"
          >
            <h2 id="logout-dialog-title">ออกจากระบบ</h2>
            <p id="logout-dialog-description">ต้องการออกจากบัญชีนี้หรือไม่?</p>
            <div className="logout-dialog-actions">
              <button
                ref={cancelLogoutButtonRef}
                className="logout-dialog-cancel"
                type="button"
                onClick={() => setIsLogoutDialogOpen(false)}
              >
                ยกเลิก
              </button>
              <form action="/api/auth/logout" method="post">
                <button className="logout-dialog-confirm" type="submit">ออกจากระบบ</button>
              </form>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}