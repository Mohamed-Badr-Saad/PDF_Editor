import { BriefcaseBusiness, Globe } from 'lucide-react';
import { AUTHOR, LINKEDIN_URL, PORTFOLIO_URL } from '../lib/credits';

/** "Developed by Mohamed Badr" with links to his portfolio and LinkedIn. */
export function Credit({ className = '' }: { className?: string }) {
  return (
    <p className={`credit ${className}`}>
      <span>
        <span className="credit-dev">Developed by </span>
        <strong>{AUTHOR}</strong>
      </span>
      <span className="credit-links">
        <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer" aria-label={`${AUTHOR}'s portfolio`} title="Portfolio">
          <Globe size={14} aria-hidden /> <span className="credit-label">Portfolio</span>
        </a>
        <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" aria-label={`${AUTHOR} on LinkedIn`} title="LinkedIn">
          <BriefcaseBusiness size={14} aria-hidden /> <span className="credit-label">LinkedIn</span>
        </a>
      </span>
    </p>
  );
}
