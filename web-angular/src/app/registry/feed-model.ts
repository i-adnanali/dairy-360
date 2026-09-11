export interface FeedSource {
  kind: string;
  ref_id: string | null;
}
export interface FeedLine {
  id?: string;
  item_id: string;
  quantity: number | null;
  unit: string | null;
  preparation: string;
  recipients: string;
  animal_ids: string[];
  recipients_confirmed: boolean;
  sources: FeedSource[];
  purpose: string | null;
  notes: string | null;
}
export interface FeedRecord {
  id: string;
  revision: number;
  label: string;
  category: string;
  archived: boolean;
  notes: string | null;
  plot: string | null;
  acreage: number | null;
  status: string;
  sowing_on: string | null;
  sowing_precision: string | null;
  cutting_start_on: string | null;
  cutting_start_precision: string | null;
  cutting_end_on: string | null;
  cutting_end_precision: string | null;
  crop_id: string;
  item_id: string;
  on: string;
  supplier: string | null;
  quantity: number | null;
  unit: string | null;
  pricing: string;
  basis_quantity: number | null;
  basis_price_minor: number | null;
  basis_unit: string | null;
  goods_minor: number | null;
  transport_minor: number;
  other_minor: number;
  total_minor: number | null;
  amount_minor: number | null;
  fresh_status: string;
  additional_status: string;
  assessment: string;
  completeness: string;
  lines: FeedLine[];
  source_form: string;
  recorded_by: string;
  source_ref: string | null;
  recorded_at: string;
  expenses?: FeedRecord[];
  supply_days?: string[];
  expense_minor?: number;
}
export const categories = ['fresh_fodder', 'silage', 'concentrate', 'addition', 'other'];
export function blankFeed(): FeedRecord {
  return {
    id: '',
    revision: 0,
    label: '',
    category: '',
    archived: false,
    notes: null,
    plot: null,
    acreage: null,
    status: 'growing',
    sowing_on: null,
    sowing_precision: null,
    cutting_start_on: null,
    cutting_start_precision: null,
    cutting_end_on: null,
    cutting_end_precision: null,
    crop_id: '',
    item_id: '',
    on: '',
    supplier: null,
    quantity: null,
    unit: null,
    pricing: 'unknown',
    basis_quantity: null,
    basis_price_minor: null,
    basis_unit: null,
    goods_minor: null,
    transport_minor: 0,
    other_minor: 0,
    total_minor: null,
    amount_minor: null,
    fresh_status: '',
    additional_status: '',
    assessment: '',
    completeness: '',
    lines: [],
    source_form: '',
    recorded_by: '',
    source_ref: null,
    recorded_at: '',
  };
}
export interface FeedDay {
  on: string;
  summary: FeedRecord | null;
}
export interface FeedOverview {
  from: string;
  to: string;
  days: FeedDay[];
  recorded: number;
  partial: number;
  unrecorded: number;
  assessments: Record<string, string[]>;
  own_days: number;
  purchased_days: number;
  mixed_days: number;
  purchase_cost_minor: number;
  unknown_costs: number;
  expense_cost_minor: number;
  crops: FeedRecord[];
  quantities: { item_id: string; unit: string; quantity: number; unmeasured: number }[];
}
