import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private _isDark: boolean;

  constructor() {
    // SHOWCASE: dark is the default, not the OS preference. These screens are designed dark —
    // the dashboard is unconditionally dark — so a light-mode visitor would otherwise land on a
    // half-light shell around a dark dashboard. A saved choice still wins, so the toggle sticks.
    const saved = localStorage.getItem('theme');
    this._isDark = saved ? saved === 'dark' : true;
  }

  get isDark(): boolean {
    return this._isDark;
  }

  init(): void {
    document.documentElement.setAttribute('data-theme', this._isDark ? 'dark' : 'light');
  }

  toggle(): void {
    this._isDark = !this._isDark;
    const theme = this._isDark ? 'dark' : 'light';
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }
}
