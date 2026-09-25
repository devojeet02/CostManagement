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
    // No forecast line exists for this one, on purpose: it is what the unbudgeted
    // invoice below is coded to, so the auto-raised UB row has somewhere to come from.
    { value: 'IO7', label: 'IO7 - Facilities Automation', group: 'Infrastructure' },
  ];

  /**
   * SelectGroup is { group, items } — NOT { label, options }. It was built the wrong way round
   * here and cast with `as unknown as SelectGroup`, so it compiled cleanly and the Internal Order
   * type-ahead returned six results that rendered as an empty dropdown, which also left the
   * Related Data panel's internal-order auto-fill with nothing to fill from. Build the real shape
   * and let the compiler check it.
   */
  search(query: string): Observable<SelectGroup[]> {
    const q = (query || '').toLowerCase();
    const hits = this.orders.filter(o => o.label.toLowerCase().indexOf(q) >= 0);

    const groups: SelectGroup[] = [];
    hits.forEach(o => {
      let g = groups.filter(x => x.group === o.group)[0];
      if (!g) {
        g = { group: o.group, items: [] };
        groups.push(g);
      }
      g.items.push({ value: o.value, label: o.label });
    });

    return of(groups).pipe(delay(140));
  }
}
