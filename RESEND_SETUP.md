# Setting up Resend for Email Alerts

## Quick Setup (5 minutes)

1. **Sign up for Resend**
   - Go to https://resend.com
   - Sign up with your email (free tier: 100 emails/day, 3,000/month)
   - Verify your email

2. **Get your API key**
   - Once logged in, go to API Keys page (https://resend.com/api-keys)
   - Click "Create API Key"
   - Name it "LeadWatch" with "Sending access" permission
   - Copy the key (starts with `re_...`)

3. **Add to .env**
   ```
   RESEND_API_KEY=re_your_actual_key_here
   ```

4. **Test it**
   - Restart your LeadWatch backend: `npm start`
   - Create an alert rule in the dashboard (🔔 Alerts button)
   - Set your email address as the recipient
   - Wait for a matching lead to appear

## Notes

- **Default sender**: The code currently uses `onboarding@resend.dev` which works for testing
- **Custom domain** (optional): To use your own domain (e.g., `alerts@yourdomain.com`), add and verify your domain in Resend settings, then update `src/alerts.js` line 54
- **Free tier limits**: 100 emails/day, 3,000/month — more than enough for lead alerts
- **Delivery**: Emails arrive within seconds; check spam folder if missing

## Troubleshooting

If emails aren't sending:
1. Check the backend console for `[alerts]` log messages
2. Verify `RESEND_API_KEY` is set in `.env` (no quotes, no spaces)
3. Restart the backend after adding the key
4. Test your Resend API key at https://resend.com/docs/send-with-nodejs
