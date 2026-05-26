import { Component, forwardRef, Input, HostListener, ElementRef, OnDestroy } from '@angular/core';
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
  selector: 'app-hierarchy-select',
  templateUrl: './hierarchy-select.component.html',
  styleUrls: ['./hierarchy-select.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => HierarchySelectComponent),
      multi: true
    }
  ]
})
export class HierarchySelectComponent implements ControlValueAccessor, OnDestroy {
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

  searchText = '';
  isOpen = false;
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

  get filteredGroups(): SelectGroup[] {
    // Async mode: the server already returned the matching groups.
    if (this.isAsync) return this.remoteGroups;

    const q = this.searchText.trim().toLowerCase();
    if (!q) return this.groups;
    return this.groups
      .map(g => ({ ...g, items: g.items.filter(i => i.label.toLowerCase().includes(q)) }))
      .filter(g => g.items.length > 0);
  }

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
    this.searchText = '';
    if (this.isAsync) this.remoteGroups = [];
    this.isOpen = true;
    this.updatePosition();
    this.onTouched();
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
    this.isOpen = false;
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
    this.dropdownStyle = openUp
      ? { left: `${r.left}px`, width: `${r.width}px`, bottom: `${window.innerHeight - r.top + gap}px` }
      : { left: `${r.left}px`, width: `${r.width}px`, top: `${r.bottom + gap}px` };
  }

  /** Reposition (or close) while open if the page or any container scrolls/resizes. */
  private onViewportChange = (): void => {
    if (this.isOpen) this.updatePosition();
  };

  onInput(): void {
    if (this.disabled) return;
    this.isOpen = true;
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
    this.isOpen = false;
  }

  isSelected(item: SelectOption): boolean {
    return this.bindValue === 'value'
      ? item.value === this.selectedValue
      : item.label === this.selectedLabel;
  }

  writeValue(value: string): void {
    if (this.bindValue === 'value') {
      this.selectedValue = value || '';
      // Only the code is stored, so display the code until the user reselects.
      this.selectedLabel = value || '';
    } else {
      this.selectedLabel = value || '';
    }
    this.searchText = this.selectedLabel;
  }

  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.el.nativeElement.contains(event.target as Node)) {
      this.searchText = this.selectedLabel;
      this.isOpen = false;
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
  }
}
