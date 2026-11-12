# Before testers go live

- [ ] **Anonymous sign-ins** (Supabase → Authentication → Sign In / Providers): turned ON right now so Skip works while testing. Decide before testers: turn it off, or keep Skip but require sign-up before claiming (otherwise guest accounts make farming easy).
- [ ] **Email sender**: connect Resend (or similar) under Supabase → Authentication → Emails → SMTP Settings. The free built-in sender only allows a few emails per hour.
- [ ] **Email templates**: add `Your Blimp code: {{ .Token }}` to Magic Link, Confirm signup and Change Email Address.
- [ ] **Site URL / Redirect URLs** point to the real app address (currently https://blimp-phi.vercel.app).
- [ ] **Test-only buttons**: hide "+$500 play", "Test: simulate a claim" and "Pretend location" for testers (or keep them clearly labeled).
- [ ] **Phone codes** (optional): connect Twilio under Supabase → Authentication → Sign In / Providers → Phone.
