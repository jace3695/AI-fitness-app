import { createRoot } from 'react-dom/client';
import { EmptyListFixture, MotionFixture, StaticPoseFixture } from './BasicFixtures';
import AssessmentFixture from './AssessmentFixture';
import ReplyFixture from './ReplyFixture';
import '../../../app/globals.css';
import '../../../app/language/language.css';

const scenario = new URLSearchParams(location.search).get('case');
const fixture = scenario === 'assessment' ? <AssessmentFixture />
  : scenario === 'reply' ? <ReplyFixture />
    : scenario === 'motion' ? <MotionFixture />
      : scenario === 'static' ? <StaticPoseFixture /> : <EmptyListFixture />;
createRoot(document.getElementById('root')!).render(<>
  <header className="mx-auto max-w-3xl p-3 text-xs text-slate-600">
    Isolated synthetic component QA — not the authenticated Next application, a personal recommendation, or hosted service verification.
  </header>
  <main id="fixture-root" className="mx-auto max-w-3xl p-3">
    {scenario === 'assessment' ? <div className="language-app-shell">{fixture}</div> : fixture}
  </main>
</>);
