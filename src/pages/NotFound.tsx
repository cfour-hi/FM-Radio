import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section className="py-20 text-center">
      <p className="num text-[11px] uppercase tracking-[0.22em] text-dim">404 · No Signal</p>
      <h1 className="mt-4 text-[22px] font-medium tracking-tight">这个频率上没有电台</h1>
      <p className="mt-2 text-[13px] text-muted">换个地方试试。</p>
      <Link
        to="/"
        className="mt-7 inline-flex h-10 items-center rounded-[10px] border border-line px-4 text-[13px] text-muted transition-colors hover:border-line hover:text-ink"
      >
        回到地图
      </Link>
    </section>
  );
}
