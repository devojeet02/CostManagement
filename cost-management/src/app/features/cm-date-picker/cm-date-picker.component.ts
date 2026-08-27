import { Component, forwardRef, Input, HostListener, ElementRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'cm-date-picker',
  templateUrl: './cm-date-picker.component.html',
  styleUrls: ['./cm-date-picker.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CmDatePickerComponent),
      multi: true
    }
  ]
})
export class CmDatePickerComponent implements ControlValueAccessor {
  @Input() placeholder = 'DD/MM/YYYY';
  @Input() required = false;

  selectedDate: Date | null = null;
  isOpen = false;

  viewYear!: number;
  viewMonth!: number;

  readonly today = new Date();
  readonly weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  readonly monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  calendarDays: (number | null)[] = [];

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private el: ElementRef) {
    const prev = new Date();
    prev.setDate(1);
    prev.setMonth(prev.getMonth() - 1);
    this.viewYear = prev.getFullYear();
    this.viewMonth = prev.getMonth();
    this.buildCalendar();
  }

  get displayValue(): string {
    if (!this.selectedDate) return '';
    const d = this.selectedDate;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  get headerLabel(): string {
    return `${this.monthNames[this.viewMonth]} ${this.viewYear}`;
  }

  buildCalendar(): void {
    const firstDay = new Date(this.viewYear, this.viewMonth, 1).getDay();
    const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    while (days.length % 7 !== 0) days.push(null);
    this.calendarDays = days;
  }

  toggleCalendar(event: Event): void {
    event.stopPropagation();
    this.isOpen = !this.isOpen;
    this.onTouched();
  }

  prevMonth(): void {
    if (this.viewMonth === 0) { this.viewMonth = 11; this.viewYear--; }
    else this.viewMonth--;
    this.buildCalendar();
  }

  nextMonth(): void {
    if (this.viewMonth === 11) { this.viewMonth = 0; this.viewYear++; }
    else this.viewMonth++;
    this.buildCalendar();
  }

  selectDay(day: number | null): void {
    if (!day) return;
    this.selectedDate = new Date(this.viewYear, this.viewMonth, day);
    const iso = `${this.viewYear}-${String(this.viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    this.onChange(iso);
    this.isOpen = false;
  }

  isSelected(day: number | null): boolean {
    if (!day || !this.selectedDate) return false;
    return this.selectedDate.getFullYear() === this.viewYear
      && this.selectedDate.getMonth() === this.viewMonth
      && this.selectedDate.getDate() === day;
  }

  isToday(day: number | null): boolean {
    if (!day) return false;
    return this.today.getFullYear() === this.viewYear
      && this.today.getMonth() === this.viewMonth
      && this.today.getDate() === day;
  }

  writeValue(value: string): void {
    if (value) {
      this.selectedDate = new Date(value + 'T00:00:00');
      this.viewYear = this.selectedDate.getFullYear();
      this.viewMonth = this.selectedDate.getMonth();
      this.buildCalendar();
    } else {
      this.selectedDate = null;
    }
  }

  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.el.nativeElement.contains(event.target as Node)) {
      this.isOpen = false;
    }
  }
}
