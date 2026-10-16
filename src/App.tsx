import docsText from '../docs/ONBOARD_TECH_PAPER.md?raw';

const BRAND = 'onboard';
const X_HANDLE = '@useonboardapp';
const X_URL = 'https://x.com/useonboardapp';
const PUMP_JOIN_URL = 'https://pump.fun/join/x';

const points = [
  ['Tag Onboard', `Reply ${X_HANDLE} under a post when you want help getting started.`],
  ['It reads the context', 'Onboard uses the original post, your request, and available profile context to understand what you actually need.'],
  ['It builds your path', 'OpenRouter turns that context into simple, personalized next steps instead of repeating one canned answer.'],
  ['It gives you the door', 'Every reply includes the signup route and a QR referral link so you can continue immediately.'],
] as const;

const examples = [
  ['I am new here', 'Ask for the shortest path from curious to signed up.'],
  ['How do I get started?', 'Get a clear answer based on what you actually asked.'],
  ['What is this?', 'Give Onboard the post and it will explain the relevant next step.'],
  ['I am stuck', 'Tag the bot again and get a more specific follow-up.'],
] as const;

export default function App() {
  const isDocs = window.location.pathname.replace(/\/$/, '') === '/docs';
  return isDocs ? <DocsPage /> : <HomePage />;
}

function HomePage() {
  return (
    <main className="onboard-page">
      <header className="onboard-nav">
        <a className="onboard-brand" href="#top" aria-label="onboard home">
          <img src="/onboard-logo.png" alt="Onboard" />
          <span>{BRAND}</span>
        </a>
        <div className="onboard-actions">
          <a href="/docs">how it works</a>
          <a href={X_URL} target="_blank" rel="noreferrer">tag the bot</a>
          <a href={PUMP_JOIN_URL} target="_blank" rel="noreferrer">signup ↗</a>
        </div>
      </header>

      <section id="top" className="onboard-hero">
        <h1>get onboarded.</h1>
        <p>
          Tag {X_HANDLE} under any post. Onboard reads what you mean, uses OpenRouter to shape a useful answer, and gives you the exact next step to sign up.
        </p>
        <div className="onboard-cta-row">
          <a href={X_URL} target="_blank" rel="noreferrer">open X</a>
          <a href={PUMP_JOIN_URL} target="_blank" rel="noreferrer">start signup</a>
          <a href="#tech">see how</a>
        </div>
      </section>

      <section className="onboard-invite" aria-label="get started">
        <div className="onboard-invite-copy">
          <span>your way in</span>
          <h2>One tag. A custom path forward.</h2>
          <p>Onboard turns a public question into a simple answer, a signup route, and a QR code you can scan when you are ready.</p>
          <div className="onboard-cta-row">
            <a href={PUMP_JOIN_URL} target="_blank" rel="noreferrer">join with X</a>
            <a href={X_URL} target="_blank" rel="noreferrer">follow Onboard</a>
          </div>
        </div>
        <div className="onboard-invite-media">
          <div className="onboard-invite-image"><img src="/pump-invite.png" alt="Pumpfun invited you to pump.fun" /></div>
          <div className="onboard-qr-row">
            <img src="/onboard-qr.jpg" alt="Scan to start onboarding" />
            <div><span>scan to start</span><b>your onboarding entry point</b><a href={PUMP_JOIN_URL} target="_blank" rel="noreferrer">open referral ↗</a></div>
          </div>
        </div>
      </section>

      <section className="onboard-strip" aria-label="onboarding status">
        <Stat label="context" value="read first" />
        <Stat label="reply engine" value="OpenRouter" />
        <Stat label="next step" value="QR ready" />
      </section>

      <section id="tech" className="onboard-grid">
        <div className="onboard-panel onboard-panel-bright">
          <span>sample reply</span>
          <h2>That sounds like your first time here. Open the signup link, finish your account, and scan the QR if you want to continue from your phone.</h2>
        </div>
        <div className="onboard-panel">
          <span>what it does</span>
          <div className="onboard-points">
            {points.map(([title, body], index) => (
              <article key={title}><b>0{index + 1}</b><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="onboard-examples">
        <div><span>ask it like this</span><h2>less friction, more context, one clear next step.</h2></div>
        <div className="onboard-example-list">
          {examples.map(([title, body]) => <article key={title}><h3>{title}</h3><p>{body}</p></article>)}
        </div>
      </section>
    </main>
  );
}

function DocsPage() {
  return (
    <main className="onboard-page onboard-docs-page">
      <header className="onboard-nav"><a className="onboard-brand" href="/" aria-label="onboard home"><img src="/onboard-logo.png" alt="Onboard" /><span>{BRAND}</span></a><div className="onboard-actions"><a href="/">home</a><a href={X_URL} target="_blank" rel="noreferrer">tag the bot</a></div></header>
      <section className="onboard-docs-hero"><span>technical paper</span><h1>onboard docs.</h1><p>How Onboard reads context and turns a tag into a useful, personalized start.</p></section>
      <MarkdownDoc text={docsText} />
    </main>
  );
}

function MarkdownDoc({ text }: { text: string }) {
  const lines = text.split('\n'); const blocks: JSX.Element[] = []; let list: string[] = []; let code: string[] = []; let inCode = false;
  const flushList = () => { if (list.length) { blocks.push(<ul key={`list-${blocks.length}`}>{list.map(item => <li key={item}>{item}</li>)}</ul>); list = []; } };
  const flushCode = () => { if (code.length) { blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join('\n')}</code></pre>); code = []; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) { if (inCode) { inCode = false; flushCode(); } else { flushList(); inCode = true; } continue; }
    if (inCode) { code.push(raw); continue; }
    if (line.startsWith('- ')) { list.push(line.slice(2)); continue; }
    flushList();
    if (!line.trim()) continue;
    if (line.startsWith('## ')) blocks.push(<h2 key={blocks.length}>{line.slice(3)}</h2>);
    else if (line.startsWith('# ')) blocks.push(<h1 key={blocks.length}>{line.slice(2)}</h1>);
    else blocks.push(<p key={blocks.length}>{line}</p>);
  }
  flushList(); flushCode();
  return <article className="onboard-docs">{blocks}</article>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><b>{value}</b></div>; }
