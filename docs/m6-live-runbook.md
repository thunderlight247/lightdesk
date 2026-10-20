# M6 Live Runbook — going live with a real customer message

Status: **runbook for the project owner.** Everything that must be done in Meta's dashboard
or with a hosting decision is outside this repository. The code side (connection binding,
signatures, inbound pipeline, owner-send gate) is implemented and tested; this page connects
the two worlds in the exact order needed.

Current state (updated 2026-10-20):

- The verified Meta credentials are bound to the real business `light`
  (connection id `cmvgvqbq30001bl0qxffa5r8g`, number id `1428805996983499`).
- The line is Meta's provisioned **test number** ("Test Number", +1 555-677-5612),
  `code_verification_status: NOT_VERIFIED`, quality GREEN.
- Webhook GET handshake and POST pipeline proven locally with the real `WHATSAPP_APP_SECRET`.

## 1. Get a public URL for LightDesk

Meta's servers must reach the webhook over HTTPS. Choose one:

- **Hosted deployment** (Google Cloud Run was mentioned as the intended path): needs a
  production build (`npm run build`), a Postgres instance (the dev docker database is local
  only — use a managed Postgres and run `prisma migrate deploy`), and the env values from
  `.env` set as service secrets. The URL of the deployed service is what Meta receives.
- **Tunnel for a short pilot** (cloudflared/ngrok on the runner's machine): faster, but the
  URL changes on each restart — acceptable for the first live message test, not for the pilot.

Either way, Meta one day only supports HTTPS, so the tunnel option must be HTTPS from day one.

## 2. Register the webhook in the Meta dashboard

In the Meta app dashboard → **WhatsApp → Configuration (Webhooks)**:

1. Callback URL: `https://<your-public-host>/api/whatsapp/webhook`
2. Verify token: the value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN` from `.env`
   (`lightdesk_secure_token`). Meta calls our GET with this token and expects the
   `hub.challenge` echo — already implemented and tested.
3. Click "Verify and save" (must pass against the running public deployment).
4. Subscribe to **Webhook fields → `messages`**. Delivery statuses arrive on the same field.

## 3. Receive a real customer message

1. From ANY real WhatsApp account, send a message to **+1 555-677-5612** (the test number).
2. Meta POSTs the signed webhook to `/api/whatsapp/webhook`.
3. The pipeline stores it: conversation created in `OWNER_ONLY` mode for the bound business
   `light`, wamid deduped, audit event `whatsapp.message.received`.
4. Verify in the DB:
   `SELECT "text","direction","status" FROM "WhatsAppMessage" ORDER BY "createdAt" DESC LIMIT 5;`
   and `SELECT * FROM "AuditEvent" WHERE action='whatsapp.message.received' ORDER BY "createdAt" DESC;`

Note: inbound traffic to a test number works from anyone; only REPLYING is limited to the
up-to-5 recipients in **WhatsApp → API Setup → To** (recipient allowlist). Add your own phone
there before sending anything outbound.

## 4. Send an owner-approved reply (M6d gate)

The send gate requires (all implemented and unit/integration tested):

- an OWNER or ADMIN of the bound business (MEMBER cannot send),
- an open **24-hour customer service window** measured from the customer's last inbound,
- the token must decrypt (it will, using `WHATSAPP_TOKEN_ENCRYPTION_KEY`),
- metering: 1,000 free **service** messages per calendar month per messaging account —
  the meter counts outbound sends and is audited with each send.

Until the conversation UI ships, send through the service function in a scratch script wired
to the conversation id from step 3. The UI panel is the M6c/M6d follow-up.

## 5. Connect the REAL business number (coexistence)

The test number is for development. To put the light business's real number on the Cloud API
with the owner's WhatsApp Business app kept in daily use (coexistence):

1. In the **WhatsApp → API Setup** screen of the app, either add a new number and select the
   coexistence option (WhatsApp Business app pairing via QR code), or use the existing
   business app number.
2. Meta will send a code to verify ownership; the 24-hour history-sync webhooks
   (`account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes`) start flowing.
3. Update `.env` with the NEW phone-number id (the display number may stay the same), then
   rebind: `npx tsx --env-file=.env scripts/whatsapp-setup-connection.ts <businessId> --coexistence`
4. Tip: turning on coexistence is effectively one-way from the app side; confirm on the
   WhatsApp Business app on the owner's phone that the pairing is acceptable before confirming.

## 6. Do not forget the code-verification status

`code_verification_status: NOT_VERIFIED` on the current test number is normal for Meta's test
lines; for a REAL number the two-step verification code must be entered in the dashboard
before webhooks/messages work reliably. Re-run
`tsx --env-file=.env scripts/whatsapp-verify.ts` after any connection change to confirm the
token and number without sending anything.
