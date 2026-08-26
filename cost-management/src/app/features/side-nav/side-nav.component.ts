import { Component } from '@angular/core';

export interface NavItem {
  label: string;
  route: string;
  icon: string;
  /** Shown as a small tag beside the label, e.g. "new". */
  tag?: string;
}

/**
 * Left sidenav for the showcase build.
 *
 * Replaces the previous horizontal `app-top-nav`. The screen list has outgrown a single row —
 * a top bar was already wrapping and hiding items — and a rail matches the real Performance Hub
 * shell these screens live in, so the demo reads closer to production.
 *
 * ⚠️ Scenario Management and the Admin screens used to be external `<a href>` links to separate
 * Vercel deployments. They are real in-app routes now; do not put the anchors back.
 */
@Component({
  selector: 'app-side-nav',
  templateUrl: './side-nav.component.html',
  styleUrls: ['./side-nav.component.scss'],
})
export class SideNavComponent {
  collapsed = false;

  readonly groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', route: '/', icon: 'grid' },
      ],
    },
    {
      title: 'Cost Management',
      items: [
        { label: 'Invoice Upload', route: '/invoice-upload', icon: 'upload' },
        { label: 'Forecast', route: '/forecast', icon: 'chart' },
        { label: 'Headcount', route: '/headcount', icon: 'people' },
        { label: 'Budget Planner', route: '/budget-planner', icon: 'wallet', tag: 'new' },
      ],
    },
    {
      title: 'Administration',
      items: [
        { label: 'Scenario Management', route: '/scenario-management', icon: 'layers' },
        { label: 'Admin Screens', route: '/admin', icon: 'shield' },
      ],
    },
  ];

  toggle(): void {
    this.collapsed = !this.collapsed;
  }
}
