/** Paginated read lists. Catalog and atomic session-entry endpoints stay intact. */
import type { Db } from "./schema";
import { herd } from "./reads";
import { destinationList } from "./destinations";
import { wageBalances } from "./wages";
import { pageRows, scalar, invalid } from "./pagination";
import { farmToday } from "./time";
import { date } from "./analytics";
import { allEvents } from "./store";
export function registryList(
  db: Db,
  kind: string,
  query: Record<string, unknown>,
) {
  return db.transaction(() => {
    const on = date(scalar(query.as_of, farmToday()));
    const search = scalar(query.search, "").trim().toLowerCase();
    if (search.length > 100) invalid("Search is limited to 100 characters.");
    if (kind === "animals")
      return pageRows(
        herd(db).filter((a) =>
          `${a.id} ${a.name ?? ""} ${a.tag_no ?? ""}`
            .toLowerCase()
            .includes(search),
        ),
        query,
        { identifier: (a, b) => a.id.localeCompare(b.id) },
        "identifier",
        (a, b) => a.id.localeCompare(b.id),
      );
    if (kind === "destinations")
      return pageRows(
        destinationList(db, on).filter((a) =>
          `${a.name} ${a.id}`.toLowerCase().includes(search),
        ),
        query,
        { identifier: (a, b) => a.name.localeCompare(b.name) },
        "identifier",
        (a, b) => a.id.localeCompare(b.id),
      );
    if (kind === "people")
      return pageRows(
        wageBalances(db, on).filter((a) =>
          `${a.identifier} ${a.name ?? ""}`.toLowerCase().includes(search),
        ),
        query,
        { identifier: (a, b) => a.identifier.localeCompare(b.identifier) },
        "identifier",
        (a, b) => a.person_id.localeCompare(b.person_id),
      );
    if (kind === "calvings") {
      const animals = new Map(herd(db).map((a) => [a.id, a]));
      const events = allEvents(db);
      const replaced = new Map(
        events
          .filter((e) => e.supersedes_id)
          .map((e) => [e.supersedes_id!, e.id]),
      );
      const rows = events
        .filter((e) => e.type === "calving" && animals.has(e.animal_id))
        .map((e) => ({
          animal: animals.get(e.animal_id)!,
          event: {
            ...e,
            effective: !replaced.has(e.id),
            superseded_by_id: replaced.get(e.id) ?? null,
          },
        }))
        .filter((r) =>
          `${r.animal.id} ${r.animal.name ?? ""}`
            .toLowerCase()
            .includes(search),
        );
      return pageRows(
        rows,
        query,
        {
          date: (a, b) =>
            a.event.occurred_on.localeCompare(b.event.occurred_on),
        },
        "date",
        (a, b) => a.event.id.localeCompare(b.event.id),
      );
    }
    return invalid("Unknown record list.");
  })();
}
