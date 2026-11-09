/** Wordmark: a folded page with a highlighter stroke. */
export function Logo() {
  return (
    <span className="logo">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <path d="M7 3h12l7 7v17a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="#fff" />
        <path d="M19 3v5a2 2 0 0 0 2 2h5" fill="#C9D3DF" />
        <rect x="8" y="16" width="15" height="6" rx="1" fill="#FFE45C" transform="rotate(-6 15 19)" />
        <path d="M9 13h9M9 25h12" stroke="#1B2A41" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className="logo-word">PageCraft</span>
    </span>
  );
}
