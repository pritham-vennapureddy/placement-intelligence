import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const illustrativeTrend = [
  { month: "May", applications: 18, interviews: 8 },
  { month: "Jun", applications: 26, interviews: 13 },
  { month: "Jul", applications: 22, interviews: 11 },
  { month: "Aug", applications: 38, interviews: 21 },
  { month: "Sep", applications: 33, interviews: 18 },
  { month: "Oct", applications: 47, interviews: 28 },
];

export function PlacementActivityChart() {
  return (
    <>
      <div className="h-[270px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={illustrativeTrend} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="applicationsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#eef1f6" strokeDasharray="4 5" vertical={false} />
            <XAxis axisLine={false} tickLine={false} dataKey="month" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <Tooltip
              contentStyle={{ border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 8px 24px #0f172a10" }}
            />
            <Area type="monotone" dataKey="applications" stroke="#6366f1" strokeWidth={2.5} fill="url(#applicationsFill)" />
            <Area type="monotone" dataKey="interviews" stroke="#14b8a6" strokeWidth={2} fill="transparent" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 flex gap-5 text-xs text-slate-500">
        <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-indigo-500" /> Applications</span>
        <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-teal-500" /> Interviews</span>
      </div>
    </>
  );
}
