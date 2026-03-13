function ProgressionPanelShell({
  kicker,
  title,
  meta = null,
  className = "",
  bodyClassName = "",
  children,
}) {
  const shellClassName = ["progression-panel", className].filter(Boolean).join(" ");
  const shellBodyClassName = ["progression-panel-body", bodyClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={shellClassName}>
      <div className="progression-panel-header">
        <div>
          {kicker ? <p className="progression-panel-kicker">{kicker}</p> : null}
          <h2 className="progression-panel-title">{title}</h2>
        </div>

        {meta ? <div className="progression-panel-meta">{meta}</div> : null}
      </div>

      <div className={shellBodyClassName}>{children}</div>
    </section>
  );
}

export default ProgressionPanelShell;