import { useEffect, useRef } from 'react';
import type { Notification, NotificationPriority } from '../types';
import { api } from '../api';

interface NotificationPanelProps {
  notifications: Notification[];
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenTicket: (ticketId: string) => void;
}

const PRIORITY_ORDER: NotificationPriority[] = ['critical', 'high', 'medium', 'info'];
const PRIORITY_LABEL: Record<NotificationPriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  info: 'Info',
};
const PRIORITY_BORDER: Record<NotificationPriority, string> = {
  critical: 'border-l-red-500',
  high: 'border-l-orange-400',
  medium: 'border-l-brand',
  info: 'border-l-surface-5',
};
const PRIORITY_DOT: Record<NotificationPriority, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-400',
  medium: 'bg-brand',
  info: 'bg-text-muted',
};
const PRIORITY_SECTION_LABEL: Record<NotificationPriority, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-brand',
  info: 'text-text-muted',
};

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationPanel({
  notifications,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onOpenTicket,
}: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const unreadCount = notifications.filter(n => !n.read).length;

  // Group by priority, preserving order within each group
  const grouped = PRIORITY_ORDER.reduce<Record<NotificationPriority, Notification[]>>((acc, p) => {
    acc[p] = notifications.filter(n => n.priority === p);
    return acc;
  }, { critical: [], high: [], medium: [], info: [] });

  const handleItemClick = async (n: Notification) => {
    if (!n.read) {
      onMarkRead(n.id);
      await api.markNotificationRead(n.id).catch(() => {/* ignore */});
    }
    if (n.ticket_id) {
      onOpenTicket(n.ticket_id);
      onClose();
    }
  };

  const handleMarkAllRead = async () => {
    onMarkAllRead();
    await api.markAllNotificationsRead().catch(() => {/* ignore */});
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed right-4 top-14 w-96 max-h-[calc(100vh-80px)] bg-surface-2 border border-surface-5 rounded-xl shadow-panel z-50 flex flex-col overflow-hidden animate-slide-in-up"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-5 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">Notifications</span>
            {unreadCount > 0 && (
              <span className="bg-brand text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                Mark all read
              </button>
            )}
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors p-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <svg className="w-10 h-10 text-text-muted mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
              <p className="text-sm font-medium text-text-secondary">You're all caught up</p>
              <p className="text-xs text-text-muted mt-1">No notifications yet</p>
            </div>
          ) : (
            PRIORITY_ORDER.map(priority => {
              const items = grouped[priority];
              if (items.length === 0) return null;
              return (
                <div key={priority}>
                  <div className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider ${PRIORITY_SECTION_LABEL[priority]} bg-surface-3/50`}>
                    {PRIORITY_LABEL[priority]}
                  </div>
                  {items.map(n => (
                    <button
                      key={n.id}
                      onClick={() => handleItemClick(n)}
                      className={`
                        w-full text-left px-4 py-3 border-l-2 ${PRIORITY_BORDER[priority]}
                        border-b border-surface-5 last:border-b-0
                        hover:bg-surface-3 transition-colors
                        ${n.read ? 'opacity-50' : ''}
                      `}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[priority]} shrink-0 mt-1.5 ${n.read ? 'opacity-0' : ''}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-text-primary truncate">{n.title}</p>
                          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed line-clamp-2">{n.body}</p>
                          <p className="text-[10px] text-text-muted mt-1">{timeAgo(n.created_at)}</p>
                        </div>
                        {n.ticket_id && (
                          <svg className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
