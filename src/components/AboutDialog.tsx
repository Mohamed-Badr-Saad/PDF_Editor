import { Modal } from './Modal';
import { Logo } from './Logo';
import { Credit } from './Credit';
import { APP_VERSION } from '../lib/credits';

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="About PageCraft"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="about">
        <Logo />
        <p className="about-version">Version {APP_VERSION}</p>
        <p>
          A free PDF editor: edit text and images, sign, comment, recognize scanned text in English and Arabic, and
          organize pages. Everything happens on your device, so your files are never uploaded.
        </p>
        <Credit className="about-credit" />
      </div>
    </Modal>
  );
}
