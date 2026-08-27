import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { SelectGroup } from '../features/cm-hierarchy-select/cm-hierarchy-select.component';

/**
 * Internal-order type-ahead - SHOWCASE BUILD.
 *
 * WARNING: no backend. Matches on the same fields the real search does (code and
 * description) so the type-ahead behaves the same way, just over a fixed list.
 */
@Injectable({ providedIn: 'root' })
export class InternalOrderService {

  private readonly orders = [
    { value: 'IO1', label: 'IO1 - Core Platform', group: 'Infrastructure' },
    { value: 'IO2', label: 'IO2 - Data Services', group: 'Infrastructure' },
    { value: 'IO3', label: 'IO3 - Integrations', group: 'Applications' },
    { value: 'IO4', label: 'IO4 - Vendor Management', group: 'Governance & Vendor' },
    { value: 'IO5', label: 'IO5 - Reporting', group: 'Model & Processes' },
    { value: 'IO6', label: 'IO6 - Security Tooling', group: 'Infrastructure' },
  ];

  search(query: string): Observable<SelectGroup[]> {
    const q = (query || '').toLowerCase();
    const hits = this.orders.filter(o => o.label.toLowerCase().indexOf(q) >= 0);

    const groups: SelectGroup[] = [];
    hits.forEach(o => {
      let g = groups.filter(x => (x as any).label === o.group)[0];
      if (!g) {
        g = { label: o.group, options: [] } as unknown as SelectGroup;
        groups.push(g);
      }
      (g as any).options.push({ value: o.value, label: o.label });
    });

    return of(groups).pipe(delay(140));
  }
}
