// Verification-only clock. Use solely with the in-memory harness and its seed.
const NativeDate = Date;
class FixtureDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : ['2026-09-17T12:00:00Z'])); }
  static now() { return NativeDate.parse('2026-09-17T12:00:00Z'); }
}
globalThis.Date = FixtureDate;
