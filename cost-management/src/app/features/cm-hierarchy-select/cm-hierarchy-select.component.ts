import {
  Component, forwardRef, Input, HostListener, ElementRef, OnDestroy,
  AfterViewChecked, ViewChild
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Observable, Subject, Subscription } from 'rxjs';
import { debounceTime, switchMap, tap } from 'rxjs/operators';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectGroup {
  group: string;
  items: SelectOption[];
}

@Component({
  selector: 'cm-hierarchy-select',
  templateUrl: './cm-hierarchy-select.component.html',
  styleUrls: ['./cm-hierarchy-select.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CmHierarchySelectComponent),
      multi: true
    }
  ]
})
export class CmHierarchySelectComponent implements ControlValueAccessor, OnDestroy, AfterViewChecked {
  /** Static catalogue — used when no `searchFn` is provided (local filtering). */
  @Input() groups: SelectGroup[] = [];
  @Input() placeholder = 'Search…';

  /**
   * Remote lookup. When provided, the component switches to async mode:
   * each keystroke (debounced) calls this and the returned groups populate the
   * dropdown — e.g. a live SAP Internal Order search.
   */
  @Input() searchFn?: (query: string) => Observable<SelectGroup[]>;

  /** What to emit on select: the option `label` (default) or its `value` (code). */
  @Input() bindValue: 'label' | 'value' = 'label';

  /** Minimum characters before a remote search fires. */
  @Input() minChars = 1;

  /** When true the control is read-only and cannot be opened. */
  @Input() disabled = false;

  /**
   * Minimum width (px) for the dropdown panel.
   *
   * The panel is normally sized to the input, which is unreadable in a narrow grid cell — a
   * 104px column cannot show "IO1 – CRM Migration". This is an @Input rather than CSS because
   * the panel is re-parented to <body>, so a host's descendant selector no longer reaches it.
   */
  @Input() dropdownMinWidth?: number;

  searchText = '';
  isOpen = false;

  // ── Portal to <body> ────────────────────────────────────────────────────────
  // The dropdown is `position: fixed`, but that only frees it from OVERFLOW — it stays
  // inside every ancestor stacking context. On the Forecast grid the frozen
  // `.left-table-wrap` is `position: sticky; z-index: 10`, which creates one, so the
  // dropdown was confined to it and the table's own cells painted over the panel however
  // high its z-index went. Re-parenting it to <body> puts it in the root stacking context,
  // where nothing in the grid can cover it.
  @ViewChild('dropdownEl') private dropdownEl?: ElementRef<HTMLElement>;

  /** Where the dropdown lived before it was moved, so it can be put back. */
  private dropdownHome: HTMLElement | null = null;

  ngAfterViewChecked(): void {
    const el = this.dropdownEl?.nativeElement;
    if (el && el.parentElement !== document.body) {
      this.dropdownHome = el.parentElement;
      document.body.appendChild(el);
    }
  }

  /**
   * Single close path. Returns the node to its original parent FIRST — Angular's *ngIf
   * removes the view by asking the recorded parent to drop the child, which throws if we
   * have moved it elsewhere.
   */
  private closeDropdown(): void {
    this.restoreDropdown();
    this.isOpen = false;
  }

  private restoreDropdown(): void {
    const el = this.dropdownEl?.nativeElement;
    if (el && this.dropdownHome && el.parentElement === document.body) {
      this.dropdownHome.appendChild(el);
    }
    this.dropdownHome = null;
  }
  loading = false;
  /** Inline coords for the fixed-position dropdown so it escapes any scroll/overflow ancestor. */
  dropdownStyle: { [key: string]: string } = {};
  private remoteGroups: SelectGroup[] = [];
  private selectedLabel = '';
  private selectedValue = '';

  private query$ = new Subject<string>();
  private sub?: Subscription;

  private onChange: (value: string) => void = () => { };
  private onTouched: () => void = () => { };

  constructor(private el: ElementRef) {
    this.sub = this.query$
      .pipe(
        debounceTime(250),
        tap(() => (this.loading = true)),
        switchMap(q => this.searchFn!(q))
      )
      .subscribe(groups => {
        this.remoteGroups = groups;
        this.loading = false;
      });

    // Capture phase so scrolling inside any ancestor (not just window) repositions the dropdown.
    window.addEventListener('scroll', this.onViewportChange, true);
    window.addEventListener('resize', this.onViewportChange);
  }

  get isAsync(): boolean {
    return !!this.searchFn;
  }

  /** Memo for the local filter — see filteredGroups for why this must not be recomputed. */
  private filterCacheKey = '';
  private filterCacheSource: SelectGroup[] | null = null;
  private filterCacheResult: SelectGroup[] = [];

  /**
   * Groups to render in the dropdown.
   *
   * ⚠️ This is a getter, so Angular calls it on EVERY change-detection pass. It must return
   * a stable array identity for unchanged inputs. Rebuilding the group objects each pass
   * (`.map(g => ({...g}))`) makes *ngFor tear down and recreate every option element — and if
   * that happens between a user's mousedown and mouseup, the browser fires no `click` at all,
   * so options become impossible to select while a filter is active. Hence the memo below,
   * keyed on the query plus the source array's identity.
   */
  get filteredGroups(): SelectGroup[] {
    // Async mode: the server already returned the matching groups.
    if (this.isAsync) return this.remoteGroups;

    const q = this.searchText.trim().toLowerCase();
    if (!q) return this.groups;

    if (this.filterCacheKey === q && this.filterCacheSource === this.groups) {
      return this.filterCacheResult;
    }

    this.filterCacheKey = q;
    this.filterCacheSource = this.groups;
    this.filterCacheResult = this.groups
      // `filter` keeps the original item object references, so the options themselves stay
      // identity-stable for *ngFor too.
      .map(g => ({ ...g, items: g.items.filter(i => i.label.toLowerCase().includes(q)) }))
      .filter(g => g.items.length > 0);

    return this.filterCacheResult;
  }

