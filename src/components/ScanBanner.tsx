import { ScanText, X } from 'lucide-react';
import { useStore } from '../state/store';
import { formatPageList, usePendingScans } from '../lib/scanDetect';

/** Shown as soon as a document with scanned pages opens. */
export function ScanBanner() {
  const pending = usePendingScans();
  const pages = useStore((s) => s.present.pages);
  const closed = useStore((s) => s.scanBannerClosed);
  if (!pending.length || closed) return null;
  const nums = pending.map((p) => pages.indexOf(p) + 1);
  const label = nums.length === 1 ? `Page ${nums[0]} looks like a scan.` : `Pages ${formatPageList(nums)} look like scans.`;
  return (
    <div className="scan-banner" role="status">
      <ScanText size={18} aria-hidden />
      <span>
        <strong>{label}</strong> <span className="scan-more">Recognize the text to search, select, copy and edit it.</span>
      </span>
      <button className="btn btn-primary" onClick={() => useStore.getState().openDialog('ocr')}>
        Recognize<span className="scan-more"> text</span>
      </button>
      <button className="icon-btn" aria-label="Hide this message" onClick={() => useStore.setState({ scanBannerClosed: true })}>
        <X size={16} />
      </button>
    </div>
  );
}
