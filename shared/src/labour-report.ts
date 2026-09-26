/** Read-only advisory metadata. Detail is retained for older clients and unknown kinds. */
export type LabourReportContext =
  | { kind: "unknown_identifier"; identifier: string; recordCount: number }
  | {
      kind: "overlapping_engagements";
      personId: string;
      engagementIds: string[];
    }
  | {
      kind: "multiple_open_engagements";
      personId: string;
      engagementIds: string[];
      asOf: string;
    }
  | {
      kind: "wage_period_outside_engagement";
      personId: string;
      wageId: string;
      engagementId: string;
      fromOn: string;
      toOn: string;
    }
  | {
      kind: "amount_differs_from_term";
      personId: string;
      wageId: string;
      engagementId: string;
      amountMinor: number;
      agreementMinor: number;
      fromOn: string;
      toOn: string;
    };
export interface LabourReportLine {
  kind: string;
  detail: string;
  context?: LabourReportContext;
}
