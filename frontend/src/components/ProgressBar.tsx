type ProgressBarProps = {
  current: number;
  total: number;
  showPercentage?: boolean;
  height?: "sm" | "md" | "lg";
  colorScheme?: "emerald" | "blue" | "amber" | "red";
};

export default function ProgressBar({
  current,
  total,
  showPercentage = true,
  height = "md",
  colorScheme = "emerald",
}: ProgressBarProps) {
  const percentage = total > 0 ? Math.min((current / total) * 100, 100) : 0;

  const heightClass = {
    sm: "h-1.5",
    md: "h-2.5",
    lg: "h-4",
  }[height];

  const colorClass = {
    emerald: "bg-gradient-to-r from-emerald-500 to-emerald-400",
    blue: "bg-gradient-to-r from-blue-500 to-blue-400",
    amber: "bg-gradient-to-r from-amber-500 to-amber-400",
    red: "bg-gradient-to-r from-red-500 to-red-400",
  }[colorScheme];

  // Auto color based on percentage
  const autoColor =
    percentage >= 90
      ? "bg-gradient-to-r from-red-500 to-red-400"
      : percentage >= 75
      ? "bg-gradient-to-r from-amber-500 to-amber-400"
      : "bg-gradient-to-r from-emerald-500 to-emerald-400";

  return (
    <div className="w-full">
      {showPercentage && (
        <div className="flex items-center justify-between mb-1.5 text-xs text-slate-400">
          <span>{percentage.toFixed(1)}% utilizado</span>
        </div>
      )}
      <div className={`w-full bg-slate-700 rounded-full overflow-hidden ${heightClass}`}>
        <div
          className={`${autoColor} ${heightClass} transition-all duration-500 ease-out`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
