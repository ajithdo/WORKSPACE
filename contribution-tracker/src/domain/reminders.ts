import { formatINR } from "./money";

export type ReminderTone = "gentle" | "firm" | "final";

export interface ReminderInput {
  studioName: string;
  clientName: string;
  contactName: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  outstandingPaise: number;
  today: string;
  msme: boolean;
  udyamNumber: string;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const readable = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** Gentle in the first week, firm up to 30 days, final after that. */
export function reminderTone(daysOverdue: number): ReminderTone {
  return daysOverdue <= 7 ? "gentle" : daysOverdue <= 30 ? "firm" : "final";
}

/** A ready-to-send payment reminder. The partner reviews and sends it themselves. */
export function reminderMessage(r: ReminderInput): { tone: ReminderTone; daysOverdue: number; subject: string; body: string } {
  const daysOverdue = Math.max(0, daysBetween(r.dueDate, r.today));
  const tone = reminderTone(daysOverdue);
  const amount = formatINR(r.outstandingPaise);
  const greeting = `Hello ${r.contactName || r.clientName},`;
  const ref = `invoice ${r.invoiceNumber} dated ${readable(r.issueDate)} (${amount} outstanding, due ${readable(r.dueDate)})`;
  const msmeNote = r.msme
    ? `As a Udyam-registered MSE${r.udyamNumber ? ` (${r.udyamNumber})` : ""}, payments beyond 45 days attract compound interest at three times the RBI bank rate under section 16 of the MSMED Act 2006.`
    : "";
  const lines =
    tone === "gentle"
      ? [greeting, "", `A friendly reminder about ${ref}. If it is already on its way, please ignore this message and share the payment reference.`, "", "Thank you,", r.studioName]
      : tone === "firm"
        ? [greeting, "", `Our ${ref} is now ${daysOverdue} days overdue. Could you please arrange payment this week, or let us know if anything is holding it up?`, msmeNote, "", "Regards,", r.studioName]
        : [
            greeting,
            "",
            `Our ${ref} is now ${daysOverdue} days overdue, and earlier reminders have not been answered. Please clear the payment within 7 days.`,
            msmeNote,
            r.msme ? "If it remains unpaid we will have to file the case on the MSME Samadhaan portal." : "If it remains unpaid we will have to pause work and ownership handover until it is settled.",
            "",
            "Regards,",
            r.studioName,
          ];
  return {
    tone,
    daysOverdue,
    subject: `${tone === "gentle" ? "Reminder" : tone === "firm" ? "Overdue" : "Final reminder"}: invoice ${r.invoiceNumber} (${amount})`,
    body: lines.join("\n").replace(/\n{3,}/g, "\n\n"),
  };
}

/** wa.me needs digits with country code; 10-digit Indian mobiles get +91. */
export function whatsappNumber(phone: string): string | null {
  const d = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10) return `91${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}
