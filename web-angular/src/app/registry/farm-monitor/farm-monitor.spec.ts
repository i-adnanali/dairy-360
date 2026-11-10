import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { RegistryApi, type FarmEventRow } from '../api';
import { FarmMonitor } from './farm-monitor';

const row = (id: string): FarmEventRow => ({
  id, camera_id: 'feed_store_cam', zone: 'feed_store', event_type: 'detection', identity: null,
  confidence: 0.9, occurred_at: '2026-11-09T01:10:00Z', is_synthetic: true,
  flagged: id === 'e2', flag_severity: id === 'e2' ? 'urgent' : null, flag_reason: null,
});

describe('Farm monitor, arriving from Today with an event', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('brings the linked event into view without CSS.escape', async () => {
    const q = new BehaviorSubject(convertToParamMap({ window: 'night', event: 'e2' }));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: q, snapshot: { queryParamMap: q.value } } },
        { provide: RegistryApi, useValue: { farmEvents: async () => ({ from: '', to: '', synthetic: true, events: [row('e1'), row('e2')] }) } },
      ],
    });
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
    try {
      const f = TestBed.createComponent(FarmMonitor);
      await f.whenStable(); f.detectChanges();
      await new Promise((r) => setTimeout(r, 0));
      const el = f.nativeElement as HTMLElement;
      expect(scrolled).toEqual([el.querySelector('[data-event="e2"]')]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
