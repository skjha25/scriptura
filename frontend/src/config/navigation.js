// frontend/src/config/navigation.js
/**
 * Sidebar navigation, grouped to match the product's real surface areas
 * (Work / Automation / Intelligence / System) rather than one flat list.
 * Consumed by AppLayout — this file owns the route→label→icon mapping so the
 * shell component doesn't have to.
 */

import {
  LayoutDashboard,
  FileText,
  PenSquare,
  Zap,
  Settings,
  Tags,
  Boxes,
  Activity,
  ShieldCheck,
  BookOpen,
  Sparkles,
  Webhook,
  Users,
} from 'lucide-react';

export const NAV_GROUPS = [
  {
    label: 'Work',
    items: [
      { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard },
      { to: '/blogs', label: 'All blogs', end: true, icon: FileText },
      { to: '/blogs/new', label: 'New article', icon: PenSquare },
      { to: '/clusters', label: 'Clusters', icon: Boxes },
      { to: '/keywords', label: 'Keyword Pool', icon: Tags },
    ],
  },
  {
    label: 'Automation',
    items: [{ to: '/blogs/automated', label: 'Autopilot Mode', icon: Zap }],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/agents/activity', label: 'Agent Activity', icon: Activity },
      { to: '/agents/rules', label: 'Platform Rules', icon: ShieldCheck },
      { to: '/agents/knowledge', label: 'Agent Knowledge', icon: BookOpen },
      { to: '/agents/observatory', label: 'Intelligence', icon: Sparkles },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/config', label: 'Config', icon: Webhook },
      // Creating/editing accounts is platform-wide, not per-blog — gated the
      // same way as the backend route (requireAdmin).
      { to: '/users', label: 'Users', icon: Users, adminOnly: true },
    ],
  },
];

// Flat list, for call sites that don't care about grouping.
export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
