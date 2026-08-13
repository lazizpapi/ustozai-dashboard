export function PageHeader({
  title,
  note,
}: {
  title: string;
  note?: string;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b pb-3">
      <h1 className="text-sm font-medium">{title}</h1>
      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
    </div>
  );
}

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b pb-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {note ? <span className="text-muted-foreground text-xs">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground py-10 text-sm">{children}</p>;
}
