export const config = { runtime: "edge" };

const TEAM = ["admin@credicoach.com", "support@credicoach.com"];
const FROM = "noreply@credicoach.com";
const BRAND = {
  bg:      "#080c10",
  card:    "#0d1117",
  border:  "#1e293b",
  gold:    "#fbbf24",
  blue:    "#3b82f6",
  green:   "#22c55e",
  red:     "#ef4444",
  text:    "#e2e8f0",
  muted:   "#64748b",
};

function baseTemplate({ title, preheader, body, cta, ctaLabel }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:8px 8px 0 0;padding:24px 32px;border-bottom:2px solid ${BRAND.gold};">
      <div style="font-size:24px;font-weight:900;letter-spacing:0.12em;color:${BRAND.gold};text-transform:uppercase;">CREDICOACH</div>
      <div style="font-size:10px;color:${BRAND.muted};letter-spacing:0.15em;margin-top:2px;text-transform:uppercase;">Credit Repair · Funding · Financial Freedom</div>
    </div>
    <div style="background:${BRAND.card};border:1px solid ${BRAND.border};border-top:none;padding:32px;border-radius:0 0 8px 8px;">
      ${body}
      ${cta ? `<div style="margin-top:32px;text-align:center;"><a href="${cta}" style="display:inline-block;background:${BRAND.gold};color:#000;font-weight:700;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;padding:14px 32px;border-radius:4px;text-decoration:none;">${ctaLabel||"VIEW YOUR ACCOUNT"}</a></div>` : ""}
      <div style="margin-top:32px;padding-top:20px;border-top:1px solid ${BRAND.border};text-align:center;">
        <div style="font-size:11px;color:${BRAND.muted};">© CrediCoach · <a href="mailto:admin@credicoach.com" style="color:${BRAND.muted};">admin@credicoach.com</a></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function heading(text, color) {
  return `<h1 style="margin:0 0 20px;font-size:26px;font-weight:900;letter-spacing:0.05em;color:${color||BRAND.gold};text-transform:uppercase;">${text}</h1>`;
}
function para(text) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:${BRAND.text};">${text}</p>`;
}
function highlight(text) {
  return `<div style="background:#0a0f1a;border-left:3px solid ${BRAND.gold};border-radius:4px;padding:16px 20px;margin:20px 0;font-size:14px;line-height:1.7;color:${BRAND.text};">${text}</div>`;
}
function tipBox(tip) {
  return `<div style="background:#0a1200;border:1px solid #1a3a00;border-radius:6px;padding:16px 20px;margin:20px 0;">
    <div style="font-size:10px;color:${BRAND.green};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">💡 PRO TIP</div>
    <div style="font-size:14px;line-height:1.6;color:${BRAND.text};">${tip}</div>
  </div>`;
}

