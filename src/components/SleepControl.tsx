import { useEffect, useState } from "react";
import { usePlayer } from "../store/player";

export default function SleepControl({ compact = false }: { compact?: boolean }) {
  const until = usePlayer((s) => s.sleepUntil);
  const expired = usePlayer((s) => s.sleepExpired);
  const setSleep = usePlayer((s) => s.setSleep);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (until === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [until]);
  const remaining = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 60_000));
  const label = until !== null ? `剩 ${remaining} 分` : expired ? "已定时暂停" : "定时";
  if (compact) return until !== null ? <span className="text-[12px] text-signal">{label}</span> : null;
  return (
    <select aria-label={`睡眠定时：${label}`} title="睡眠定时，到时暂停播放" value="" onChange={(event) => setSleep(event.target.value === "cancel" ? null : Number(event.target.value))}
      className={`sleep-select h-7 w-auto min-w-24 self-center shrink-0 rounded border border-line bg-base pl-2 text-[12px] ${until !== null ? "text-signal" : "text-muted"}`}>
      <option value="" disabled>{label}</option>
      <option value="15">15 分钟后暂停</option>
      <option value="30">30 分钟后暂停</option>
      <option value="60">60 分钟后暂停</option>
      {until !== null && <option value="cancel">取消定时</option>}
    </select>
  );
}
