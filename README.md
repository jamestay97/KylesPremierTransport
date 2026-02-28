# Premier Transport Website

Website for Premier Transport — airport transportation (Pinellas to Tampa Airport and surrounding areas). Includes a dropdown pricing flow, clear add-ons section on booking, and an **admin panel** (email/password) to add or remove locations and prices.

## Admin panel (edit locations & prices)

1. **Run the server** (required for admin): `npm install` then `npm start`.
2. Open **http://localhost:3000/admin** (or your deployed URL + `/admin`).
3. **Log in** with the admin email and password (see below).
4. Edit **Fees** (overnight surcharge, car seat fee), **Destinations** (add/remove locations), and **Routes** (from → to with min/max price). Click **Save changes**.

**Set your admin password:** Use environment variables so the default is not used in production:

- `ADMIN_EMAIL` — e.g. `admin@premiertransport.services`
- `ADMIN_PASSWORD` — choose a strong password

Example (Windows PowerShell): `$env:ADMIN_EMAIL="you@example.com"; $env:ADMIN_PASSWORD="your-password"; npm start`

Default (change in production): email `admin@premiertransport.services`, password `changeme`.

When you save in admin, the server updates **`data/config.json`** and **`js/destinations-config.js`**, so the public site (and static hosting) stay in sync.

## Booking notifications (email, and optional text later)

When a customer submits a booking, the server can email you (and others) so you’re alerted right away. Optionally you can add SMS later. Email uses **Resend** (free tier).

**Environment variables for email** (set these on Render so you get notified):

- `RESEND_API_KEY` — API key from [resend.com](https://resend.com) (sign up free; 3,000 emails/month).
- `NOTIFY_EMAIL` — Email address(es) to receive booking alerts. Use **one** address, or **several separated by commas** (e.g. `you@company.com,partner@company.com,office@company.com`) so multiple people get the same notification.

If these are not set, bookings are still saved and the form works; you just won’t get email alerts.

**Resend setup:** Sign up at resend.com, create an API key, add it as `RESEND_API_KEY`. Set `NOTIFY_EMAIL` to your email, or a comma-separated list for your whole team. Emails are sent from `onboarding@resend.dev` on the free tier.

**SMS (optional, later):** To add text alerts later, set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and `NOTIFY_PHONE` on Render. The server will then also send you an SMS for each booking. You can leave these unset for now.

## Booking form

The booking form submits to your backend (Render). Bookings are saved and notification emails are sent via Resend to the addresses you set in **Admin → Booking notification emails**. No Formspree or other third-party form service is used. To change the thank-you redirect URL, edit the `_next` hidden input in `book.html`.

## Adding reviews later

The “What Customers Say” section on the homepage is a placeholder. When you have reviews (e.g. from Google or direct quotes), edit **`index.html`** and replace the contents of the `<div class="reviews-placeholder">` block with your review cards or a link to your Google Business reviews.

## Running locally

**Option A — With admin (recommended)**  
`npm install` then `npm start`. Open http://localhost:3000. The site loads locations and prices from the server; use http://localhost:3000/admin to edit them.

**Option B — Static only**  
Open `index.html` in a browser or use any static server. The site uses **`js/destinations-config.js`** for locations and prices (edit that file by hand, or run the server once to use admin and then deploy the updated files).

## Split hosting (instant public site, admin on Render)

To avoid Render’s cold start for visitors: serve the **public site** (homepage, book, policies) from a **static host** (e.g. GitHub Pages, Netlify, Cloudflare Pages) and keep the **Node app on Render** only for the admin page and APIs. Then only visiting the admin URL triggers Render’s boot screen.

1. **Deploy the static site**  
   Deploy this repo to your static host (publish directory: project root). Point your **main domain** (e.g. `premiertransport.services`) at the static host.

2. **Point admin to Render**  
   Add a subdomain (e.g. `admin.premiertransport.services`) and point it to your Render service (Render’s custom domain docs). The Node app serves `/admin` and all `/api/*` routes.

3. **Booking form backend**  
   In **`book.html`**, set `window.PremierTransportAPIBase` to your admin origin so the booking form can POST to the backend (e.g. `'https://admin.premiertransport.services'`). Leave it empty (`''`) when the book page is served from Render (same origin).

4. **Syncing config after admin edits**  
   When you save in admin on Render, the server updates `js/destinations-config.js` on Render’s disk. The static site has its own copy. After saving, update the static site: open or fetch `https://admin.premiertransport.services/js/destinations-config.js`, copy the content into your repo’s `js/destinations-config.js`, commit, and push so the static host redeploys.

## Deploying updates (GitHub Pages + Render)

- **Render (API/admin):** Push to the branch Render is connected to (e.g. `main`). Render will build and deploy automatically.
- **GitHub Pages (premiertransport.services):** Pages builds from the branch and folder set in the repo (e.g. **Settings → Pages → Source**: branch `main` / root). If the site didn’t update after a push:
  1. Confirm you pushed to that branch (e.g. `git push origin main`).
  2. In GitHub: **Settings → Pages** → under “Build and deployment”, click **Save** (no need to change anything) to trigger a new build.
  3. Wait a minute or two and hard-refresh the site (Ctrl+F5 or Cmd+Shift+R).
  4. If it still shows old content, check **Actions** for a failed “pages build and deployment” workflow.

## Files

- `index.html` — Homepage (hero, how it works, **dropdown pricing**, FAQ, contact)
- `book.html` — Booking form (pickup/drop-off dropdowns, **visible add-ons** section, round trip)
- `admin.html` — Admin login and edit destinations/routes (served at `/admin` when using the Node server)
- `server.js` — Node server: serves site, `/api/config`, and admin auth
- `data/config.json` — Locations and pricing (edited via admin; fallback source)
- `policies.html`, `privacy.html`, `terms.html` — Policies and legal
- `css/site.css` — Styles
- `js/destinations-config.js` — Built from admin save; used when no server
- `js/main.js` — Homepage pricing dropdowns and quote
- `js/booking.js` — Booking form logic and price estimate
