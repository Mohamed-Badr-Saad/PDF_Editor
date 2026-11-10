import { BriefcaseBusiness, Globe } from 'lucide-react';
import { AUTHOR, LINKEDIN_URL, PORTFOLIO_URL } from '../lib/credits';

/** "Developed by Mohamed Badr" with links to his portfolio and LinkedIn. */
export function Credit({ className = '' }: { className?: string }) {
  return (
    <p className={`credit ${className}`}>
      <span>
        Developed by <strong>{AUTHOR}</strong>
      </span>
      <span className="credit-links">
        <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">
          <Globe size={14} aria-hidden /> Portfolio
        </a>
        <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer">
          <BriefcaseBusiness size={14} aria-hidden /> LinkedIn
        </a>
      </span>
    </p>
  );
}
