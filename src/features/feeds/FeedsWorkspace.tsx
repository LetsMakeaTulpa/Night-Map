import { dataset } from '../../data';
import { useStore } from '../../state/store';

export type FeedKind = 'cctv' | 'radio';

interface FeedContent {
  eyebrow: string;
  title: string;
  status: string;
  statusNote: string;
  why: string[];
  checkedTitle: string;
  checked: { label: string; url: string; note: string }[];
  insteadTitle: string;
  instead: string;
  layerIds: string[];
  layerBlurb: string;
}

const CONTENT: Record<FeedKind, FeedContent> = {
  cctv: {
    eyebrow: 'Camera footage',
    title: 'CCTV',
    status: 'No live feed',
    statusNote: 'Nothing to play here, and that is the honest answer rather than a missing button.',
    why: [
      'Night Map could not find any public live camera feed for San Francisco, with or without a licence that would allow an app to embed it. The City’s traffic-camera pages are browsable pages, not a feed.',
      'There is also no register of where the City’s cameras are. The City publishes an inventory of surveillance technologies department by department, not positions; the transport agency’s reports describe its camera systems without placing them; and the Police Department has stated it will not create a registry of cameras owned by non-City entities.',
      'Building a layer from those documents would mean inferring positions this app cannot support. It will not do that, and Atlas → Disclosures lists the documents with that gap stated next to each one.',
    ],
    checkedTitle: 'What was actually read',
    checked: [
      {
        label: 'Surveillance Technology Inventory',
        url: 'https://www.sf.gov/surveillance-technology-inventory',
        note: 'City inventory of technologies, department by department. No positions published.',
      },
      {
        label: 'MTA Biannual Surveillance Report 2026',
        url: 'https://www.sf.gov/mta-all-technology-biannual-surveillance-report-2026',
        note: 'Describes red-light, speed and security cameras and their purposes. Places none of them.',
      },
      {
        label: 'SFPD Bureau Order 23-01: Non-City Entity Surveillance Cameras',
        url: 'https://www.sanfranciscopolice.org/your-sfpd/policies/bureau-order/23-01-1',
        note: 'States the Department will not establish a registry of non-City cameras.',
      },
    ],
    insteadTitle: 'What you can use instead',
    instead:
      'The City does publish records of what was dispatched and reported, and Night Map plots those honestly as snapshots rather than as a feed: calls that have already closed, 311 requests published nightly. Neither is live, neither has audio or narrative, and the sensitive calls the City withholds are absent.',
    layerIds: ['calls-recent', 'cases-311'],
    layerBlurb: 'Turn on the two published snapshot layers and return to the map.',
  },
  radio: {
    eyebrow: 'Scanners and dispatch audio',
    title: 'Radio',
    status: 'No public audio',
    statusNote: 'There is no live police or fire audio to patch into, so none is claimed.',
    why: [
      'San Francisco Police Department radio has been encrypted since 2021. That is the whole reason a scanner feed does not exist: the traffic is not in the clear, so there is nothing to receive.',
      'No public source publishes live incident audio for the city either, and Night Map has no lawful public stream to embed.',
      'What is published instead is a record of calls for service, and even that is partial by design: the City releases only calls that have already closed, withholds every call it flags sensitive, and publishes no audio, no narrative and no caller detail.',
    ],
    checkedTitle: 'The nearest thing that is published',
    checked: [
      {
        label: 'Law Enforcement Dispatched Calls for Service: Real-Time',
        url: 'https://data.sf.gov/d/gnap-fj3t',
        note: 'Closed calls only, sensitive calls withheld, positions given as an intersection or block.',
      },
      {
        label: '311 Cases',
        url: 'https://data.sf.gov/d/vw6y-z8j6',
        note: 'Nightly service requests, often already resolved by the time they are read.',
      },
    ],
    insteadTitle: 'What you can use instead',
    instead:
      'The dispatched-call snapshot is the closest published substitute. It is a record, not a live feed: a call that is happening now is absent from it, and a dot on the map means a call was logged near a block, never that anything is happening there at the moment you look.',
    layerIds: ['calls-recent'],
    layerBlurb: 'Turn on the dispatched-call snapshot and return to the map.',
  },
};

/**
 * A status panel, deliberately not a feed. It exists because people look for a
 * scanner or camera button, and the useful answer is why there is none.
 */
export function FeedsWorkspace({ kind }: { kind: FeedKind }) {
  const { state, actions } = useStore();
  const content = CONTENT[kind];
  const allOn = content.layerIds.every((id) => state.layers[id]);
  const published = dataset.data.disclosures.filter((entry) =>
    kind === 'cctv' ? entry.documentType !== 'privacy_statement' : true,
  );

  const showSnapshots = () => {
    for (const id of content.layerIds) actions.setLayer(id, true);
    actions.setWorkspace('map');
    actions.setSheet('collapsed');
    actions.notify(
      `${kind === 'cctv' ? 'Reported activity' : 'Dispatched calls'} turned on as a published snapshot — not a live feed.`,
      'warn',
    );
  };

  return (
    <div className="workspace-panel feeds">
      <header className="workspace-head">
        <div>
          <p className="eyebrow">{content.eyebrow}</p>
          <h2>{content.title}</h2>
          <p className="muted small">
            This is a truthful status page, not a player. It is here so the question “where is the live feed?” has a
            visible answer.
          </p>
        </div>
      </header>

      <div className="feed-status" role="status">
        <strong>{content.status}</strong>
        <span>{content.statusNote}</span>
      </div>

      <section>
        <h3>Why there is nothing here</h3>
        <ul className="plain-list">
          {content.why.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3>{content.checkedTitle}</h3>
        <ul className="feed-sources">
          {content.checked.map((item) => (
            <li key={item.url}>
              <a href={item.url} target="_blank" rel="noreferrer noopener">
                {item.label}
              </a>
              <span className="muted small">{item.note}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">
          {published.length} disclosure {published.length === 1 ? 'document is' : 'documents are'} listed in Atlas →
          Disclosures with what each one does and does not say.
        </p>
      </section>

      <section>
        <h3>{content.insteadTitle}</h3>
        <p>{content.instead}</p>
        <div className="button-row">
          <button type="button" className="button primary small" onClick={showSnapshots}>
            {allOn ? 'Show the snapshots on the map' : content.layerBlurb}
          </button>
          <button
            type="button"
            className="button ghost small"
            onClick={() => {
              actions.setWorkspace('atlas');
              actions.setSheet('peek');
            }}
          >
            Open the City’s disclosure documents
          </button>
        </div>
      </section>

      <p className="notice">
        If an official live feed with published terms ever exists, this is where it belongs — with its licence, its
        retention and its blind spots stated alongside it. Until then, this panel stays empty on purpose rather than
        decorated with something that looks live and is not.
      </p>
    </div>
  );
}
