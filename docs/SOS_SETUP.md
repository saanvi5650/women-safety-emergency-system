# Setting up SOS alerts (email + phone)

When you press SOS, SheShield alerts your trusted contacts in **layers**:

| Layer | Who | When |
|---|---|---|
| 1 | Your highest-priority contacts (e.g. Priority 1: Mom, Dad) | Immediately |
| 2 | The next priority group | After `ESCALATION_INTERVAL_SECONDS` (default 60 s) if nobody responded |
| 3, 4… | Each following priority group | Every interval after that |
| Final | Everyone who hasn't responded gets a reminder | One interval after the last group |

Every contact gets a **private live-tracking link** (`/track.html?t=…&c=…`). When any contact opens it and taps
**"I'm responding"**, escalation stops and you see who is coming. When you tap **"I'm safe"**, every contact who was alerted
gets an "is safe" follow-up.

There are four ways the alert can reach your people. You can use all of them at once.

| Channel | Cost | Setup time | Needs your server? | Best for |
|---|---|---|---|---|
| **Email** (Gmail SMTP) | Free (Gmail limits: ~500 recipients/day) | 5 min | Yes | Everyone; works today |
| **SMS** (Twilio or Fast2SMS) | Paid per message | 15–30 min | Yes | Reaching people without data |
| **Text from my phone** (built in) | Free (your normal SMS) | None | No | Backup when the server or internet fails |
| **Share link / WhatsApp** (built in) | Free | None | No | Sending to WhatsApp groups |

---

## 0. Before you start: make the tracking link reachable

The links inside alerts point to `APP_URL`. If `APP_URL` is `http://localhost:5000`, your mom's phone can't open it.
Pick one:

- **Quick test:** run an [ngrok](https://ngrok.com/) tunnel: `ngrok http 5000`, then set `APP_URL=https://<your-id>.ngrok-free.app`.
- **Real deployment:** deploy the `backend/` folder to Render / Railway / Fly.io with a free MongoDB Atlas cluster,
  then set `APP_URL=https://your-app.onrender.com`. The backend serves the frontend too, so one deployment is enough.

Geolocation in browsers only works on **HTTPS** (or localhost), so deploy behind HTTPS before using it on a phone.

---

## 1. Email alerts with Gmail (free, recommended first)

1. Use a Gmail account for sending (a new one like `sheshield.alerts@gmail.com` is a good idea).
2. Turn on **2-Step Verification**: Google Account → Security → 2-Step Verification.
3. Create an **App Password** at <https://myaccount.google.com/apppasswords>. Name it "SheShield".
   Google shows a 16-character password.
4. In `backend/.env`:

   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=sheshield.alerts@gmail.com
   SMTP_PASS=abcd efgh ijkl mnop     # the 16-char app password
   EMAIL_FROM="SheShield Alerts <sheshield.alerts@gmail.com>"
   ```

5. Restart the server. The log should show `Alert channels -> email: on`.
6. Add a trusted contact **with an email address**, then press SOS to test. Ask the contact to mark the first email
   "Not spam" so future alerts land in the inbox.

> Your normal Gmail password won't work. Google removed "less secure app" access, so you need an App Password (or OAuth2).
> For production volumes, switch to a transactional provider (Resend, Brevo, SendGrid, Amazon SES); only the
> `SMTP_*` values change.

---

## 2. SMS alerts

SMS reaches people who aren't on data. It isn't free anywhere. Pick a provider:

### Option A: Twilio (works worldwide, easiest to start)

1. Sign up at <https://www.twilio.com/try-twilio>. The trial gives free credit.
2. Get a Twilio phone number (Console → Phone Numbers → Buy a number).
3. **Trial accounts can only text verified numbers.** Add each contact's number under
   Console → Phone Numbers → Verified Caller IDs while testing.
4. In `backend/.env`:

   ```env
   SMS_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_FROM=+1XXXXXXXXXX
   ```

5. Store contact numbers in international format, e.g. `+91 98765 43210`.

**India note:** Twilio sends to Indian numbers over its *international* route by default. Twilio says that route doesn't
need DLT registration, and Indian carriers may show a random numeric sender ID. Twilio's *domestic* Indian route (an
alphanumeric sender like `SHESLD`) needs DLT registration (entity, sender ID, templates) first.
See <https://www.twilio.com/en-us/guidelines/in/sms>.

### Option B: Fast2SMS (India only, cheap to start)

1. Sign up at <https://www.fast2sms.com/> and add wallet credit (they advertise a ₹100 minimum).
2. Copy your API key from Dev API.
3. In `backend/.env`:

   ```env
   SMS_PROVIDER=fast2sms
   FAST2SMS_API_KEY=your_key
   ```

SheShield uses Fast2SMS's **Quick SMS** route (`route=q`), which doesn't need DLT. It costs more per SMS
(Fast2SMS lists ₹5) and the first message text may need approval from their team.
For high volume, register on DLT and use a template route (much cheaper per SMS).

---

## 3. "Text from my phone" (no setup, works offline)

In the SOS screen, **Text from my phone** opens your phone's own Messages app with:

- all your trusted contacts' numbers already filled in, and
- the message `SOS! I need help. Live location: <link> Map: <Google Maps link>`.

You just tap Send. It works even if:

- you haven't configured Twilio/Fast2SMS,
- the SheShield server is down (contacts are cached on your phone after you open the Contacts page once), or
- you only have cellular signal, no data.

**Share link** opens the phone's share sheet (WhatsApp, Telegram, Instagram…) or WhatsApp Web on desktop.

> A web page can't send an SMS silently by itself. Every browser requires you to press Send, so server-side SMS
> (section 2) is the only way to text contacts automatically.

---

## 4. Test everything safely

1. Add yourself (a second phone or email) as a Priority 1 contact.
2. For quick tests, shorten escalation in `.env`: `ESCALATION_INTERVAL_SECONDS=15`.
3. Press SOS, wait for the countdown, and check:
   - the SOS screen shows **Email ✓ / SMS ✓** chips per contact,
   - the email/SMS arrives with a working link,
   - opening the link shows your live location, and tapping **I'm responding** shows the responder on your screen,
   - tapping **I'm safe** sends the "is safe" message.
4. Check **Alert History** for the record.

Chip meanings: **✓ sent** · **– skipped** (channel not configured or contact has no email) · **✕ failed** (hover to see why).

---

## 5. Going further: a real phone app

The web app covers most of what a phone app does, but a native app adds:

| Feature | How |
|---|---|
| SOS from the lock screen / power-button presses | Native app (React Native / Flutter) or a home-screen widget |
| Background location while the screen is off | Native background-location permission |
| Push notifications to contacts who also use SheShield | Firebase Cloud Messaging (free) + a `deviceToken` field on users |
| Free WhatsApp messages | WhatsApp Business Cloud API (Meta). Business-initiated messages need pre-approved templates and are billed per conversation |
| Free Telegram alerts | Telegram Bot API (free). Contacts must start a chat with your bot once |
| Auto-call | Twilio Programmable Voice: call contacts and play a recorded SOS message |

A good next step is turning the frontend into a **PWA** (manifest + service worker), so it installs on the home screen
and opens instantly, then wrapping it with Capacitor if you need native background location.
