const nodemailer = require("nodemailer");

// Each channel is optional. A channel without credentials is reported as
// "skipped" so the app keeps working in development.

let transporter = null;

const emailConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

const sendEmail = async ({ to, subject, text, html }) => {
  if (!to) return { status: "skipped", detail: "No email address" };
  if (!emailConfigured()) return { status: "skipped", detail: "Email not configured" };

  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || `SheShield Alerts <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    });
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", detail: error.message };
  }
};

const smsProvider = () => (process.env.SMS_PROVIDER || "").toLowerCase();

const sendViaTwilio = async (to, body) => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;

  if (!sid || !authToken || !from) {
    return { status: "skipped", detail: "Twilio not configured" };
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${authToken}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });

  if (response.ok) return { status: "sent" };
  const data = await response.json().catch(() => ({}));
  return { status: "failed", detail: data.message || `Twilio HTTP ${response.status}` };
};

const sendViaFast2SMS = async (to, body) => {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) return { status: "skipped", detail: "Fast2SMS not configured" };

  // Fast2SMS expects 10-digit Indian numbers without the country code.
  const number = to.replace(/\D/g, "").slice(-10);

  const response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
    method: "POST",
    headers: { authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ route: "q", message: body, numbers: number, flash: 0 }),
  });

  const data = await response.json().catch(() => ({}));
  if (response.ok && data.return) return { status: "sent" };
  return { status: "failed", detail: [].concat(data.message || `Fast2SMS HTTP ${response.status}`).join(" ") };
};

const sendSMS = async ({ to, body }) => {
  if (!to) return { status: "skipped", detail: "No phone number" };

  try {
    if (smsProvider() === "twilio") return await sendViaTwilio(to, body);
    if (smsProvider() === "fast2sms") return await sendViaFast2SMS(to, body);
    return { status: "skipped", detail: "SMS not configured" };
  } catch (error) {
    return { status: "failed", detail: error.message };
  }
};

const channelStatus = () => ({
  email: emailConfigured(),
  sms: Boolean(
    (smsProvider() === "twilio" && process.env.TWILIO_ACCOUNT_SID) ||
      (smsProvider() === "fast2sms" && process.env.FAST2SMS_API_KEY)
  ),
});

module.exports = { sendEmail, sendSMS, channelStatus };
