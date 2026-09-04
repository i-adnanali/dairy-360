import { allAnimals, allFeed, allVendors, db } from '../db';
import type { Db } from '../registry/schema';
import { allAnimals as allRegistryAnimals, allStatuses } from '../registry/store';

export interface Catalog {
  animalCount: number;
  groups: { name: string; count: number }[];
  animalLines: string[];
  feedTypes: string[];
}

export interface VendorCatalog {
  vendorCount: number;
  vendorLines: string[];
}

/** Build a compact, current snapshot of the farm for the system prompt. */
export function buildCatalog(): Catalog {
  const animals = allAnimals();
  const feed = allFeed();

  const groupMap = new Map<string, number>();
  for (const a of animals) {
    const g = a.group_name ?? '(no group)';
    groupMap.set(g, (groupMap.get(g) ?? 0) + 1);
  }

  const groups = [...groupMap.entries()].map(([name, count]) => ({ name, count }));

  const animalLines = animals.map(
    (a) => `${a.id} | ${a.tag} — ${a.species} — ${a.status} — ${a.group_name ?? '-'}`,
  );

  return {
    animalCount: animals.length,
    groups,
    animalLines,
    feedTypes: feed.map((f) => f.feed_type),
  };
}

export interface RegistryCatalog {
  animalCount: number;
  /** `BD-0001 | Noor — female — lactating — parity 2` */
  animalLines: string[];
}

/**
 * The REAL herd, for the registry section of the prompt.
 *
 * Inlined in full with no threshold, unlike buildCatalog's 300-animal cutoff:
 * this is an actual smallholder herd of roughly twenty animals, and there is no
 * `search_registry_animals` to fall back to (deliberately -- see
 * REGISTRY_TOOLS.md § Open items). Resolving "Noor" to BD-0001 without a tool
 * call is the whole value of a catalog block.
 *
 * AN EMPTY REGISTRY IS THE NORMAL CASE, not an error, and stays so until the
 * five-animal trial runs. It must read as "there are no records yet" rather
 * than as an empty list the model might fill from the demo herd above, so
 * registrySection() branches on the count rather than printing nothing.
 *
 * `handle` defaults to the singleton and is passed explicitly by the precision
 * eval, which must compose the REAL prompt over a fixture herd: the live
 * registry holds no animals until the trial runs, so an eval bound to the
 * singleton could only ever test the empty case. See REGISTRY_TOOLS.md § "The
 * eval that matters".
 *
 * READS THE TWO TABLES IT NEEDS, NOT herd(). The obvious implementation was
 * `herd(handle)`, which is the read model the entry UI uses -- but it derives
 * `event_count` by loading the WHOLE event log through allEvents() and
 * JSON.parse-ing every payload. This block is built on every agent turn and
 * uses none of that: it needs id, name, sex, status and parity, which are
 * exactly registry_animals joined to registry_animal_status. A per-turn scan of
 * an append-only log, to compute a field that is then discarded, is a cost that
 * only ever grows.
 */
export function buildRegistryCatalog(handle: Db = db): RegistryCatalog {
  const animals = allRegistryAnimals(handle);
  const statuses = new Map(allStatuses(handle).map((s) => [s.animal_id, s]));
  return {
    animalCount: animals.length,
    animalLines: animals.map((a) => {
      const s = statuses.get(a.id);
      const name = a.name ?? '(unnamed)';
      const parity = s?.parity == null ? 'parity unknown' : `parity ${s.parity}`;
      return `${a.id} | ${name} — ${a.sex} — ${s?.status ?? '(no status)'} — ${parity}`;
    }),
  };
}

/** Build a compact, current snapshot of the vendors for the vendor agent's
 * system prompt (mirrors buildCatalog for the dairy side). */
export function buildVendorCatalog(): VendorCatalog {
  const vendors = allVendors();
  const vendorLines = vendors.map(
    (v) => `${v.id} | ${v.name} — ${v.status} — ${v.price_per_litre}/L`,
  );
  return { vendorCount: vendors.length, vendorLines };
}
