import { BackBarFor } from "../components/Chrome";
import { AboutContent } from "../components/AboutContent";
import { Modal } from "../components/Modal";

export default function AboutView({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <BackBarFor title="About ASPIRE" onBack={onBack} />
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <AboutContent />
      </div>
    </div>
  );
}

/** Login-sheet wrapper used before sign-in: full-screen sheet on phones, centered modal ≥768. */
export function AboutSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About ASPIRE" onClose={onClose} xwide fullScreen>
      <AboutContent />
    </Modal>
  );
}
