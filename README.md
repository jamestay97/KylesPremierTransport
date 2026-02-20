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

## Booking form (Formspree)

The booking form is set up to submit via **Formspree** so submissions go to your email. To activate it:

1. Go to [formspree.io](https://formspree.io) and create an account.
2. Create a new form and set the notification email to **info@premiertransport.services**.
3. Copy your form ID from the form’s action URL (e.g. `https://formspree.io/f/abcdexyz` → the ID is `abcdexyz`).
4. In **`book.html`**, find `YOUR_FORMSPREE_FORM_ID` in the form `action` attribute and replace it with your form ID.
5. (Optional) If your site is not at premiertransport.services, update the `_next` hidden input value so customers are redirected back to your booking page with `?submitted=1` after submitting.

## Adding reviews later

The “What Customers Say” section on the homepage is a placeholder. When you have reviews (e.g. from Google or direct quotes), edit **`index.html`** and replace the contents of the `<div class="reviews-placeholder">` block with your review cards or a link to your Google Business reviews.

## Running locally

**Option A — With admin (recommended)**  
`npm install` then `npm start`. Open http://localhost:3000. The site loads locations and prices from the server; use http://localhost:3000/admin to edit them.

**Option B — Static only**  
Open `index.html` in a browser or use any static server. The site uses **`js/destinations-config.js`** for locations and prices (edit that file by hand, or run the server once to use admin and then deploy the updated files).

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
