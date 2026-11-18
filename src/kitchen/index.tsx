// Agent 4 builds this screen. Placeholder from the foundation.
import { PageHeader } from '@shared/ui';
import { useHeartbeat } from '@shared/data';

export default function Kitchen() {
  useHeartbeat('kitchen');
  return (
    <main className="t-page">
      <PageHeader title="Kitchen" sub="Being built" />
    </main>
  );
}
