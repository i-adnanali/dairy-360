/** Paginated read lists. Catalog and atomic session-entry endpoints stay intact. */
import type { Db } from "./schema";
import { herd } from "./reads";
import { destinationList } from "./destinations";
import { balances } from "./ledger";
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
    if (kind === "animals") {
      // `group`: current (on the farm) | departed | all (default, as before).
      // `status`: one stored stage -- lactating, dry, heifer, calf or male.
      const group = scalar(query.group, "all");
      if (!["all", "current", "departed"].includes(group))
        invalid("Unknown animal group.");
      const status = scalar(query.status, "");
      if (status && !["lactating", "dry", "heifer", "calf", "male"].includes(status))
        invalid("Unknown animal status.");
      // Unknown birth dates and parities sort LAST in either direction is not
      // possible with one comparator, so they sort as the smallest value: a
      // missing figure is never presented as the largest.
      const born = (v: string | null) => v ?? "";
      return pageRows(
        herd(db).filter(
          (a) =>
            `${a.id} ${a.name ?? ""} ${a.tag_no ?? ""}`
              .toLowerCase()
              .includes(search) &&
            (group === "all" ||
              (group === "departed") === (a.status === "departed")) &&
            (!status || a.status === status),
        ),
        query,
        {
          identifier: (a, b) => a.id.localeCompare(b.id),
          born: (a, b) => born(a.birth_on).localeCompare(born(b.birth_on)),
          parity: (a, b) => (a.parity ?? -1) - (b.parity ?? -1),
        },
        "identifier",
        (a, b) => a.id.localeCompare(b.id),
      );
    }
    if (kind === "destinations") {
      // What each billable buyer owes, so the list answers the question people
      // open it for. Home and other unbilled rows get null, never 0: a zero
      // would read as "settled".
      const owed = new Map(balances(db).map((b) => [b.destination_id, b.balance_minor]));
      return pageRows(
        destinationList(db, on)
          .filter((a) => `${a.name} ${a.id}`.toLowerCase().includes(search))
          .map((a) => ({ ...a, balance_minor: a.billable ? (owed.get(a.id) ?? 0) : null })),
        query,
        {
          identifier: (a, b) => a.name.localeCompare(b.name),
          balance: (a, b) => (a.balance_minor ?? -Infinity) - (b.balance_minor ?? -Infinity),
        },
        "identifier",
        (a, b) => a.id.localeCompare(b.id),
      );
    }
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
