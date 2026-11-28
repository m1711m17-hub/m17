# NEXORA AI Edge Function

This function proxies authenticated NEXORA users to the OpenAI Responses API. The OpenAI key is never shipped to the Android app.

## Required Supabase secrets

Set these in Supabase Dashboard → Edge Functions → Secrets:

- `OPENAI_API_KEY`: API key from the OpenAI Platform.
- `OPENAI_MODEL`: optional model name available to your API project; defaults to `gpt-6.2-sol`.

Supabase provides `SUPABASE_URL` and `SUPABASE_ANON_KEY` to Edge Functions.

## Deploy

From the repository root with the Supabase CLI linked to the NEXORA project:

```sh
supabase functions deploy nexora-ai
supabase secrets set OPENAI_API_KEY=your_key_here OPENAI_MODEL=gpt-6.2-sol
```

Do not commit API keys or place them in `www/js/config.js`, JavaScript, or APK files.

The function verifies the caller's Supabase access token, limits conversation history and message length, and calls the OpenAI Responses API with `store: false`.