  /** Stable keys for the dropdown's *ngFor loops — belt and braces alongside the memo. */
  trackGroup(_index: number, group: SelectGroup): string { return group.group; }
  trackItem(_index: number, item: SelectOption): string { return item.value + '|' + item.label; }

  get hasNoResults(): boolean {
    if (!this.isOpen || this.loading) return false;
    if (this.isAsync && this.searchText.trim().length < this.minChars) return false;
    return this.filteredGroups.length === 0;
  }

  /** Async mode only: prompt shown before the user has typed enough to search. */
  get showTypeHint(): boolean {
    return this.isOpen && this.isAsync && this.searchText.trim().length < this.minChars && !this.loading;
  }

  onFocus(): void {
    if (this.disabled) return;
    // Keep the current selection in the box so the cursor lands after it (editable),
    // instead of starting blank.
    this.isOpen = true;
    this.updatePosition();
    this.onTouched();
    if (this.isAsync) {
      const q = this.searchText.trim();
      if (q.length >= this.minChars) {
        this.query$.next(q);
      } else {
        this.remoteGroups = [];
      }
    }
  }

  /** Whether a value is currently selected (drives the in-dropdown "Clear" option). */
  get hasSelection(): boolean {
    return this.bindValue === 'value' ? !!this.selectedValue : !!this.selectedLabel;
  }

  /** Clear option inside the dropdown — resets the selection back to empty. */
  clearSelection(): void {
    this.selectedLabel = '';
    this.selectedValue = '';
    this.searchText = '';
    this.onChange('');
    this.closeDropdown();
  }

  /**
   * Position the fixed dropdown against the input's viewport rect, flipping above
   * when there isn't room below. `position: fixed` lets it render outside any
   * `overflow` ancestor (e.g. the scrollable line-items container) without clipping.
   */
  private updatePosition(): void {
    const wrap = this.el.nativeElement.querySelector('.hs-input-wrap') as HTMLElement | null;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const gap = 4;
    const estHeight = 140; // matches max-height + padding
    const openUp = r.bottom + estHeight > window.innerHeight && r.top > estHeight;
    const base: { [k: string]: string } = { left: `${r.left}px`, width: `${r.width}px` };
    if (this.dropdownMinWidth) base['min-width'] = `${this.dropdownMinWidth}px`;

    this.dropdownStyle = openUp
      ? { ...base, bottom: `${window.innerHeight - r.top + gap}px` }
      : { ...base, top: `${r.bottom + gap}px` };
  }

  /** Reposition (or close) while open if the page or any container scrolls/resizes. */
  private onViewportChange = (): void => {
    if (this.isOpen) this.updatePosition();
  };

  onInput(): void {
    if (this.disabled) return;
    this.isOpen = true;
    // Backspacing the field empty clears the current selection.
    if (!this.searchText.trim() && this.hasSelection) {
      this.selectedLabel = '';
      this.selectedValue = '';
      this.onChange('');
    }
    if (this.isAsync) {
      const q = this.searchText.trim();
      if (q.length >= this.minChars) {
        this.query$.next(q);
      } else {
        this.remoteGroups = [];
        this.loading = false;
      }
    }
  }

  select(item: SelectOption): void {
    this.selectedLabel = item.label;
    this.selectedValue = item.value;
    this.searchText = item.label;
    this.onChange(this.bindValue === 'value' ? item.value : item.label);
    this.closeDropdown();
  }

  isSelected(item: SelectOption): boolean {
    return this.bindValue === 'value'
      ? item.value === this.selectedValue
      : item.label === this.selectedLabel;
  }

  writeValue(value: string): void {
    if (this.bindValue === 'value') {
      this.selectedValue = value || '';
      // Only the CODE is stored, so a written-back value would otherwise display as a bare
      // code ("IO1") while selecting the same option shows its label ("IO1 – CRM Migration").
      // Resolve it against `groups` when a catalogue is available so both routes read alike.
      this.selectedLabel = this.labelForValue(value) ?? (value || '');
    } else {
      this.selectedLabel = value || '';
    }
    this.searchText = this.selectedLabel;
  }

  /**
   * Friendly label for a stored code, or null when it can't be resolved.
   *
   * Returns null for every async-only usage (`searchFn` with no `groups`), so those keep
   * showing the raw code exactly as before — this only ever adds information, never changes
   * a control that has no catalogue to look in.
   */
  private labelForValue(value: string | null | undefined): string | null {
    if (!value) return null;
    for (const group of this.groups ?? []) {
      const hit = (group.items ?? []).find(i => i.value === value);
      if (hit) return hit.label;
    }
    return null;
  }

  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.el.nativeElement.contains(event.target as Node)) {
      this.searchText = this.selectedLabel;
      this.closeDropdown();
    }
  }

  ngOnDestroy(): void {
    // A dropdown open at destroy time would otherwise be stranded on <body> forever.
    this.restoreDropdown();
    this.sub?.unsubscribe();
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
  }
}
