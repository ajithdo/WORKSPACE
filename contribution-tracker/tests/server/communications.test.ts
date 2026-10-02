import { describe, expect, it } from "vitest";
import { addEvidence } from "@/server/evidence";
import { liveContribution } from "@/server/contribution";
import { logCommunication, planCommunication, verifyCommunication } from "@/server/communications";
import { approvePlan, submitPlan } from "@/server/plan";
import { bootstrap, taskByCode } from "../fixtures";

function notesEvidence(f: ReturnType<typeof bootstrap>, actor: number, communicationId: number) {
  addEvidence(f.at(actor), {
    subjectType: "communication",
    subjectId: communicationId,
    type: "meeting_notes_sent",
    url: "https://mail.example.com/thread/1",
    description: "Summary email sent to the client after the call",
    containsPersonalData: false,
    redacted: false,
    noSecretsConfirmed: true,
  });
}

const comm = (f: ReturnType<typeof bootstrap>, id: number) => liveContribution(f.db, f.projectId).result.members.find((m) => m.memberId === String(id))?.rawPoints.comm ?? 0;

describe("communications", () => {
  it("earn points only after qualification and the other partner's verification", () => {
    const f = bootstrap();
    const { communicationId } = logCommunication(f.at(f.b), {
      projectId: f.projectId,
      type: "discovery_call",
      occurredAt: "2026-10-01T10:00:00.000Z",
      channel: "video",
      leadMemberId: f.b,
      summary: "Walked through goals and sitemap",
      decisions: ["Six pages", "Client supplies photos"],
      actionItems: [],
    });
    notesEvidence(f, f.b, communicationId);
    expect(comm(f, f.b)).toBe(0);
    expect(() => verifyCommunication(f.at(f.b), communicationId)).toThrow(/cannot verify/);
    verifyCommunication(f.at(f.a), communicationId);
    expect(comm(f, f.b)).toBe(3);
  });

  it("a second attendee flagged at planning earns points; one added later does not", () => {
    const f = bootstrap();
    const planned = planCommunication(f.at(f.b), f.projectId, { type: "discovery_call", scheduledFor: "2026-10-02T10:00:00.000Z", leadMemberId: f.b, secondMemberId: f.a, secondRequired: true });
    logCommunication(f.at(f.b), { communicationId: planned.communicationId, occurredAt: "2026-10-02T10:00:00.000Z", channel: "in_person", summary: "Met owner", decisions: ["Go ahead"], actionItems: [] });
    notesEvidence(f, f.b, planned.communicationId);
    verifyCommunication(f.at(f.a), planned.communicationId);
    expect(comm(f, f.a)).toBe(2);

    const direct = logCommunication(f.at(f.b), { projectId: f.projectId, type: "video_meeting", occurredAt: "2026-10-03T10:00:00.000Z", channel: "video", leadMemberId: f.b, secondMemberId: f.a, secondRequired: true, summary: "Check-in", decisions: ["Ok"], actionItems: [] });
    notesEvidence(f, f.b, direct.communicationId);
    verifyCommunication(f.at(f.a), direct.communicationId);
    expect(comm(f, f.a)).toBe(2);
  });

  it("does not count without a decision or action item", () => {
    const f = bootstrap();
    const { communicationId } = logCommunication(f.at(f.b), { projectId: f.projectId, type: "progress_update", occurredAt: "2026-10-01T10:00:00.000Z", channel: "email", leadMemberId: f.b, summary: "Weekly update", decisions: [], actionItems: [] });
    notesEvidence(f, f.b, communicationId);
    verifyCommunication(f.at(f.a), communicationId);
    expect(comm(f, f.b)).toBe(0);
  });

  it("action items become proposed tasks after plan lock", () => {
    const f = bootstrap();
    submitPlan(f.at(f.a), f.projectId);
    approvePlan(f.at(f.b), f.projectId);
    const { taskIds } = logCommunication(f.at(f.b), {
      projectId: f.projectId,
      type: "feedback_call",
      occurredAt: "2026-10-04T10:00:00.000Z",
      channel: "video",
      leadMemberId: f.b,
      summary: "Feedback on staging",
      decisions: [],
      actionItems: [{ text: "Fix menu overlap on iPhone SE", ownerMemberId: f.a, categoryCode: "AQ", points: 1 }],
    });
    expect(taskIds).toHaveLength(1);
    const t = taskByCode(f, "AQ-X01");
    expect(t).toMatchObject({ status: "proposed", origin: "action_item", ownerMemberId: f.a });
  });
});
