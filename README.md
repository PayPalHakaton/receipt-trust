# 🧾 Receipt Trust

**Every donation, backed by a receipt an AI has read and checked.**

Charity donors rarely see where money went. Receipt Trust closes that gap:

1. **Donor** gives through **PayPal** (Sandbox: test money only).
2. **Volunteer** photographs a shop receipt.
3. **AI (Claude)** reads it: merchant, date, items, total — and categorises each item.
4. An **auditor step** compares it with what the fundraiser promised to buy and **flags** anything suspicious:
   items outside the fundraiser's purpose, totals that don't add up, duplicate receipts, unreadable photos.
5. A **public report** shows verified spending next to funds raised.

> Demo only. The organisation "Hope Harbor" and all data are fictional. No real payments are made.

## Run it (no dependencies, Node 18+)

```bash
git clone https://github.com/PayPalHakaton/receipt-trust
cd receipt-trust
cp .env.example .env      # optional: add keys
node server.js            # open http://localhost:3000
```

It works with **zero configuration** in demo mode (sample receipts, simulated donation button).
For the full experience add to `.env`:

| Variable | What for |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal **Sandbox** app (developer.paypal.com → Apps & Credentials) |
| `ANTHROPIC_API_KEY` | AI reads real receipt photos |

Pay in the sandbox with a test buyer account from developer.paypal.com → Testing Tools → Sandbox Accounts.

## How PayPal is used
Server-side Orders v2 API (`/v2/checkout/orders`, create + capture) against `api-m.sandbox.paypal.com`; the browser shows the PayPal Smart Buttons. A donation counts only after a `COMPLETED` capture.

## Files
- `server.js` — API, AI receipt reading, audit rules, PayPal integration (plain Node, no packages)
- `public/index.html` — donor / volunteer / public report UI

## License
MIT
