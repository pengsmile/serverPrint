export default function EntityList({
  title,
  badge,
  badgeActive = false,
  items,
  emptyText,
  renderItem,
}) {
  return (
    <section className="section">
      <div className="section-header">
        <h2>{title}</h2>
        <span className={`badge ${badgeActive ? "badge-active" : ""}`}>{badge}</span>
      </div>
      <div className="panel list-panel">
        {items.length > 0 ? items.map(renderItem) : <div className="empty-state">{emptyText}</div>}
      </div>
    </section>
  );
}
