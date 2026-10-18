# Competitor research: personal & women safety apps

Research done in October 2026 to decide what SheShield should build. Prices and feature lists change often, and many
roundups are written by competing apps, so treat the details below as approximate and check each vendor before
quoting them.

## The landscape at a glance

| App | Type | Region | Core idea | Notable features | Weak spots |
|---|---|---|---|---|---|
| **bSafe** | Guardian SOS | Global | Alert your chosen guardians | Unlimited guardians, voice-activated SOS, live audio/video, "Follow me" tracking, fake call, timer alarm | Pricing unclear (~$4.99/mo reported); only acts on a press or timer |
| **Noonlight** | Professional dispatch | US only | Hold a button; release without a PIN and dispatchers call 911 | 24/7 monitoring centre, smart-home/app integrations | US-only; premium tiers paid |
| **Life360** | Family location | Global | Always-on family map | Place alerts, crash detection, SOS (paid tiers $7.99–24.99/mo) | Built for parents tracking teens; privacy concerns for adults |
| **Google Personal Safety** (Pixel) | OS feature | Global | Safety Check timer → Emergency Sharing | Contacts get an SMS with a live Google Maps link; up to 24 h | Pixel only |
| **Apple Check In** (iOS 17+) | OS feature | Global | Alerts friends if you don't arrive on time | Shares location, battery, signal; end-to-end encrypted | Both people need iPhones on iOS 17+ |
| **Safetipin / My Safetipin** | Safety mapping | India + cities worldwide | Crowdsourced **safety audits** | 9 audit parameters (lighting, crowd, walk path…), green/amber/red pins, area Safety Score, safer routes; data shared with city authorities | Audit-heavy; not an emergency tool |
| **Safecity** (Red Dot Foundation) | Harassment crowd-mapping | India + several countries | Anonymous reports of harassment in public spaces, shown as **hotspots** | Mumbai police changed beat patrol timings based on its data; dataset used in 12+ research papers | No SOS; reporting only |
| **112 India** | Government ERSS | India | Single national emergency number in an app | Location shared with the emergency response system; SHOUT alerts nearby volunteers | Depends on state control-room response |
| **Himmat Plus** (Delhi Police) | Police SOS | Delhi | SOS straight to the police control room | Audio/video recording, location sharing | Parliamentary panel said it "failed to serve purpose" (2018); registration revoked after 3 false alerts |
| **Kavalan SOS** (Tamil Nadu Police) | Police SOS | Tamil Nadu | SOS to the TN police control room | Precise location, offline mode | Police-only; no personal network |

## What we learned

1. **The personal network is the real first responder.** bSafe, Google and Apple all alert *friends and family* first.
   Police apps (Himmat, Kavalan, 112) help, but users report slow or uneven response. → SheShield alerts trusted contacts
   first and always shows a **Call 112** button.
2. **A live link beats a one-time location.** Google's Emergency Sharing sends a link that keeps updating, which contacts
   can open without installing anything. → SheShield sends a **tracking link** that works in any browser.
3. **Nobody escalates intelligently.** Most apps alert everyone at once or alert one person and stop. → SheShield's
   **adaptive multi-layer escalation** (AMERM) widens the circle only if nobody responds, and stops as soon as someone does.
4. **Accidental triggers are a real problem.** Himmat cancels accounts after false alerts, and Noonlight uses a PIN.
   → SheShield has a configurable **cancel countdown**, a **False alarm** button, and an automatic "is safe" follow-up
   so contacts aren't left panicking.
5. **Safety mapping and SOS live in separate apps.** Safetipin and Safecity map danger but can't call for help, while
   SOS apps have no idea which streets are risky. → SheShield combines both: a **community safety map** with
   time-of-day weighting and **safest-route** comparison, on the same screen as the SOS button.
6. **Time of day matters.** Safetipin's audits and Safecity's reports both show risk depends heavily on the hour.
   → SheShield records *when* an incident happened and weighs night-time reports more at night.
7. **Anonymity drives reporting.** Safecity's anonymous reporting is why it has tens of thousands of stories.
   → SheShield reports are never shown with the reporter's identity.
8. **India-specific SMS rules.** Commercial SMS to Indian numbers usually needs DLT registration. International routes
   (Twilio, Fast2SMS Quick SMS) avoid that at a higher per-message price. → SheShield supports both, plus a free
   **"Text from my phone"** fallback that needs no provider at all.

## Feature matrix: SheShield vs competitors

