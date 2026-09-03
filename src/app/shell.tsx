"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "cbtlab.rail.collapsed";

/**
 * The app shell: a collapsible left rail beside the scrolling main column.
 *
 * The rail's contents are passed in as `rail` rather than built here, so they
 * stay a server component — the layout still resolves the session on the server
 * and this file never learns who is signed in. All this component owns is
 * whether the rail is open.
 *
 * The open/closed choice is read from localStorage in an effect rather than
 * during render. Reading it during render would produce markup that disagrees
 * with the server's, which React reports as a hydration error; the cost is that
 * a collapsed rail is briefly visible on first paint, which is the cheaper of
 * the two problems. Every access is wrapped, because storage throws outright in
 * some privacy modes rather than returning null.
 */
export function Shell({
  rail,
  children,
}: {
  rail: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Storage unavailable. The default (open) is the safe one.
    }
  }, []);

  function toggle() {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Preference simply does not persist. Not worth surfacing.
      }
      return next;
    });
  }

  return (
    <div className={"shell" + (collapsed ? " is-collapsed" : "")}>
      {collapsed ? (
        <button
          type="button"
          className="rail-open"
          onClick={toggle}
          aria-expanded={false}
          aria-label="Open navigation"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}

      <aside className="rail">
        <button
          type="button"
          className="rail-close"
          onClick={toggle}
          aria-expanded
          aria-label="Close navigation"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        {rail}
      </aside>

      {children}
    </div>
  );
}
