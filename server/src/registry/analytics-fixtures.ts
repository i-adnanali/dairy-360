/** Disposable analytics scenarios. Uses only an injected in-memory registry. */
import { freshDb } from './fixtures';
import { addAcquiredAnimal } from './entry';
import { recordCalving } from './calving';
import { saveMilkingSession } from './milking';
import { addDestination, setPrice } from './destinations';
import { saveDispatchSession } from './dispatch';
import { bounds, shift } from './analytics';
import { farmToday } from './time';

export function analyticsHerd(today = farmToday()) {
  const start = new Date(`${bounds('month', today).from}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 3);
  const first = start.toISOString().slice(0, 10);
  const scenarios = { first, missing: first, zero: shift(first, 1), excess: shift(today, -2), retained: shift(today, -1), today };
  const db = freshDb();
  const provenance = { source_form: 'direct_entry' as const, recorded_by: 'analytics_fixture' };
  try {
    const animals = Array.from({ length: 30 }, (_, i) => {
      const animal = addAcquiredAnimal(db, { sex: 'female', name: `Analytics dam ${String(i + 1).padStart(2, '0')}`, acquired_on: shift(first, -365), date_precision: 'day', provenance, asOf: today });
      recordCalving(db, { dam_id: animal.animal_id, occurred_on: first, date_precision: 'day', calf: { sex: 'female', outcome: 'live' }, provenance, asOf: today });
      return animal.animal_id;
    });
    const buyer = addDestination(db, { name: 'Analytics monthly buyer', kind: 'dodhi', standing: true, started_on: first, recorded_by: provenance.recorded_by });
    const home = addDestination(db, { name: 'Analytics home use', kind: 'home', standing: true, started_on: first, recorded_by: provenance.recorded_by });
    setPrice(db, { destination_id: buyer.id, effective_from: first, price_minor: 700000, price_unit_litres: 40, recorded_by: provenance.recorded_by });
    db.transaction(() => {
      for (let on = first; on <= today; on = shift(on, 1)) {
        for (const session of ['morning', 'evening'] as const) {
          if ((on === first || on === today) && session === 'evening') continue;
          const entries = animals.map((animal_id, i) => {
            if (on === today && i === 0) return { animal_id, status: 'milked_not_measured' as const };
            if (on === today && i === 1) return { animal_id, status: 'not_milked' as const, reason: 'Fixture: temporarily withheld' };
            return { animal_id, status: 'measured' as const, yield_litres: on === scenarios.zero ? 0 : 8 + i % 5 + Number(on.slice(5, 7)) % 3 + (session === 'morning' ? 2 : 0) };
          });
          saveMilkingSession(db, { occurred_on: on, session, entries, provenance });
          const produced = entries.reduce((sum, row) => sum + (row.yield_litres ?? 0), 0);
          const dispatched = on === scenarios.zero ? 0 : produced + (on === scenarios.excess ? 7 : -5);
          saveDispatchSession(db, { occurred_on: on, session, provenance, entries: [
            { destination_id: buyer.id, status: dispatched === 0 ? 'none' : 'taken', litres: dispatched === 0 ? undefined : dispatched - 3 },
            { destination_id: home.id, status: dispatched === 0 ? 'none' : 'taken', litres: dispatched === 0 ? undefined : 3 },
          ] });
        }
      }
    })();
    return { db, scenarios };
  } catch (error) { db.close(); throw error; }
}