const EDUCATION_EMAILS = [
  {
    subject: "Week 1: Understanding Your Credit Score 📊",
    body: (name) => baseTemplate({
      title: "Week 1: Understanding Your Credit Score",
      body: `
        ${heading("Your Credit Journey Starts Here 🚀")}
        ${para(`Hey ${name}, welcome to your weekly credit education series from CrediCoach. Every week we're dropping real knowledge to help you understand your credit and take control of your financial future. Let's get into it.`)}
        ${heading("What Is a Credit Score?", BRAND.blue)}
        ${para("Your credit score is a 3-digit number between 300 and 850 that tells lenders how likely you are to repay debt. Think of it as your financial GPA — the higher it is, the better deals you get on loans, credit cards, apartments, and even jobs.")}
        ${highlight(`
          <strong style="color:${BRAND.gold};">Score Ranges:</strong><br><br>
          🔴 300–579 — Poor<br>
          🟠 580–669 — Fair<br>
          🟡 670–739 — Good<br>
          🟢 740–799 — Very Good<br>
          ⭐ 800–850 — Exceptional
        `)}
        ${para("The most widely used scoring model is FICO, but lenders may also use VantageScore. Both use similar factors, which we'll break down over the coming weeks.")}
        ${tipBox("Check your credit score for FREE through Credit Karma, Experian, or your bank app. Knowing your starting point is the first step to improving it.")}
        ${para(`Keep pushing. Your breakthrough is coming. 💪<br><br><strong style="color:${BRAND.gold};">— The CrediCoach Team</strong>`)}
      `
    })
  },
  {
    subject: "Week 2: The 5 Factors That Control Your Score 🎯",
    body: (name) => baseTemplate({
      title: "Week 2: The 5 Credit Factors",
      body: `
        ${heading("5 Factors. Know Them All. 🎯")}
        ${para(`${name}, your credit score isn't random — it's calculated from 5 specific factors. Master these and you master your score.`)}
        ${highlight(`
          <strong style="color:${BRAND.gold};">The 5 FICO Factors:</strong><br><br>
          <strong>1. Payment History — 35%</strong><br>The biggest factor. One missed payment can drop your score significantly.<br><br>
          <strong>2. Credit Utilization — 30%</strong><br>How much of your available credit you're using. Keep it under 10%.<br><br>
          <strong>3. Length of Credit History — 15%</strong><br>How long your accounts have been open. Older is better.<br><br>
          <strong>4. Credit Mix — 10%</strong><br>Having different types of credit shows you can manage variety.<br><br>
          <strong>5. New Credit — 10%</strong><br>Every hard inquiry can ding your score temporarily.
        `)}
        ${tipBox("Payment History and Utilization make up 65% of your score. Focus there first for the fastest results.")}
        ${para(`You've got the knowledge. Next week we go deep on how the dispute process actually works.<br><br><strong style="color:${BRAND.gold};">— The CrediCoach Team</strong>`)}
      `
    })
  },
  {
    subject: "Week 3: How Credit Disputes Actually Work 📋",
    body: (name) => baseTemplate({
      title: "Week 3: How Credit Disputes Work",
      body: `
        ${heading("The Dispute Process: What's Happening Behind the Scenes 📋")}
        ${para(`${name}, you're already in the process — but do you know what's actually happening? Let's pull back the curtain.`)}
        ${para("When we file a dispute on your behalf, we're challenging inaccurate, outdated, or unverifiable information on your credit report. Under the Fair Credit Reporting Act (FCRA), credit bureaus have 30–45 days to investigate and respond.")}
        ${highlight(`
          <strong style="color:${BRAND.gold};">The 3 Major Bureaus:</strong><br><br>
          🏦 Equifax · 🏦 Experian · 🏦 TransUnion<br><br>
          Each bureau maintains its own file on you. An item removed from one doesn't automatically get removed from the others — that's why we dispute all three.
        `)}
        ${tipBox("Don't open new credit accounts or make large purchases during the dispute process. Stability in your credit activity helps us get the best results.")}
        ${para(`You're in good hands. The process is working — trust it.<br><br><strong style="color:${BRAND.gold};">— The CrediCoach Team</strong>`)}
      `
    })
  },
  {
    subject: "Week 4: Building Positive Credit History 🏗️",
    body: (name) => baseTemplate({
      title: "Week 4: Building Positive Credit",
      body: `
        ${heading("Build While We Remove 🏗️")}
        ${para(`${name}, while CrediCoach works on removing the negative, you can be building positive credit at the same time. This double approach is what creates real, lasting results.`)}
        ${highlight(`
          <strong style="color:${BRAND.gold};">Ways to Build Positive History:</strong><br><br>
          💳 <strong>Secured Credit Cards</strong> — Deposit money as collateral, use for small purchases, pay off monthly.<br><br>
          🏦 <strong>Credit Builder Loans</strong> — Offered by credit unions and apps like Self.<br><br>
          👥 <strong>Authorized User</strong> — Get added to a trusted person's card and inherit their positive history.<br><br>
          📈 <strong>Tradelines</strong> — Ask us about adding seasoned positive accounts to your profile.
        `)}
        ${tipBox("Set up autopay for the minimum payment on every account. Never miss a payment — it's the single most damaging thing to your score.")}
        ${para(`You're building a foundation for financial freedom.<br><br><strong style="color:${BRAND.gold};">— The CrediCoach Team</strong>`)}
      `
    })
  },
  {
    subject: "Week 5: Mastering Credit Utilization 💳",
    body: (name) => baseTemplate({
      title: "Week 5: Credit Utilization",
      body: `
        ${heading("Utilization: The Fastest Score Mover 💳")}
        ${para(`${name}, if you want to move your credit score fast, utilization is your best friend. It makes up 30% of your score and can change month to month.`)}
        ${highlight(`
          <strong style="color:${BRAND.gold};">The Utilization Sweet Spot:</strong><br><br>
          🔴 Above 50% — Hurting your score significantly<br>
          🟠 30–50% — Still too high<br>
          🟡 10–30% — Acceptable<br>
          🟢 1–10% — Ideal for maximum score impact<br>
          ⚠️ 0% — Slightly worse than 1–10%
        `)}
        ${tipBox("Pay your credit card balance BEFORE the statement closing date. The balance reported to bureaus is your statement balance — not what you owe on the due date.")}
        ${para(`Small moves, big results. You're learning what most people never figure out.<br><br><strong style="color:${BRAND.gold};">— The CrediCoach Team</strong>`)}
      `
    })
  },
  {
    subject: "Week 6: How to Read Your Credit Report 📄",
    body: (name) => baseTemplate({
      title: "Week 6: Reading Your Credit Report",
      body: `
        ${heading("Your Credit Report: Read It Like a Pro 📄")}
        ${para(`${name}, your credit report is the source of truth for your financial history. Knowing how to read it means you can spot errors, track progress, and make smart decisions.`)}
        ${highlight(`
          <strong style="color:${BRAND.gold};">What's on Your Report:</strong><br><br>
          📋 <strong>Personal Information</strong> — Name, address, SSN, date of birth.<br><br>
          💳 <strong>Account History</strong> — Every open and closed account with payment history.<br><br>
          🔴 <strong>Negative Items</strong> — Late payments, collections, charge-offs. Most stay 7 years.<br><br>
          🔍 <strong>Hard Inquiries</strong> — Every time a lender pulled your credit. Stay for 2 years.<br><br>
          ⚖️ <strong>Public Records</strong> — Bankruptcies and judgments.
        `)}
        ${tipBox("You're entitled to one FREE report per year from each bureau at AnnualCreditReport.com. Screenshot before and after working with CrediCoach to see your progress.")}
        ${para(`Six weeks in and you know more about credit than most people ever will. Your score is going to reflect it.<br><br><strong style="color:${BRAND.gold};">— The CrediCoach Team</strong>`)}
      `
    })
  },
];

const MILESTONE_EMAILS = {
  day21: (name) => baseTemplate({
    title: "Your Next Round Is Coming Up",
    body: `
      ${heading("Big Things Are Coming 🔥")}
      ${para(`Hey ${name}, we wanted to reach out personally because we are fired up about your progress.`)}
      ${para("Your next round of dispute results is right around the corner and we have been working hard behind the scenes to get you the best possible outcome.")}
      ${highlight(`
        <strong style="color:${BRAND.gold};">What's Happening Right Now:</strong><br><br>
        ✅ Your disputes have been submitted to all three bureaus<br>
        ✅ The bureaus are actively investigating on your behalf<br>
        ✅ Our team is monitoring your file closely<br>
        ⏳ Results expected within the next two weeks
      `)}
      ${tipBox("This is the most important time to stay consistent. Keep utilization low, pay on time, and don't open any new accounts.")}
      ${para(`We are genuinely excited for you. Stay tuned — good things are coming. 💪<br><br><strong style="color:${BRAND.gold};">— The CrediCoach Team</strong>`)}
    `
  }),
  day35: (name) => baseTemplate({
    title: "Your Disputes Have Been Processed!",
    body: `
      ${heading("GREAT NEWS — You've Been Processed! 🎉", BRAND.green)}
      ${para(`${name}, this is the moment you've been waiting for — your latest round of disputes has been fully processed!`)}
      ${highlight(`
        <strong style="color:${BRAND.green};">✅ YOUR DISPUTES ARE COMPLETE</strong><br><br>
        Our team has successfully completed your current processing round. Updates should be reflected on your credit report shortly.
      `)}
      ${highlight(`
        <strong style="color:${BRAND.gold};">Your Next Steps:</strong><br><br>
        1. Log into your credit monitoring service and check for updates<br>
        2. Screenshot your new scores — track this progress<br>
        3. Compare to where you started<br>
        4. Reach out to us to discuss results and next steps
      `)}
      ${tipBox("Keep your credit monitoring active so you can see changes in real time. If anything looks off, contact us immediately.")}
      ${para(`We are proud of the work we've done together and we're not done yet. Let's keep building toward the financial future you deserve. 🚀<br><br><strong style="color:${BRAND.gold};">— The CrediCoach Team</strong>`)}
    `
  }),
};

const TEAM_EMAILS = {
  day30: (clientName) => baseTemplate({
    title: `Warning: ${clientName} — Day 30`,
    body: `
      ${heading("⚠️ CLIENT WARNING — Day 30", BRAND.gold)}
      ${para(`<strong>${clientName}</strong> has reached <strong style="color:${BRAND.gold};">30 days</strong> since their last processing date.`)}
      ${highlight(`This client needs to be processed within the next 5 days to stay on track. Log into CrediTrack to mark them as processed.`)}
      ${para(`<strong style="color:${BRAND.muted};">— CrediTrack Automated Alert</strong>`)}
    `
  }),
  day35: (clientName) => baseTemplate({
    title: `OVERDUE: ${clientName} — Day 35+`,
    body: `
      ${heading("🚨 CLIENT OVERDUE — Day 35+", BRAND.red)}
      ${para(`<strong>${clientName}</strong> is <strong style="color:${BRAND.red};">past 35 days</strong> since their last processing date and is now overdue.`)}
      ${highlight(`<strong style="color:${BRAND.red};">Immediate action required.</strong> Process this client today and mark them as processed in CrediTrack.`)}
      ${para(`<strong style="color:${BRAND.muted};">— CrediTrack Automated Alert</strong>`)}
    `
  }),
  missed: (clientName, amount) => baseTemplate({
    title: `Missed Payment: ${clientName}`,
    body: `
      ${heading("⚠️ MISSED PAYMENT ALERT", BRAND.red)}
      ${para(`<strong>${clientName}</strong> has been marked as a <strong style="color:${BRAND.red};">missed payment</strong>${amount ? ` of <strong style="color:${BRAND.red};">${amount}</strong>` : ""}.`)}
      ${highlight(`Follow up with this client as soon as possible and update their status in CrediTrack.`)}
      ${para(`<strong style="color:${BRAND.muted};">— CrediTrack Automated Alert</strong>`)}
    `
  }),
  paid: (clientName, amount) => baseTemplate({
    title: `Payment Received: ${clientName}`,
    body: `
      ${heading("✅ PAYMENT RECEIVED", BRAND.green)}
      ${para(`<strong>${clientName}</strong> has made a payment${amount ? ` of <strong style="color:${BRAND.green};">${amount}</strong>` : ""}.`)}
      ${highlight(`Payment has been logged in CrediTrack. Balance updated automatically.`)}
      ${para(`<strong style="color:${BRAND.muted};">— CrediTrack Automated Alert</strong>`)}
    `
  }),
};

async function sendEmail(to, subject, html, apiKey) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html }),
  });
  return res.ok;
}

export default async function handler(req) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const apiKey = process.env.VITE_RESEND_API_KEY;
  if (!apiKey) return new Response("Missing API key", { status: 500 });
  try {
    const { type, clientName, clientEmail, amount, weekNumber } = await req.json();
    switch (type) {
      case "team_day30":    await sendEmail(TEAM, `⚠️ Warning: ${clientName} — Day 30`, TEAM_EMAILS.day30(clientName), apiKey); break;
      case "team_day35":    await sendEmail(TEAM, `🚨 OVERDUE: ${clientName} — Day 35+`, TEAM_EMAILS.day35(clientName), apiKey); break;
      case "team_missed":   await sendEmail(TEAM, `⚠️ Missed Payment: ${clientName}`, TEAM_EMAILS.missed(clientName, amount), apiKey); break;
      case "team_paid":     await sendEmail(TEAM, `✅ Payment Received: ${clientName}`, TEAM_EMAILS.paid(clientName, amount), apiKey); break;
      case "client_week":   if (clientEmail) { const w=EDUCATION_EMAILS[Math.min((weekNumber||1)-1,5)]; await sendEmail(clientEmail, w.subject, w.body(clientName), apiKey); } break;
      case "client_day21":  if (clientEmail) await sendEmail(clientEmail, "🔥 Your Next Round Is Coming — CrediCoach Update", MILESTONE_EMAILS.day21(clientName), apiKey); break;
      case "client_day35":  if (clientEmail) await sendEmail(clientEmail, "🎉 Great News — Your Disputes Have Been Processed!", MILESTONE_EMAILS.day35(clientName), apiKey); break;
      default: return new Response("Unknown type", { status: 400 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
