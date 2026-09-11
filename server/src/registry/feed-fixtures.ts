import { feedSave, feedRecipients, type FeedData } from "./feed";
import type { Db } from "./schema";
const by = {
  source_form: "direct_entry",
  recorded_by: "feed_fixture",
  source_ref: "isolated fixture",
};
/** Only called by isolated harness/tests. Never constructs or imports a database. */
export function addFeedFixtures(db: Db, on: string) {
  const save = (entity: Parameters<typeof feedSave>[1], b: FeedData) =>
    feedSave(db, entity, { revision: 0, ...by, ...b });
  const fodder = save("items", {
    label: "Fresh fodder",
    category: "fresh_fodder",
    archived: false,
  });
  const wanda = save("items", {
    label: "Wanda",
    category: "concentrate",
    archived: false,
  });
  const khall = save("items", {
    label: "Khall",
    category: "concentrate",
    archived: false,
  });
  const silage = save("items", {
    label: "Silage",
    category: "silage",
    archived: false,
  });
  const ginger = save("items", {
    label: "Ginger",
    category: "addition",
    archived: false,
  });
  const crop = save("crops", {
    label: "Seasonal maize",
    plot: "East plot",
    acreage: 2,
    status: "cutting",
    archived: false,
  });
  const finished = save("crops", {
    label: "Previous fodder cycle",
    plot: "East plot",
    status: "finished",
    archived: false,
    sowing_on: "2025-01-01",
    sowing_precision: "year",
  });
  save("expenses", {
    crop_id: crop.id,
    on,
    category: "seed",
    amount_minor: 150000,
    notes: "Expense incurred; payment not tracked",
  });
  const purchase = save("purchases", {
    item_id: fodder.id,
    on,
    quantity: null,
    unit: "trolley",
    pricing: "total",
    goods_minor: 850000,
    transport_minor: 50000,
  });
  const measured = save("purchases", {
    item_id: silage.id,
    on,
    quantity: 400,
    unit: "kg",
    pricing: "rate",
    basis_quantity: 40,
    basis_price_minor: 200000,
    basis_unit: "kg",
    transport_minor: 10000,
  });
  save("purchases", {
    item_id: khall.id,
    on,
    quantity: 80,
    unit: "kg",
    pricing: "rate",
    basis_quantity: 40,
    basis_price_minor: 300000,
    basis_unit: "kg",
  });
  save("purchases", {
    item_id: wanda.id,
    on,
    quantity: null,
    pricing: "unknown",
  });
  const group = feedRecipients(db, on).milking.map((a) => a.id),
    herd = feedRecipients(db, on).herd;
  const line = (item_id: string, sources: unknown[], extra: FeedData = {}) => ({
    item_id,
    quantity: null,
    unit: null,
    preparation: "unknown",
    recipients: "unspecified",
    animal_ids: [],
    sources,
    ...extra,
  });
  const daily = save("daily", {
    on,
    fresh_status: "given",
    additional_status: "given",
    assessment: "enough",
    lines: [
      line(fodder.id, [
        { kind: "crop", ref_id: crop.id },
        { kind: "purchase", ref_id: purchase.id },
      ]),
      line(wanda.id, [{ kind: "unknown", ref_id: null }], {
        recipients: "milking",
        animal_ids: group,
        recipients_confirmed: true,
      }),
      line(khall.id, [{ kind: "unknown", ref_id: null }], {
        recipients: "milking",
        animal_ids: group,
        recipients_confirmed: true,
        preparation: "water_mixed",
      }),
      ...(herd.length
        ? [
            line(ginger.id, [{ kind: "other", ref_id: null }], {
              recipients: "selected",
              animal_ids: [herd[0].id],
              recipients_confirmed: true,
              purpose: "Operator-stated addition for this animal",
            }),
          ]
        : []),
    ],
  });
  const prior = new Date(Date.parse(on) - 86400000).toISOString().slice(0, 10);
  save("daily", {
    on: prior,
    fresh_status: "unknown",
    additional_status: "unknown",
    assessment: "unknown",
    lines: [],
  });
  return {
    crop,
    finished,
    purchase,
    measured,
    daily,
    fodder,
    wanda,
    khall,
    silage,
  };
}
