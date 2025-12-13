type AccountStatusBadgeProps = {
  limit: number;
  usage: number;
  error?: string;
};

export default function AccountStatusBadge({ limit, usage, error }: AccountStatusBadgeProps) {
  // Heurística simple para determinar el estado
  const getStatus = () => {
    if (error) return "error";
    if (!limit || limit === 0) return "warning";
    if (!usage && usage !== 0) return "warning";
    return "connected";
  };

  const status = getStatus();

  const statusConfig = {
    connected: {
      label: "Conectada",
      icon: "✓",
      classes: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50",
    },
    warning: {
      label: "Requiere reauth",
      icon: "⚠",
      classes: "bg-amber-500/20 text-amber-400 border border-amber-500/50",
    },
    error: {
      label: "Error",
      icon: "✕",
      classes: "bg-red-500/20 text-red-400 border border-red-500/50",
    },
  };

  const config = statusConfig[status];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${config.classes}`}>
      <span>{config.icon}</span>
      {config.label}
    </span>
  );
}
