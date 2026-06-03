import { Directive, ElementRef, HostListener, Input, Renderer2, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { formatAmount, parseAmount } from './number-format.util';

/**
 * `appNumberFormat` — drop-in formatter for amount inputs across all screens.
 *
 * Apply to a plain `<input type="text">` that is bound with `ngModel`. The bound
 * model stays a real **number** (so every existing total/calculation keeps
 * working); only the *display* is decorated:
 *   - while not focused → grouped + up to 2 decimals ("1,234.5")
 *   - while focused     → plain separator-free value ("1234.5"), easy to edit
 *
 * It is a `ControlValueAccessor`, so it transparently replaces the default
 * accessor — `[(ngModel)]` and `[ngModel]` + `(ngModelChange)` both work
 * unchanged. Use `[appNumberFormat]="0"` for integer-only fields; the default is
 * 2 decimals. Negatives (credit notes) and millions are supported.
 */
@Directive({
  selector: 'input[appNumberFormat]',
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => NumberFormatDirective),
    multi: true
  }]
})
export class NumberFormatDirective implements ControlValueAccessor {
  /** Max decimal places to show (default 2). Bare `appNumberFormat` → 2. */
  @Input('appNumberFormat')
  set maxDecimalsInput(v: number | string | null | undefined) {
    const n = Number(v);
    this.maxDecimals = (v === '' || v === null || v === undefined || isNaN(n)) ? 2 : n;
  }
  private maxDecimals = 2;

  private value: number | null = null;
  private focused = false;
  private onChange: (val: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private el: ElementRef<HTMLInputElement>, private renderer: Renderer2) {}

  @HostListener('input', ['$event.target.value'])
  handleInput(raw: string): void {
    // Block typing a 3rd+ digit after the decimal point right at the source: if
    // the keystroke would exceed `maxDecimals`, rewrite the field to the clamped
    // text and keep the caret in place so the extra digit simply never appears.
    const clamped = this.clampTyping(raw, this.maxDecimals);
    if (clamped !== raw) {
      const input = this.el.nativeElement;
      const caret = (input.selectionStart ?? clamped.length) - (raw.length - clamped.length);
      this.setText(clamped);
      const pos = Math.max(0, Math.min(clamped.length, caret));
      try { input.setSelectionRange(pos, pos); } catch { /* not supported */ }
    }
    // Parse so the bound model stays in sync; never reformat-with-commas here.
    this.value = parseAmount(clamped);
    this.onChange(this.value);
  }

  /**
   * Keep only a sign, digits, one decimal point and at most `maxDecimals`
   * fractional digits — used live as the user types. A trailing "." is kept so
   * the user can continue into the decimals.
   */
  private clampTyping(text: string, maxDecimals: number): string {
    const neg = text.trim().startsWith('-');
    let s = text.replace(/[^0-9.]/g, '');
    const firstDot = s.indexOf('.');
    if (firstDot !== -1) {
      const intPart = s.slice(0, firstDot);
      const decPart = s.slice(firstDot + 1).replace(/\./g, '');
      s = maxDecimals <= 0 ? intPart : intPart + '.' + decPart.slice(0, maxDecimals);
    }
    return (neg ? '-' : '') + s;
  }

  @HostListener('focus')
  handleFocus(): void {
    this.focused = true;
    this.setText(this.value === null ? '' : String(this.value));
  }

  @HostListener('blur')
  handleBlur(): void {
    this.focused = false;
    this.onTouched();
    this.setText(formatAmount(this.value, this.maxDecimals));
  }

  writeValue(val: any): void {
    this.value = parseAmount(typeof val === 'number' ? String(val) : val);
    // Never overwrite text mid-edit; reformat only when the field is at rest.
    if (!this.focused) {
      this.setText(formatAmount(this.value, this.maxDecimals));
    }
  }

  registerOnChange(fn: (val: number | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }

  setDisabledState(isDisabled: boolean): void {
    this.renderer.setProperty(this.el.nativeElement, 'disabled', isDisabled);
  }

  private setText(text: string): void {
    this.renderer.setProperty(this.el.nativeElement, 'value', text);
  }
}
