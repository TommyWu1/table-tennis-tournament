export default function App() {
  return (
    <main className="welcome">
      <header className="welcome-header">
        <div className="brand-mark" aria-hidden="true">R</div>
        <div>
          <p className="brand-name">RallyDesk</p>
          <p className="brand-caption">Tournament organizer</p>
        </div>
      </header>

      <section className="setup-panel" aria-labelledby="setup-title">
        <p className="eyebrow">First-time setup</p>
        <h1 id="setup-title">Connect the shared tournament desk</h1>
        <p className="setup-copy">
          RallyDesk stores events and scores in Supabase so the organizer’s laptop and scorekeepers’ phones stay in sync.
        </p>

        <ol className="setup-steps">
          <li><span>1</span><div><strong>Copy the environment template</strong><code>cp .env.example .env.local</code></div></li>
          <li><span>2</span><div><strong>Add your Supabase project values</strong><p>Use the project URL and publishable key. Never use a service-role key here.</p></div></li>
          <li><span>3</span><div><strong>Start RallyDesk</strong><code>npm run dev</code></div></li>
        </ol>

        <div className="environment-fields" aria-label="Required environment variables">
          <span>Required settings</span>
          <code>VITE_SUPABASE_URL</code>
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>
        </div>
        <p className="setup-footnote">This screen appears until the shared database is configured.</p>
      </section>
    </main>
  );
}
