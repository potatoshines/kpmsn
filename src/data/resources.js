// Approved resource knowledge base. Add a resource by adding an entry here.
// k: transcript trigger (regex), e: eligibility note, a: rep next action, CL: concern label.
export const R = {
  fa: {
    n: "Medical Financial Assistance",
    d: "A program that may reduce medical bills for people who qualify based on income and household size.",
    k: /afford|can.t pay|medical bill|owe|struggl/i,
    e: "Income and household documents required; eligibility decided by the program.",
    a: "Review the application steps with the member.",
  },
  pp: {
    n: "Medical-bill payment plan",
    d: "Lets a member spread a balance over scheduled payments.",
    k: /payment plan|monthly|installment|over time|bill/i,
    e: "Verify balance and plan terms with Billing.",
    a: "Confirm the amount due and offer plan options.",
  },
  hub: {
    n: "Community Support Hub",
    d: "Search tool linking to local help with food, housing and other needs.",
    k: /food|rent|housing|groceries/i,
    e: "Community organizations set their own eligibility.",
    a: "Share the link and the member’s ZIP code search.",
  },
  rx: {
    n: "Prescription refill and delivery",
    d: "Refill by mail or app and request delivery of prescriptions.",
    k: /refill|pharmacy|prescription|delivery/i,
    e: "Verify the medication is refillable on the record.",
    a: "Review the medication list, then explain refill options.",
  },
  pv: {
    n: "Preventive-care reminder",
    d: "A reminder about a screening or checkup shown as due on the record.",
    k: /screening|checkup|overdue|vaccine|colonoscopy/i,
    e: "Confirm the item is recorded as due; clinical questions go to the care team.",
    a: "Remind the member to schedule with their care team.",
  },
  tr: {
    n: "Transportation assistance",
    d: "Rides to covered appointments for members on eligible plans.",
    k: /ride|transport|get to|drive/i,
    e: "Only certain plans; verify plan eligibility first.",
    a: "Check plan type before discussing.",
  },
};
export const L = "https://healthy.kaiserpermanente.org/";
export const CL = {
  fa: "Difficulty paying a medical bill",
  pp: "Spreading out a balance",
  hub: "Basic needs support",
  rx: "Prescription access",
  pv: "Preventive care due",
  tr: "Getting to appointments",
};
