/**
 * Manifest/boot failure screen (FR-1.2). App-author-facing: the message names
 * the invalid manifest field and may stay English (FR-9.2).
 */
export function StartupError({ error }: { error: string }) {
  return (
    <section className="startup-error" data-testid="screen-startup-error">
      <h1>The app could not start</h1>
      <pre>{error}</pre>
    </section>
  );
}
