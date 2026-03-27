export default function InfoPanel({ items }) {
  return (
    <section className="panel">
      <div className="panel-body info-grid">
        {items.map((item) => (
          <div className="info-row" key={item.label}>
            <span className="info-label">{item.label}</span>
            <span className="info-value" title={item.value}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
