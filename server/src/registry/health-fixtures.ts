import scenario from "./health-fixture-scenario.json";
import type { Db } from "./schema";
import {
  healthSave,
  healthTaskAction,
  healthRound,
  healthVoid,
  healthUpload,
  healthRequest,
} from "./health";

/** Synthetic data only. Caller owns the handle; no singleton or live database imports. */
export function addHealthFixtures(db: Db, on: string) {
  const databases = db.pragma("database_list") as {
    name: string;
    file: string;
  }[];
  if (databases.some((d) => d.name === "main" && d.file))
    throw new Error("Health fixtures require an in-memory database");
  const animals = db
    .prepare(
      `SELECT a.id FROM registry_animals a JOIN registry_animal_status s ON s.animal_id=a.id WHERE s.status <> 'departed' ORDER BY a.id LIMIT 3`,
    )
    .all() as { id: string }[];
  if (animals.length < 3)
    throw new Error("Health fixtures need three resident animals");
  const refs: Record<string, string> = {};
  const day = (offset: number) =>
    new Date(Date.parse(on + "T12:00:00Z") + offset * 86400000)
      .toISOString()
      .slice(0, 10);
  const resolve = (value: unknown): any => {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, resolve(v)]),
      );
    if (typeof value !== "string") return value;
    if (value.startsWith("$animal:")) return animals[Number(value.slice(8))].id;
    if (value.startsWith("$day:")) return day(Number(value.slice(5)));
    if (value.startsWith("$until:"))
      return day(Number(value.slice(7))) + "T18:00:00+05:00";
    if (value === "$month") return on.slice(0, 7) + "-01";
    return value.replace(/\$ref:([\w-]+)/g, (_, key) => {
      if (!refs[key]) throw new Error("Missing fixture reference " + key);
      return refs[key];
    });
  };
  return db.transaction(() => {
    for (const step of scenario) {
      const path = resolve(step.path) as string;
      const body = {
        recorded_by: "health_fixture",
        source_form: "direct_entry",
        source_ref: "Synthetic harness health card",
        ...resolve(step.body),
      };
      const result = healthRequest(
        db,
        "health-fixture:" + on + ":" + step.key,
        path,
        body,
        () => {
          const [, , entity, id, action] = path.split("/");
          if (entity === "rounds") return healthRound(db, body);
          if (entity === "attachments") return healthUpload(db, body);
          if (action === "actions") return healthTaskAction(db, id, body);
          if (action === "void") return healthVoid(db, id, body);
          return healthSave(
            db,
            entity as Parameters<typeof healthSave>[1],
            body,
            id,
          );
        },
      );
      if (result.id) refs[step.key] = result.id;
    }
    return refs;
  })();
}
