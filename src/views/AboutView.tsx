import { BackBarFor } from "../components/Chrome";
import { AboutContent } from "../components/AboutContent";
import { Modal } from "../components/Modal";
import { PageFlow } from "../components/PageShell";

export default function AboutView({ onBack }: { onBack: () => void }) {
  return (
    <PageFlow width="max-w-3xl" className="px-0 py-0">
      <BackBarFor title="About ASPIRE" onBack={onBack} />
      <div className="px-4 pb-6">
        <AboutContent />
      </div>
    </PageFlow>
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