| Feature | SheShield | bSafe | Noonlight | Life360 | Google | Safetipin | Safecity | 112 India |
|---|---|---|---|---|---|---|---|---|
| One-tap SOS | ✅ | ✅ | ✅ | ✅ (paid) | ✅ | – | – | ✅ |
| Cancel countdown / false-alarm flow | ✅ | ✅ | ✅ PIN | – | ✅ | – | – | – |
| Alerts personal contacts | ✅ | ✅ | – | ✅ | ✅ | – | – | – |
| **Layered escalation until someone responds** | ✅ | – | – | – | – | – | – | – |
| Contact "I'm responding" acknowledgement | ✅ | partial | n/a | – | – | – | – | – |
| Live tracking link (no install) | ✅ | – | – | – | ✅ | – | – | – |
| Email + SMS alerts | ✅ | SMS | – | push | SMS | – | – | – |
| Works without an SMS provider (phone fallback) | ✅ | – | – | – | – | – | – | – |
| Crowdsourced unsafe-spot map | ✅ | – | – | – | – | ✅ | ✅ | – |
| Time-of-day weighting | ✅ | – | – | – | – | ✅ | partial | – |
| Safest-route comparison | ✅ | – | – | – | – | ✅ | – | – |
| Nearby police / hospitals | ✅ | – | – | – | – | ✅ | – | partial |
| Fake call | ✅ | ✅ | – | – | – | – | – | – |
| Shake to SOS | ✅ (app open) | ✅ | – | – | – | – | – | ✅ |
| Medical notes shared in SOS | ✅ | – | ✅ | – | ✅ | – | – | – |
| Professional 24/7 dispatch | – | – | ✅ | – | – | – | – | ✅ |
| Audio/video recording | – | ✅ | – | – | – | – | – | – |
| Crash detection | – | – | ✅ | ✅ | ✅ | – | – | – |

## Roadmap ideas (ranked by impact ÷ effort)

1. **PWA install + offline shell**: home-screen icon, instant launch, works on poor networks. *(small)*
2. **Duress PIN**: entering a special PIN seems to cancel the SOS but silently keeps it going. Protects users forced
   to cancel by an attacker; Noonlight-style. *(small)*
3. **Safe-arrival timer ("Check In")**: "I'm walking home, alert my contacts if I don't arrive in 20 min." Google and
   Apple have it, and it's the most-requested safety feature for daily commutes. *(medium; reuses the alert engine)*
4. **Telegram / WhatsApp alerts**: Telegram bots are free, and the WhatsApp Cloud API reaches nearly every Indian phone. *(medium)*
5. **Audio evidence recording** during an active SOS, uploaded in chunks so it survives a snatched phone. *(medium)*
6. **Safety audits** like Safetipin (lighting, crowd, CCTV, transport ratings) to supplement incident reports. *(medium)*
7. **Moderation tools for reports**: flagging, auto-expiry of very old reports, and a trust score for reporters. *(medium)*
8. **Native wrapper (Capacitor)** for background location and lock-screen SOS. *(large)*
9. **Police / NGO dashboard** with aggregated hotspot data, the way Safetipin and Safecity work with city authorities. *(large)*

## Sources

- World Emergency Association top-10 list (press release): <https://theprint.in/ani-press-releases/world-emergency-association-announces-top-10-safety-apps-in-the-world-for-women-personal-safety/2686166/>
- Safety app comparisons (note: written by a competing app): <https://imalive.co/best-apps-living-alone>, <https://imalive.co/data/solo-travel-safety-apps-comparison-2026>
- Women safety app roundups: <https://www.mobileappdaily.com/products/best-women-safety-apps>, <https://spher.app/womens-safety-apps/>, <https://3rd-i.com/womens-safety-app>
- India apps: <https://www.techgropse.com/blog/women-safety-apps/>, <https://en.wikipedia.org/wiki/Himmat_(app)>, <https://nikitaghag.com/women-safety-apps-that-every-indian-woman-should-have-in-2026/>, <https://www.parikshitkhanna.com/post/girl-safety-in-delhi-ncr-noida-best-mobile-apps-tools-safety-tips-and-skills-with-links>
- Safetipin: <https://governancenow.com/news/regular-story/app-review-safetipin-safety-app-handy-women-urban-jungles>, <https://unhabitat.org/public-spaces-for-safer-cities-for-women>, <https://safetyscore.safetipin.com/media/29/safetipin-identifies-unsafe-spots-for-women-in-city/>
- Safecity / Red Dot Foundation: <https://end-violence.org/members/red-dot-foundation>, <https://worldjusticeproject.org/world-justice-challenge-2022/red-dot-foundation-urban-vision>, <https://empowering-people-network.siemens-stiftung.org/solutions/safecity-app/>
- Google Safety Check / Apple Check In: <https://support.google.com/assistant/answer/13683607?hl=en-ca>, <https://www.aarp.org/personal-technology/tech-guru-phone-check-in-feature/>, <https://support.apple.com/guide/personal-safety/ips5f85e089f/web>
- SMS in India: <https://www.twilio.com/en-us/guidelines/in/sms>, <https://www.fast2sms.com/quick-sms-without-dlt>
- Gmail SMTP with Nodemailer: <https://nodemailer.com/usage/using-gmail>, <https://serversmtp.com/limits-of-gmail-smtp-server/>
