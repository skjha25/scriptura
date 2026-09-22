// frontend/src/components/layout/BrandLogo.js
/**
 * The Scriptura wordmark. Extracted out of AppLayout so the landing page and
 * login screen can share the exact same mark.
 */

export default function BrandLogo({ className = '' }) {
  return (
    <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-white shadow-sm ${className}`}>
      <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
        />
      </svg>
    </div>
  );
}
