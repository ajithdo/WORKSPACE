/** Spec §7: a communication earns points only with a summary, a decision or action item, and notes/record evidence. */
export function communicationQualifies(c: { summary: string; decisions: string[]; actionItemCount: number; evidenceTypes: string[] }): boolean {
  const hasRecord = c.evidenceTypes.some((t) => t === "meeting_record" || t === "meeting_notes_sent");
  return c.summary.trim().length > 0 && (c.decisions.some((d) => d.trim().length > 0) || c.actionItemCount > 0) && hasRecord;
}

export interface CommunicationForAward {
  leadMemberId: number;
  secondMemberId: number | null;
  /** Only settable while the communication was still planned (decision D3). */
  secondRequired: boolean;
  /** Dispute outcome: 1 normal, 0 voided, 0.5 halved. */
  multiplier: number;
  /** Dispute outcome "split 50/50": total points shared equally by these members. */
  splitParties: number[] | null;
}

export function communicationAwards(
  c: CommunicationForAward,
  type: { lead_points: number; second_attendee_points: number },
): { memberId: number; points: number }[] {
  const awards = [{ memberId: c.leadMemberId, points: type.lead_points * c.multiplier }];
  if (c.secondRequired && c.secondMemberId !== null && c.secondMemberId !== c.leadMemberId) {
    awards.push({ memberId: c.secondMemberId, points: type.second_attendee_points * c.multiplier });
  }
  if (c.splitParties && c.splitParties.length > 0) {
    const total = awards.reduce((s, a) => s + a.points, 0);
    return c.splitParties.map((memberId) => ({ memberId, points: total / c.splitParties!.length }));
  }
  return awards.filter((a) => a.points > 0 || a.memberId === c.leadMemberId);
}
