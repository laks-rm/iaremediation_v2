import Link from "next/link";

type EmptyStateProps = {
  title: string;
  subtitle: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
};

export default function EmptyState({
  title,
  subtitle,
  actionLabel,
  actionHref,
  onAction,
}: EmptyStateProps) {
  const action =
    actionLabel && actionHref ? (
      <Link className="button button--primary" href={actionHref}>
        {actionLabel}
      </Link>
    ) : actionLabel && onAction ? (
      <button className="button button--primary" onClick={onAction} type="button">
        {actionLabel}
      </button>
    ) : null;

  return (
    <div className="empty-state">
      <svg aria-hidden="true" fill="none" height="32" viewBox="0 0 32 32" width="32">
        <path
          d="M8.5 6.5h10l5 5v14h-15v-19Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M18.5 6.5v5h5M12 17h8M12 21h5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
      <strong>{title}</strong>
      <span>{subtitle}</span>
      {action}
    </div>
  );
}
