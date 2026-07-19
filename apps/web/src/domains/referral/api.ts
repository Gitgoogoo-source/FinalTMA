export const referralRouteIds = [
  "referral.get",
  "referral.bind",
  "referral.share_event",
] as const;

export type ReferralRouteId = (typeof referralRouteIds)[number];
